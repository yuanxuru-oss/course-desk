/**
 * 数据操作层:所有对 IndexedDB 的写操作集中在这里
 */
import { db, uid, saveBlob, deleteBlob, getBlob } from '../db'
import type {
  Course,
  CourseEvent,
  Homework,
  HomeworkTemplate,
  KnowledgeChunk,
  KnowledgeDoc,
  Note,
  Settings,
} from '../types'
import { chunkText } from './knowledge'
import { courseSignature } from './import.ts'
import { embed } from './ai'
import { hashColor } from './utils'
import { eventToNoteContent, eventKindMeta } from './event'

/* ---------------- 合并工具 ---------------- */

/**
 * 合并字段时判断「这次有没有改这个字段」。
 *
 * 直接用 `next ?? existing` 会把两种完全不同的意图混成一个:
 *   · 这次没传这个字段        → 应该保留原值
 *   · 这次要把它清空(空)     → 应该真的清掉
 * 于是「把课程的周次改回每周」「把作业的截止时间删掉」永远无效 ——
 * 旧值被 `??` 又写回去了。
 *
 * 现在的约定:**只有对象里显式出现了这个键**,这次的值才算数;
 * 键存在但值是 undefined/null,就是「清空」。
 */
function pickField<T>(input: any, key: string, fallback: T | undefined): T | undefined {
  if (!input || !(key in input)) return fallback
  const v = input[key]
  return v === undefined || v === null ? undefined : (v as T)
}

/** 本地时区的 YYYY-MM-DD(不要用 toISOString,那是 UTC) */
function localDateStr(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/* ---------------- 课程 ---------------- */

export async function upsertCourse(course: Partial<Course> & { name: string }): Promise<Course> {
  const now = Date.now()
  const existing = course.id ? await db.courses.get(course.id) : undefined
  const merged: Course = {
    id: existing?.id ?? uid('course'),
    name: course.name,
    teacher: pickField(course, 'teacher', existing?.teacher),
    location: pickField(course, 'location', existing?.location),
    campus: pickField(course, 'campus', existing?.campus),
    building: pickField(course, 'building', existing?.building),
    color: course.color ?? existing?.color ?? hashColor(course.name),
    startWeek: course.startWeek ?? existing?.startWeek ?? 1,
    endWeek: course.endWeek ?? existing?.endWeek ?? 16,
    singleWeeks: pickField(course, 'singleWeeks', existing?.singleWeeks),
    weekday: course.weekday ?? existing?.weekday ?? 1,
    period: course.period ?? existing?.period ?? 1,
    periods: course.periods ?? existing?.periods ?? 1,
    remark: pickField(course, 'remark', existing?.remark),
    website: pickField(course, 'website', existing?.website),
    resources: pickField(course, 'resources', existing?.resources),
    hidden: pickField(course, 'hidden', existing?.hidden),
    leadMinutes: pickField(course, 'leadMinutes', existing?.leadMinutes),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await db.courses.put(merged)
  return merged
}

export async function deleteCourse(id: string) {
  await db.courses.delete(id)
  const hw = await db.homework.where('courseId').equals(id).toArray()
  for (const h of hw) await db.homework.delete(h.id)
  await db.templates.where('courseId').equals(id).toArray().then((t) =>
    Promise.all(t.map((x) => db.templates.delete(x.id))),
  )
  const notes = await db.notes.where('courseId').equals(id).toArray()
  for (const n of notes) await deleteNote(n.id)
}

export async function shiftCourseWeek(courseId: string, direction: 1 | -1) {
  const course = await db.courses.get(courseId)
  if (!course) return
  await upsertCourse({ ...course, startWeek: course.startWeek + direction, endWeek: course.endWeek + direction })
}

export interface ImportCoursesResult {
  added: number
  updated: number
  skipped: number
}

/**
 * 批量导入课程(带重复检测)。
 *
 * 两道保险:
 *   1. 内容签名已经存在于库里 → 直接跳过(保留用户可能改过的教室/颜色/备注)
 *   2. 同 id 但内容不同 → 覆盖更新
 * 这样「同一份课表导两次」不会变成两份,也不会把用户手工改过的东西冲掉。
 */
export async function importCourses(list: Course[]): Promise<ImportCoursesResult> {
  const existing = await db.courses.toArray()
  const bySig = new Map<string, Course>()
  const byId = new Map<string, Course>()
  for (const c of existing) {
    bySig.set(courseSignature(c), c)
    byId.set(c.id, c)
  }

  let added = 0
  let updated = 0
  let skipped = 0
  for (const c of list) {
    const sig = courseSignature(c)
    if (bySig.has(sig)) {
      skipped++
      continue
    }
    const same = byId.get(c.id)
    if (same) {
      await db.courses.put({ ...same, ...c, createdAt: same.createdAt, updatedAt: Date.now() })
      updated++
    } else {
      await db.courses.put(c)
      added++
    }
    bySig.set(sig, c)
    byId.set(c.id, c)
  }
  return { added, updated, skipped }
}

/**
 * 清理已经存在的重复课程。
 *
 * 两种情况一起处理:
 *   1. 完全重复(早期随机 id,同一份课表导两次)
 *   2. 同一门课被按周次拆成多段(张三 7-8 周 / 李四 10-12 周 / 张三 9 周)——合并成一条
 *
 * 处理时:
 *   · 只保留最早创建的那条(或周次最早的)
 *   · 把挂在上面的作业 / 每周模板 / 备忘 / 资料改到保留的那条上,不丢关联
 *   · 其余删除
 * 返回删掉的条数。
 */
export async function cleanupDuplicateCourses(): Promise<number> {
  const all = await db.courses.toArray()

  /** 把某条课的关联数据转移到另一条课上,然后删掉它 */
  const absorb = async (from: Course, toId: string) => {
    await db.homework.where('courseId').equals(from.id).modify({ courseId: toId })
    await db.templates.where('courseId').equals(from.id).modify({ courseId: toId })
    await db.notes.where('courseId').equals(from.id).modify({ courseId: toId })
    await db.docs.where('courseId').equals(from.id).modify({ courseId: toId })
    await db.courses.delete(from.id)
  }

  let removed = 0

  // 1) 完全重复
  const bySig = new Map<string, Course[]>()
  for (const c of all) {
    const sig = courseSignature(c)
    const list = bySig.get(sig)
    if (list) list.push(c)
    else bySig.set(sig, [c])
  }
  const survivors: Course[] = []
  for (const list of bySig.values()) {
    const keep = [...list].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))[0]
    survivors.push(keep)
    for (const dup of list) {
      if (dup.id === keep.id) continue
      await absorb(dup, keep.id)
      removed++
    }
  }

  // 2) 同一门课被按周次拆成多段 → 合并(断周 / 不同教室 / 单双周不合并)
  const bySlot = new Map<string, Course[]>()
  for (const c of survivors) {
    if (c.singleWeeks?.length) continue
    const key = [
      c.name.replace(/\s+/g, ''),
      c.weekday,
      c.period,
      c.periods,
      (c.location ?? '').replace(/\s+/g, ''),
    ].join('|')
    const list = bySlot.get(key)
    if (list) list.push(c)
    else bySlot.set(key, [c])
  }
  for (const list of bySlot.values()) {
    if (list.length < 2) continue
    const sorted = [...list].sort((a, b) => a.startWeek - b.startWeek || a.endWeek - b.endWeek)
    let cur = sorted[0]
    const notes: string[] = cur.remark ? [cur.remark] : []
    const flush = async () => {
      if (notes.length) await db.courses.update(cur.id, { remark: notes.join(';') })
    }
    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i]
      if (next.startWeek > cur.endWeek + 1) {
        await flush()
        cur = next
        notes.length = 0
        if (next.remark) notes.push(next.remark)
        continue
      }
      if (next.teacher && next.teacher !== cur.teacher) {
        const w = next.startWeek === next.endWeek ? `第${next.startWeek}周` : `第${next.startWeek}-${next.endWeek}周`
        notes.push(`${w}由${next.teacher}授课`)
      }
      const endWeek = Math.max(cur.endWeek, next.endWeek)
      await db.courses.update(cur.id, { endWeek, updatedAt: Date.now() })
      cur = { ...cur, endWeek }
      await absorb(next, cur.id)
      removed++
    }
    await flush()
  }

  return removed
}

/* ---------------- 行程 ---------------- */

/**
 * 保存行程,并同步一份到备忘录。
 * 行程改动 → 备忘录同步更新;删除行程 → 对应备忘也一起删掉。
 */
export async function upsertEvent(
  input: Partial<CourseEvent> & { title: string },
): Promise<CourseEvent> {
  const now = Date.now()
  const existing = input.id ? await db.events.get(input.id) : undefined
  const merged: CourseEvent = {
    id: existing?.id ?? uid('event'),
    title: input.title,
    kind: input.kind ?? existing?.kind ?? 'meeting',
    // 用本地日期,不能用 toISOString():那是 UTC,东八区 00:00–07:59
    // 创建会落成「昨天」,行程直接排到错误的一天。
    date: input.date ?? existing?.date ?? localDateStr(),
    start: input.start ?? existing?.start ?? '19:00',
    end: input.end ?? existing?.end ?? '20:00',
    location: pickField(input, 'location', existing?.location),
    detail: pickField(input, 'detail', existing?.detail),
    weekly: input.weekly ?? existing?.weekly ?? false,
    noteId: existing?.noteId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await db.events.put(merged)

  // 同步到备忘录(保留用户在备忘里做的置顶和自定义标签)
  const tag = eventKindMeta(merged.kind).label
  const prevNote = merged.noteId ? await db.notes.get(merged.noteId) : undefined
  const tags = Array.from(new Set([...(prevNote?.tags ?? []), '行程', tag]))
  const note = await upsertNote({
    id: merged.noteId,
    title: merged.title,
    content: eventToNoteContent(merged),
    tags,
    pinned: prevNote?.pinned ?? false,
  })
  merged.noteId = note.id
  await db.events.put(merged)
  return merged
}

export async function deleteEvent(id: string) {
  const ev = await db.events.get(id)
  if (ev?.noteId) await deleteNote(ev.noteId)
  await db.events.delete(id)
}

/* ---------------- 作业 ---------------- */

export async function upsertHomework(hw: Partial<Homework> & { title: string }): Promise<Homework> {
  const now = Date.now()
  const existing = hw.id ? await db.homework.get(hw.id) : undefined
  const done = hw.done ?? existing?.done ?? false
  const merged: Homework = {
    id: existing?.id ?? uid('hw'),
    title: hw.title,
    courseId: pickField(hw, 'courseId', existing?.courseId),
    detail: pickField(hw, 'detail', existing?.detail),
    dueAt: pickField(hw, 'dueAt', existing?.dueAt),
    done,
    // 编辑已完成作业的标题时不要把完成时间重置成「现在」
    doneAt: done ? (existing?.done ? existing.doneAt ?? now : now) : undefined,
    attachments: hw.attachments ?? existing?.attachments ?? [],
    week: hw.week ?? existing?.week,
    templateId: hw.templateId ?? existing?.templateId,
    priority: hw.priority ?? existing?.priority ?? 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await db.homework.put(merged)
  return merged
}

export async function toggleHomework(id: string) {
  const hw = await db.homework.get(id)
  if (!hw) return
  await db.homework.put({ ...hw, done: !hw.done, doneAt: !hw.done ? Date.now() : undefined, updatedAt: Date.now() })
}

export async function deleteHomework(id: string) {
  const hw = await db.homework.get(id)
  if (hw) for (const b of hw.attachments) await deleteBlob(b)
  await db.homework.delete(id)
}

export async function upsertTemplate(t: Partial<HomeworkTemplate> & { title: string }): Promise<HomeworkTemplate> {
  const now = Date.now()
  const existing = t.id ? await db.templates.get(t.id) : undefined
  const merged: HomeworkTemplate = {
    id: existing?.id ?? uid('tpl'),
    title: t.title,
    courseId: t.courseId ?? existing?.courseId,
    detail: t.detail ?? existing?.detail,
    weekday: t.weekday ?? existing?.weekday ?? 1,
    timeOfDay: t.timeOfDay ?? existing?.timeOfDay ?? '23:59',
    startWeek: t.startWeek ?? existing?.startWeek ?? 1,
    endWeek: t.endWeek ?? existing?.endWeek ?? 20,
    priority: t.priority ?? existing?.priority ?? 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await db.templates.put(merged)
  return merged
}

export async function deleteTemplate(id: string) {
  await db.templates.delete(id)
  const items = await db.homework.where('templateId').equals(id).toArray()
  for (const h of items) await deleteHomework(h.id)
}

/* ---------------- 备忘录 ---------------- */

export async function upsertNote(note: Partial<Note> & { title: string }): Promise<Note> {
  const now = Date.now()
  const existing = note.id ? await db.notes.get(note.id) : undefined
  const merged: Note = {
    id: existing?.id ?? uid('note'),
    title: note.title,
    content: note.content ?? existing?.content ?? '',
    images: note.images ?? existing?.images ?? [],
    tags: note.tags ?? existing?.tags ?? [],
    courseId: pickField(note, 'courseId', existing?.courseId),
    pinned: note.pinned ?? existing?.pinned ?? false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await db.notes.put(merged)
  await indexNote(merged)
  return merged
}

export async function deleteNote(id: string) {
  const note = await db.notes.get(id)
  if (note) for (const b of note.images) await deleteBlob(b)
  await db.notes.delete(id)
  const doc = await db.docs.where('noteId').equals(id).first()
  if (doc) await deleteDoc(doc.id)
}

/* ---------------- 知识库 ---------------- */

export async function deleteDoc(docId: string) {
  await db.docs.delete(docId)
  const chunks = await db.chunks.where('docId').equals(docId).toArray()
  for (const c of chunks) await db.chunks.delete(c.id)
}

/** 把一条备忘录切分并写入知识库 */
export async function indexNote(note: Note, settings?: Settings) {
  const existing = await db.docs.where('noteId').equals(note.id).first()
  if (existing) await deleteDoc(existing.id)

  const text = note.content.trim()
  if (!text) return

  const doc: KnowledgeDoc = {
    id: uid('doc'),
    title: note.title || '未命名笔记',
    text,
    kind: 'note',
    courseId: note.courseId,
    noteId: note.id,
    images: note.images,
    tags: note.tags,
    createdAt: Date.now(),
  }
  await db.docs.put(doc)

  const pieces = chunkText(text)
  const chunks: KnowledgeChunk[] = pieces.map((p) => ({
    id: uid('chunk'),
    docId: doc.id,
    title: doc.title,
    text: p,
    courseId: note.courseId,
    createdAt: Date.now(),
  }))
  await db.chunks.bulkPut(chunks)

  if (settings?.ai?.embedModel) {
    await embedChunks(chunks, settings)
  } else {
    // 保存笔记时调用方不一定把 settings 传进来;配了向量模型就该生成向量,
    // 否则混合检索里新笔记的语义分恒为 0,会被老笔记系统性压过。
    const stored = await db.settings.get('app')
    if (stored?.ai?.embedModel) await embedChunks(chunks, stored)
  }
}

/** 重新为所有笔记建立知识库索引(换模型 / 数据异常后使用) */
export async function reindexNotes(settings?: Settings): Promise<number> {
  const notes = await db.notes.toArray()
  for (const n of notes) await indexNote(n, settings)
  return notes.length
}

/** 把上传的资料写入知识库 */
export async function indexDocument(input: {
  title: string
  text: string
  kind?: 'upload' | 'ocr'
  courseId?: string
  images?: string[]
  tags?: string[]
}): Promise<KnowledgeDoc> {
  const doc: KnowledgeDoc = {
    id: uid('doc'),
    title: input.title,
    text: input.text,
    kind: input.kind ?? 'upload',
    courseId: input.courseId,
    images: input.images ?? [],
    tags: input.tags ?? [],
    createdAt: Date.now(),
  }
  await db.docs.put(doc)
  const pieces = chunkText(input.text)
  const chunks: KnowledgeChunk[] = pieces.map((p) => ({
    id: uid('chunk'),
    docId: doc.id,
    title: doc.title,
    text: p,
    courseId: input.courseId,
    createdAt: Date.now(),
  }))
  await db.chunks.bulkPut(chunks)
  return doc
}

/** 给切片补向量 */
export async function embedChunks(chunks: KnowledgeChunk[], settings: Settings) {
  for (const c of chunks) {
    try {
      const vec = await embed(settings.ai, c.text.slice(0, 4000))
      c.embedding = vec
      await db.chunks.put(c)
    } catch (err) {
      console.warn('[knowledge] 向量化失败,已降级为关键词检索', err)
      return
    }
  }
}

/** 重新为所有切片生成向量(切换向量模型后调用) */
export async function reindexEmbeddings(settings: Settings): Promise<{ done: number; failed: number }> {
  const chunks = await db.chunks.toArray()
  let done = 0
  let failed = 0
  for (const c of chunks) {
    try {
      c.embedding = await embed(settings.ai, c.text.slice(0, 4000))
      await db.chunks.put(c)
      done++
    } catch {
      failed++
    }
  }
  return { done, failed }
}

/* ---------------- 图片 ---------------- */

export async function uploadImage(file: File): Promise<string> {
  return saveBlob(file)
}

/* ---------------- 导入导出 ---------------- */

export interface ExportBundle {
  version: 1
  exportedAt: string
  settings: Settings
  courses: Course[]
  events: CourseEvent[]
  homework: Homework[]
  templates: HomeworkTemplate[]
  notes: Note[]
  docs: KnowledgeDoc[]
  images: { id: string; data: string; type: string }[]
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  return res.blob()
}

export async function exportAll(): Promise<ExportBundle> {
  const settings = (await db.settings.get('app'))!
  const courses = await db.courses.toArray()
  const events = await db.events.toArray()
  const homework = await db.homework.toArray()
  const templates = await db.templates.toArray()
  const notes = await db.notes.toArray()
  const docs = await db.docs.toArray()
  const blobs = await db.blobs.toCollection().primaryKeys()
  const images: ExportBundle['images'] = []
  for (const key of blobs) {
    const b = await getBlob(String(key))
    if (!b) continue
    images.push({ id: String(key), data: await blobToDataUrl(b), type: b.type })
  }
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    courses,
    events,
    homework,
    templates,
    notes,
    docs,
    images,
  }
}

export async function importAll(bundle: ExportBundle, mode: 'merge' | 'replace') {
  if (mode === 'replace') {
    await Promise.all([
      db.courses.clear(),
      db.events.clear(),
      db.homework.clear(),
      db.templates.clear(),
      db.notes.clear(),
      db.docs.clear(),
      db.chunks.clear(),
      db.blobs.clear(),
    ])
  }
  if (bundle.settings) await db.settings.put(bundle.settings)
  await db.courses.bulkPut(bundle.courses ?? [])
  await db.events.bulkPut(bundle.events ?? [])
  await db.homework.bulkPut(bundle.homework ?? [])
  await db.templates.bulkPut(bundle.templates ?? [])
  await db.notes.bulkPut(bundle.notes ?? [])
  await db.docs.bulkPut(bundle.docs ?? [])
  for (const img of bundle.images ?? []) {
    try {
      const blob = await dataUrlToBlob(img.data)
      // blobs 是内联主键(keyPath:'id'),必须把 id 放进 value 里
      await db.blobs.put({
        id: img.id,
        blob,
        type: blob.type || img.type || 'application/octet-stream',
        size: blob.size,
        createdAt: Date.now(),
      })
    } catch {
      /* skip broken image */
    }
  }

  /*
   * 重建知识库切片。
   *
   * 备份里**不包含 chunks**(体积大,而且可以由 docs 重新算出来),
   * 所以导入后必须重新切分:
   *   · replace 模式前面已经把 chunks 清空了,不重建 → 知识库彻底空掉
   *   · merge 模式旧 chunks 还在,不重建 → 检索到的是导入前的旧内容
   */
  for (const doc of bundle.docs ?? []) {
    const old = await db.chunks.where('docId').equals(doc.id).toArray()
    for (const c of old) await db.chunks.delete(c.id)
    const pieces = chunkText(doc.text ?? '')
    if (!pieces.length) continue
    await db.chunks.bulkPut(
      pieces.map((p) => ({
        id: uid('chunk'),
        docId: doc.id,
        title: doc.title,
        text: p,
        courseId: doc.courseId,
        createdAt: Date.now(),
      })),
    )
  }
}

/** 清空所有数据 */
export async function wipeAll() {
  await Promise.all([
    db.courses.clear(),
    db.events.clear(),
    db.homework.clear(),
    db.templates.clear(),
    db.notes.clear(),
    db.docs.clear(),
    db.chunks.clear(),
    db.blobs.clear(),
    db.outbox.clear(),
  ])
}
