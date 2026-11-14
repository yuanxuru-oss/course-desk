import Dexie, { type Table } from 'dexie'
import type {
  Course,
  CourseEvent,
  Homework,
  HomeworkTemplate,
  Note,
  KnowledgeDoc,
  KnowledgeChunk,
  Settings,
  OutboxRecord,
} from './types'

/**
 * blobs 表里存的东西。
 *
 * 注意:blobs 用的是 keyPath: 'id' 的**内联主键**,所以 put 的时候不能再传第二个参数
 * (行外主键会被忽略,然后浏览器去找 value.id —— Blob 上没有这个属性,直接 DataError)。
 * 因此必须把 Blob 包进一个带 id 的对象里再存。
 */
export interface StoredBlob {
  id: string
  blob: Blob
  type: string
  size: number
  createdAt: number
}

export class CourseDeskDB extends Dexie {
  courses!: Table<Course, string>
  events!: Table<CourseEvent, string>
  homework!: Table<Homework, string>
  templates!: Table<HomeworkTemplate, string>
  notes!: Table<Note, string>
  docs!: Table<KnowledgeDoc, string>
  chunks!: Table<KnowledgeChunk, string>
  blobs!: Table<StoredBlob, string>
  settings!: Table<Settings, string>
  outbox!: Table<OutboxRecord, string>

  constructor() {
    super('course-desk')
    this.version(1).stores({
      courses: 'id, name, weekday, period, updatedAt',
      homework: 'id, courseId, dueAt, done, templateId, week, updatedAt',
      templates: 'id, courseId, weekday',
      notes: 'id, courseId, pinned, updatedAt',
      docs: 'id, courseId, kind, noteId, createdAt',
      chunks: 'id, docId, courseId',
      blobs: 'id',
      settings: 'id',
      outbox: 'id, fireAt, sentAt',
    })
    // v2:新增「行程」表(课程之外的校园活动)
    this.version(2).stores({
      courses: 'id, name, weekday, period, updatedAt',
      events: 'id, date, kind, weekly, updatedAt',
      homework: 'id, courseId, dueAt, done, templateId, week, updatedAt',
      templates: 'id, courseId, weekday',
      notes: 'id, courseId, pinned, updatedAt',
      docs: 'id, courseId, kind, noteId, createdAt',
      chunks: 'id, docId, courseId',
      blobs: 'id',
      settings: 'id',
      outbox: 'id, fireAt, sentAt',
    })
  }
}

export const db = new CourseDeskDB()

export const uid = (prefix = 'id'): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`

/** 把 Blob 存进数据库并返回 id */
export async function saveBlob(blob: Blob): Promise<string> {
  const id = uid('blob')
  await db.blobs.put({
    id,
    blob,
    type: blob.type || 'application/octet-stream',
    size: blob.size,
    createdAt: Date.now(),
  })
  return id
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  const rec = await db.blobs.get(id)
  if (!rec) return undefined
  // 兼容早期错误写法存进去的裸 Blob
  return rec instanceof Blob ? rec : rec.blob
}

const urlCache = new Map<string, string>()

/** 取 Blob 的临时 objectURL(带缓存,避免反复创建) */
export async function blobUrl(id: string): Promise<string | undefined> {
  const cached = urlCache.get(id)
  if (cached) return cached
  const blob = await getBlob(id)
  if (!blob) return undefined
  const url = URL.createObjectURL(blob)
  urlCache.set(id, url)
  return url
}

export function revokeBlobUrl(id: string) {
  const url = urlCache.get(id)
  if (url) {
    URL.revokeObjectURL(url)
    urlCache.delete(id)
  }
}

export async function deleteBlob(id: string) {
  revokeBlobUrl(id)
  await db.blobs.delete(id)
}

/** 估算本地存储用量 */
export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null
  const est = await navigator.storage.estimate()
  return { usage: est.usage ?? 0, quota: est.quota ?? 0 }
}
