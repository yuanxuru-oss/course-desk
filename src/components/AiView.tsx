import { useMemo, useRef, useState } from 'react'
import {
  Send,
  Sparkles,
  Library,
  Upload,
  Loader2,
  FileText,
  Search,
  Trash2,
  Database,
  AlertCircle,
} from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Course, Settings } from '../types'
import { db } from '../db'
import { Card, Button, Badge, Empty, Input, Textarea, Select, Eyebrow } from './ui'
import { indexDocument, reindexEmbeddings, deleteDoc, reindexNotes } from '../lib/actions'
import { searchChunks, buildContext, type SearchHit } from '../lib/knowledge'
import { chat, embed } from '../lib/ai'
import { recognizeImage, extractPdfText } from '../lib/notify'
import { cn } from '../lib/utils'

interface Props {
  courses: Course[]
  settings: Settings
  onToast: (text: string, type?: 'info' | 'success' | 'error') => void
}

interface Msg {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: { title: string; text: string }[]
  local?: boolean
}

export function AiView({ courses, settings, onToast }: Props) {
  const docs = useLiveQuery(() => db.docs.toArray(), [], []) ?? []
  const chunks = useLiveQuery(() => db.chunks.toArray(), [], []) ?? []
  const notes = useLiveQuery(() => db.notes.toArray(), [], []) ?? []

  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [useRag, setUseRag] = useState(true)
  const [courseFilter, setCourseFilter] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const hasApi = !!settings.ai.apiKey
  const hasEmbed = !!settings.ai.embedModel

  const vectorized = chunks.filter((c) => c.embedding?.length).length

  const ask = async () => {
    const q = input.trim()
    if (!q || busy) return
    setInput('')
    setMessages((m) => [...m, { id: `u_${Date.now()}`, role: 'user', content: q }])
    setBusy(true)

    try {
      const pool = courseFilter ? chunks.filter((c) => !c.courseId || c.courseId === courseFilter) : chunks
      let hits: SearchHit[] = []
      let queryEmbedding: number[] | undefined

      if (hasEmbed) {
        try {
          queryEmbedding = await embed(settings.ai, q)
        } catch {
          /* 降级为关键词检索 */
        }
      }
      hits = await searchChunks(q, pool, { topK: 6, queryEmbedding })

      if (!hasApi) {
        const local = hits.length
          ? `未配置 AI 接口,以下是你资料里与问题最相关的片段:\n\n${hits
              .map((h, i) => `[${i + 1}] ${h.chunk.title}\n${h.chunk.text}`)
              .join('\n\n')}`
          : '未配置 AI 接口,且知识库里没找到相关内容。到「设置 → AI 助手」填入 API Key 后可以获得完整回答。'
        setMessages((m) => [
          ...m,
          {
            id: `a_${Date.now()}`,
            role: 'assistant',
            content: local,
            sources: hits.map((h) => ({ title: h.chunk.title, text: h.chunk.text })),
            local: true,
          },
        ])
        return
      }

      const context = useRag ? buildContext(hits) : ''
      const system = [
        '你是一名严谨的大学生学习助手,基于用户自己的课程资料回答问题。',
        '规则:只依据提供的资料回答;资料里没有的内容要明确说"资料中没有提到";',
        '不要编造出处;引用时用 [片段 N] 标注来源;回答用简体中文,尽量简洁有条理。',
        context ? `\n\n以下是用户的资料片段:\n${context}` : '\n\n(本次未检索资料,请直接回答通用问题,并提示用户可在左侧添加资料。)',
      ].join('')

      const answer = await chat(
        settings.ai,
        [
          { role: 'system', content: system },
          ...messages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
          { role: 'user', content: q },
        ],
        { temperature: 0.3 },
      )

      setMessages((m) => [
        ...m,
        {
          id: `a_${Date.now()}`,
          role: 'assistant',
          content: answer,
          sources: hits.map((h) => ({ title: h.chunk.title, text: h.chunk.text })),
        },
      ])
    } catch (err: any) {
      setMessages((m) => [
        ...m,
        { id: `a_${Date.now()}`, role: 'assistant', content: `出错了:${err?.message ?? err}`, },
      ])
      onToast(err?.message ?? '请求失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const upload = async (files: File[]) => {
    for (const f of files) {
      try {
        let text = ''
        let kind: 'upload' | 'ocr' = 'upload'
        if (f.type.startsWith('image/')) {
          kind = 'ocr'
          text = await recognizeImage(f, settings.ocrLang, (p) =>
            onToast(`识别中 ${Math.round(p * 100)}%`, 'info'),
          )
        } else if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
          text = await extractPdfText(f)
        } else {
          text = await f.text()
        }
        if (!text.trim()) {
          onToast(`${f.name} 没提取到文字`, 'error')
          continue
        }
        await indexDocument({ title: f.name.replace(/\.[^.]+$/, ''), text, kind })
        onToast(`已加入知识库:${f.name}`, 'success')
      } catch (err: any) {
        onToast(`${f.name} 处理失败:${err?.message ?? err}`, 'error')
      }
    }
  }

  const suggested = useMemo(
    () => [
      '这学期的重点难点是什么?',
      '把老师反复强调的考点整理出来',
      '帮我理一下这周的复习计划',
    ],
    [],
  )

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-2.5">
          <Eyebrow tone="butter">学习伙伴</Eyebrow>
        </div>
        <h1 className="page-title">AI 助手</h1>
        <p className="page-sub">基于你自己的笔记、课件和讲义回答问题</p>
      </div>

      {!hasApi && (
        <div className="rounded-2xl bg-butter-100 border border-ink/10 p-3.5 flex gap-2.5">
          <AlertCircle size={16} className="text-tangerine-600 shrink-0 mt-0.5" />
          <div className="text-[13px] text-ink leading-relaxed">
            <div className="font-medium mb-0.5">还没配置 AI 接口</div>
            现在可以用「本地检索模式」直接从你的资料里找相关段落。到
            <a href="#/settings" className="underline font-medium mx-0.5">设置 → AI 助手</a>
            填入 API Key 后就能得到完整的问答。
            <div className="mt-1.5">
              <a
                href="#/settings"
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-tangerine-700 underline decoration-dotted underline-offset-2"
              >
                不知道怎么填?设置里有 1 分钟配置指引 →
              </a>
            </div>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-[280px_1fr] gap-4 items-start">
        {/* 知识库侧栏 */}
        <div className="space-y-3">
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-ink/[0.08] flex items-center gap-2">
              <Library size={15} className="text-ink-mute" />
              <h3 className="font-semibold text-ink text-[14px]">知识库</h3>
            </div>
            <div className="p-4 space-y-2.5 text-[13px]">
              <StatRow icon={<FileText size={13} />} label="资料" value={`${docs.length} 份`} />
              <StatRow icon={<Database size={13} />} label="检索切片" value={`${chunks.length} 条`} />
              <StatRow
                icon={<Sparkles size={13} />}
                label="向量索引"
                value={hasEmbed ? `${vectorized}/${chunks.length}` : '未启用(关键词检索)'}
              />
              <StatRow icon={<Search size={13} />} label="笔记" value={`${notes.length} 条`} />
            </div>
            <div className="px-4 pb-4 space-y-2">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".pdf,.txt,.md,image/*"
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? [])
                  if (files.length) upload(files)
                  e.target.value = ''
                }}
              />
              <Button size="sm" className="w-full" onClick={() => fileRef.current?.click()}>
                <Upload size={14} /> 上传资料
              </Button>
              <p className="text-[11px] text-ink-mute leading-relaxed">
                支持 PDF、TXT、Markdown 与图片(自动 OCR)。上传的内容会切片后进入检索索引。
              </p>
              {hasEmbed && chunks.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full"
                  onClick={async () => {
                    setBusy(true)
                    const r = await reindexEmbeddings(settings)
                    onToast(`向量重建完成,成功 ${r.done} 条,失败 ${r.failed} 条`, r.failed ? 'info' : 'success')
                    setBusy(false)
                  }}
                >
                  重建向量索引
                </Button>
              )}
              {notes.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full"
                  onClick={async () => {
                    setBusy(true)
                    const n = await reindexNotes(settings)
                    onToast(`已重建 ${n} 条笔记的知识库索引`, 'success')
                    setBusy(false)
                  }}
                >
                  重建笔记索引
                </Button>
              )}
            </div>
          </Card>

          {docs.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-ink/[0.08] text-[14px] font-semibold text-ink">
                资料列表
              </div>
              <div className="max-h-72 overflow-y-auto divide-y-2 divide-ink/[0.06]">
                {docs.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 px-4 py-2.5 group">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-ink-soft truncate">{d.title}</div>
                      <div className="text-[10.5px] text-ink-mute">
                        {d.kind === 'ocr' ? '图片识别' : d.kind === 'note' ? '笔记' : '上传'} ·{' '}
                        {d.text.length} 字
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        await deleteDoc(d.id)
                        onToast('已从知识库移除', 'success')
                      }}
                      className="p-1.5 text-ink-mute hover:text-cherry-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* 对话区 */}
        <Card className="overflow-hidden flex flex-col min-h-[560px]">
          <div className="px-4 py-3 border-b border-ink/[0.08] flex items-center gap-3 flex-wrap">
            <h3 className="font-semibold text-ink text-[14px]">问答</h3>
            <div className="ml-auto flex items-center gap-2">
              <Select
                value={courseFilter}
                onChange={(e) => setCourseFilter(e.target.value)}
                className="h-8 text-[12px] w-auto"
              >
                <option value="">全部课程</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-1.5 text-[12px] text-ink-soft cursor-pointer">
                <input
                  type="checkbox"
                  checked={useRag}
                  onChange={(e) => setUseRag(e.target.checked)}
                  className="accent-tangerine-500"
                />
                检索增强
              </label>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-10">
                <div className="w-12 h-12 rounded-2xl bg-tangerine-50 text-tangerine-600 grid place-items-center mb-3">
                  <Sparkles size={22} />
                </div>
                <p className="text-ink-soft font-medium text-[14px]">问我任何关于你课程资料的问题</p>
                <p className="text-[12.5px] text-ink-mute mt-1 max-w-xs leading-relaxed">
                  回答只依据你自己的笔记和课件,不会凭空编造。
                </p>
                <div className="mt-5 flex flex-col gap-2 w-full max-w-sm">
                  {suggested.map((s) => (
                    <button
                      key={s}
                      onClick={() => setInput(s)}
                      className="text-left px-3 py-2 rounded-xl border border-ink/10 text-[13px] text-ink-soft hover:border-tangerine-300 hover:bg-tangerine-50/50 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={cn('flex gap-3', m.role === 'user' && 'flex-row-reverse')}>
                  <div
                    className={cn(
                      'w-7 h-7 rounded-lg shrink-0 grid place-items-center text-[11px] font-semibold',
                      m.role === 'user' ? 'bg-butter-200 text-ink-soft' : 'bg-tangerine-500 text-white',
                    )}
                  >
                    {m.role === 'user' ? '我' : 'AI'}
                  </div>
                  <div className={cn('max-w-[85%] min-w-0', m.role === 'user' && 'flex flex-col items-end')}>
                    <div
                      className={cn(
                        'rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap break-words',
                        m.role === 'user'
                          ? 'bg-tangerine-500 text-white rounded-tr-sm'
                          : 'bg-butter-100 text-ink rounded-tl-sm',
                      )}
                    >
                      {m.content}
                    </div>
                    {m.sources && m.sources.length > 0 && (
                      <div className="mt-2 w-full">
                        <div className="text-[11px] text-ink-mute mb-1">引用片段</div>
                        <div className="space-y-1">
                          {m.sources.map((s, i) => (
                            <details
                              key={i}
                              className="bg-white border border-ink/10 rounded-lg px-2.5 py-1.5 text-[11.5px] text-ink-soft"
                            >
                              <summary className="cursor-pointer text-ink-soft font-medium truncate">
                                [{i + 1}] {s.title}
                              </summary>
                              <p className="mt-1.5 leading-relaxed whitespace-pre-wrap">{s.text.slice(0, 400)}</p>
                            </details>
                          ))}
                        </div>
                      </div>
                    )}
                    {m.local && (
                      <Badge className="mt-1.5">本地检索模式</Badge>
                    )}
                  </div>
                </div>
              ))
            )}
            {busy && (
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-lg bg-tangerine-500 text-white grid place-items-center text-[11px] font-semibold">
                  AI
                </div>
                <div className="flex items-center gap-2 text-[13px] text-ink-mute">
                  <Loader2 size={14} className="animate-spin" /> 正在思考…
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-ink/[0.08] p-3">
            <div className="flex gap-2 items-end">
              <Textarea
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    ask()
                  }
                }}
                placeholder="问点什么…(Ctrl/⌘ + Enter 发送)"
                className="flex-1"
              />
              <Button variant="primary" onClick={ask} disabled={busy || !input.trim()} className="shrink-0">
                <Send size={15} />
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

function StatRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-ink-soft">
      <span className="text-ink-mute">{icon}</span>
      <span>{label}</span>
      <span className="ml-auto text-ink-soft font-medium text-[12px]">{value}</span>
    </div>
  )
}
