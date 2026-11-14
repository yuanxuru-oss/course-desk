import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus,
  Search,
  Pin,
  Trash2,
  Pencil,
  Sparkles,
  Image as ImageIcon,
  X,
  Loader2,
  ScanText,
  Check,
  Flag,
} from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Course, Note, Settings } from '../types'
import { db, blobUrl, deleteBlob } from '../db'
import { Card, Button, Badge, Empty, Modal, Field, Input, Textarea, Select, ImagePicker, AttachmentThumbs, Segmented, Eyebrow } from './ui'
import { upsertNote, deleteNote, uploadImage } from '../lib/actions'
import { recognizeImage } from '../lib/notify'
import { summarize } from '../lib/ai'
import { cn } from '../lib/utils'
import { EVENT_COLOR } from '../lib/event'

interface Props {
  courses: Course[]
  settings: Settings
  onToast: (text: string, type?: 'info' | 'success' | 'error') => void
}

export function NotesView({ courses, settings, onToast }: Props) {
  const notes = useLiveQuery(() => db.notes.toArray(), [], []) ?? []
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string>('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Note | null>(null)

  const allTags = useMemo(() => {
    const s = new Set<string>()
    notes.forEach((n) => n.tags.forEach((t) => s.add(t)))
    return [...s]
  }, [notes])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return notes
      .filter((n) => (tag ? n.tags.includes(tag) : true))
      .filter((n) =>
        q
          ? n.title.toLowerCase().includes(q) ||
            n.content.toLowerCase().includes(q) ||
            n.tags.some((t) => t.toLowerCase().includes(q))
          : true,
      )
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
  }, [notes, query, tag])

  const courseName = (id?: string) => courses.find((c) => c.id === id)?.name

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-2.5">
          <Eyebrow tone="periwi">学习伙伴</Eyebrow>
        </div>
        <h1 className="page-title">备忘录</h1>
          <p className="page-sub">
            {notes.length} 条笔记 · 保存后自动进入 AI 知识库
          </p>
        </div>
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            setEditing(null)
            setEditorOpen(true)
          }}
        >
          <Plus size={15} /> 新建
        </Button>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索标题、正文或标签"
            className="pl-9"
          />
        </div>
      </div>

      {allTags.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setTag('')}
            className={cn(
              'px-2.5 h-7 rounded-lg text-[12px] font-medium transition-colors',
              tag === '' ? 'bg-ink text-white' : 'bg-white border border-ink/10 text-ink-soft hover:bg-butter-50',
            )}
          >
            全部
          </button>
          {allTags.map((t) => (
            <button
              key={t}
              onClick={() => setTag(tag === t ? '' : t)}
              className={cn(
                'px-2.5 h-7 rounded-lg text-[12px] font-medium transition-colors',
                tag === t ? 'bg-ink text-white' : 'bg-white border border-ink/10 text-ink-soft hover:bg-butter-50',
              )}
            >
              #{t}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <Card>
          <Empty
            icon={<ImageIcon size={28} />}
            title={notes.length === 0 ? '还没有笔记' : '没有匹配的笔记'}
            description={
              notes.length === 0
                ? '支持 Markdown 文字、图片上传与拍照识别,笔记会自动进入 AI 知识库'
                : '换个关键词或标签试试'
            }
            action={
              notes.length === 0 ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setEditing(null)
                    setEditorOpen(true)
                  }}
                >
                  写第一条
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((n) => (
            <NoteCard
              key={n.id}
              note={n}
              courseName={courseName(n.courseId)}
              onEdit={() => {
                setEditing(n)
                setEditorOpen(true)
              }}
            />
          ))}
        </div>
      )}

      <NoteDialog
        open={editorOpen}
        note={editing}
        courses={courses}
        settings={settings}
        onClose={() => setEditorOpen(false)}
        onToast={onToast}
        onSave={async (n) => {
          await upsertNote(n)
          onToast('已保存,并已加入 AI 知识库', 'success')
        }}
        onDelete={async (id) => {
          await deleteNote(id)
          onToast('笔记已删除', 'success')
        }}
      />
    </div>
  )
}

function NoteCard({ note, courseName, onEdit }: { note: Note; courseName?: string; onEdit: () => void }) {
  const [preview, setPreview] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    Promise.all(note.images.slice(0, 3).map((i) => blobUrl(i))).then((u) => {
      if (alive) setPreview(u.filter(Boolean) as string[])
    })
    return () => {
      alive = false
    }
  }, [note.images])

  const excerpt = note.content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/[#*>`_\[\]()!|—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 110)

  return (
    <div
      onClick={onEdit}
      className={cn(
        'bg-white rounded-2xl border border-ink/10/80 shadow-card p-4 cursor-pointer hover:shadow-float transition-all group relative',
        note.pinned && 'ring-2 ring-butter-300',
      )}
    >
      {note.pinned && (
        <Pin size={13} className="absolute top-3.5 right-3.5 text-tangerine-500 fill-tangerine-500" />
      )}
      <div className="flex items-center gap-2 mb-1.5 pr-5">
        <h3 className="font-semibold text-ink text-[14px] truncate">{note.title || '未命名'}</h3>
      </div>
      {courseName && <Badge className="mb-2">{courseName}</Badge>}
      {note.tags.includes('行程') && (
        <div
          className="inline-flex items-center gap-1 text-[10.5px] font-bold px-1.5 py-0.5 rounded-md mb-2"
          style={{ background: `${EVENT_COLOR}1f`, color: EVENT_COLOR, border: `1.5px solid ${EVENT_COLOR}45` }}
        >
          <Flag size={10} /> 由行程同步
        </div>
      )}
      {preview.length > 0 && (
        <div className="flex gap-1.5 mb-2">
          {preview.map((url, i) => (
            <img key={i} src={url} alt="" className="w-14 h-14 object-cover rounded-lg border border-ink/[0.08]" />
          ))}
        </div>
      )}
      <p className="text-[12.5px] text-ink-soft leading-relaxed line-clamp-3">{excerpt || '(空笔记)'}</p>
      {note.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2.5">
          {note.tags.map((t) => (
            <span key={t} className="text-[10.5px] px-1.5 py-0.5 rounded bg-butter-100 text-ink-soft">
              #{t}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 pt-2.5 border-t border-ink/[0.08] flex items-center justify-between text-[11px] text-ink-mute">
        <span>{new Date(note.updatedAt).toLocaleDateString('zh-CN')}</span>
        <Pencil size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  )
}

function NoteDialog({
  open,
  note,
  courses,
  settings,
  onClose,
  onSave,
  onDelete,
  onToast,
}: {
  open: boolean
  note: Note | null
  courses: Course[]
  settings: Settings
  onClose: () => void
  onSave: (n: Partial<Note> & { title: string }) => Promise<void> | void
  onDelete: (id: string) => Promise<void> | void
  onToast: (t: string, type?: 'info' | 'success' | 'error') => void
}) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [courseId, setCourseId] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [ocrState, setOcrState] = useState<{ running: boolean; progress: number }>({ running: false, progress: 0 })
  const [summary, setSummary] = useState('')
  const [summarizing, setSummarizing] = useState(false)
  const [saving, setSaving] = useState(false)
  /*
   * 弹窗关闭后 OCR 可能还在跑。用一个「打开次数」的 ref 判断这次结果
   * 还该不该写进界面 —— 否则会出现「提示文字已插入正文,
   * 但其实已经关了弹窗、文字谁也没进」的假成功。
   */
  const sessionRef = useRef(0)

  useEffect(() => {
    if (!open) return
    sessionRef.current += 1
    setTitle(note?.title ?? '')
    setContent(note?.content ?? '')
    setCourseId(note?.courseId ?? '')
    setTags(note?.tags ?? [])
    setImages(note?.images ?? [])
    setSummary('')
    setMode('edit')
  }, [open, note])

  const runOcr = async (files: File[]) => {
    const session = sessionRef.current
    const alive = () => sessionRef.current === session
    setOcrState({ running: true, progress: 0 })
    try {
      const texts: string[] = []
      for (const f of files) {
        const text = await recognizeImage(f, settings.ocrLang, (p) => {
          if (alive()) setOcrState({ running: true, progress: p })
        })
        if (text) texts.push(text)
      }
      const ids = await Promise.all(files.map((f) => uploadImage(f)))
      if (!alive()) {
        // 弹窗已经关了(或换了笔记):回收刚上传的图片,别留孤儿 blob
        for (const id of ids) await deleteBlob(id).catch(() => {})
        return
      }
      setImages((prev) => [...prev, ...ids])
      if (texts.length) {
        setContent((prev) => (prev ? `${prev}\n\n${texts.join('\n\n')}` : texts.join('\n\n')))
        onToast('识别完成,文字已插入正文', 'success')
      } else {
        onToast('图片已插入,但没识别出文字', 'info')
      }
    } catch (err: any) {
      if (alive()) onToast(`识别失败:${err?.message ?? err}`, 'error')
    } finally {
      if (alive()) setOcrState({ running: false, progress: 0 })
    }
  }

  const runSummarize = async () => {
    if (!content.trim()) return
    if (!settings.ai.apiKey) {
      onToast('请先在「设置 → AI 助手」里配置 API Key', 'error')
      return
    }
    setSummarizing(true)
    try {
      const out = await summarize(settings.ai, content, title)
      setSummary(out)
      setMode('preview')
      onToast('总结完成', 'success')
    } catch (err: any) {
      onToast(`总结失败:${err?.message ?? err}`, 'error')
    } finally {
      setSummarizing(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={note ? '编辑笔记' : '新建笔记'}
      footer={
        <>
          {note && (
            <Button
              variant="ghost"
              className="mr-auto text-cherry-500 hover:bg-cherry-500/10"
              onClick={() => {
                onDelete(note.id)
                onClose()
              }}
            >
              <Trash2 size={15} /> 删除
            </Button>
          )}
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            disabled={saving || ocrState.running}
            onClick={async () => {
              if (!title.trim() && !content.trim()) return
              setSaving(true)
              try {
                await onSave({
                  id: note?.id,
                  title: title.trim() || '未命名笔记',
                  content,
                  // 传 null 才是「清空所属课程」;undefined 会被当成没改
                  courseId: courseId || (null as any),
                  tags,
                  images,
                  pinned: note?.pinned ?? false,
                })
                onClose()
              } catch (err: any) {
                onToast(`保存失败:${err?.message ?? err}`, 'error')
              } finally {
                setSaving(false)
              }
            }}
          >
            {ocrState.running ? '识别中…' : saving ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-2 items-center">
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="标题"
            className="flex-1 font-medium"
          />
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'edit', label: '编辑' },
              { value: 'preview', label: '预览' },
            ]}
          />
        </div>

        {mode === 'edit' ? (
          <Textarea
            rows={12}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={'支持 Markdown。\n\n# 标题\n- 列表\n**加粗**\n\n也可以直接拍照识别讲义,文字会自动插入这里。'}
            className="font-mono text-[13px]"
          />
        ) : (
          <div className="border border-ink/10 rounded-xl p-4 min-h-[240px] max-h-[52vh] overflow-y-auto">
            {summary ? <PreMarkdown text={summary} /> : <PreMarkdown text={content || '_（空笔记）_'} />}
            {summary && (
              <div className="mt-4 pt-3 border-t border-ink/10">
                <div className="text-[11px] text-ink-mute mb-1.5">原文</div>
                <PreMarkdown text={content} />
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <ImagePicker onFiles={(files) => runOcr(files)} label="拍照/上传图片并识别文字" />
          <Button
            size="sm"
            onClick={runSummarize}
            disabled={summarizing || !content.trim()}
          >
            {summarizing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} AI 总结
          </Button>
          {ocrState.running && (
            <span className="text-[12px] text-ink-soft self-center">
              识别中 {Math.round(ocrState.progress * 100)}%
            </span>
          )}
        </div>

        {images.length > 0 && (
          <AttachmentThumbs
            ids={images}
            onRemove={(id) => {
              setImages((prev) => prev.filter((x) => x !== id))
              deleteBlob(id).catch(() => {})
            }}
          />
        )}

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="关联课程">
            <Select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">不关联</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="标签">
            <div className="flex gap-2">
              <Input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                placeholder="回车添加"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tagDraft.trim()) {
                    e.preventDefault()
                    const t = tagDraft.trim()
                    if (!tags.includes(t)) setTags((prev) => [...prev, t])
                    setTagDraft('')
                  }
                }}
              />
              <Button
                size="sm"
                className="shrink-0"
                onClick={() => {
                  const t = tagDraft.trim()
                  if (!t) return
                  if (!tags.includes(t)) setTags((prev) => [...prev, t])
                  setTagDraft('')
                }}
              >
                <Check size={14} />
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-butter-100 text-ink-soft"
                  >
                    #{t}
                    <button onClick={() => setTags((prev) => prev.filter((x) => x !== t))}>
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </Field>
        </div>

        {ocrState.running && (
          <div className="text-[12px] text-ink-mute flex items-center gap-1.5">
            <ScanText size={12} /> OCR 语言包已随应用打包,离线也能识别
          </div>
        )}
      </div>
    </Modal>
  )
}

/** 轻量 Markdown 预览(避免再引入依赖) */
function PreMarkdown({ text }: { text: string }) {
  const html = renderMarkdown(text)
  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderMarkdown(src: string): string {
  const lines = escapeHtml(src).split('\n')
  const out: string[] = []
  let inList = false
  let inCode = false

  for (const raw of lines) {
    if (raw.trim().startsWith('```')) {
      out.push(inCode ? '</pre>' : '<pre>')
      inCode = !inCode
      continue
    }
    if (inCode) {
      out.push(raw + '\n')
      continue
    }
    const line = raw.trimEnd()
    if (!line.trim()) {
      if (inList) {
        out.push('</ul>')
        inList = false
      }
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      if (inList) {
        out.push('</ul>')
        inList = false
      }
      const lvl = h[1].length
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`)
      continue
    }
    const li = line.match(/^[-*+]\s+(.*)$/)
    if (li) {
      if (!inList) {
        out.push('<ul>')
        inList = true
      }
      out.push(`<li>${inline(li[1])}</li>`)
      continue
    }
    if (inList) {
      out.push('</ul>')
      inList = false
    }
    const quote = line.match(/^&gt;\s?(.*)$/)
    if (quote) {
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`)
      continue
    }
    out.push(`<p>${inline(line)}</p>`)
  }
  if (inList) out.push('</ul>')
  if (inCode) out.push('</pre>')
  return out.join('\n')
}

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
}
