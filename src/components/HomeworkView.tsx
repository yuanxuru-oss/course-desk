import { useMemo, useState } from 'react'
import {
  Plus,
  CheckCircle2,
  Circle,
  Clock,
  Trash2,
  Repeat,
  Pencil,
  Paperclip,
  ListChecks,
  AlertCircle,
} from 'lucide-react'
import type { Course, Homework, HomeworkTemplate, Settings } from '../types'
import { Card, Button, Badge, Empty, Modal, Field, Input, Textarea, Select, Tabs, ImagePicker, AttachmentThumbs, Eyebrow } from './ui'
import { upsertHomework, deleteHomework, toggleHomework, upsertTemplate, deleteTemplate } from '../lib/actions'
import { uploadImage } from '../lib/actions'
import { blobUrl } from '../db'
import { deleteBlob } from '../db'
import { useEffect } from 'react'
import { countdown, WEEKDAY_CN, hhmmToMinutes } from '../lib/time'
import { cn } from '../lib/utils'

interface Props {
  courses: Course[]
  homework: Homework[]
  templates: HomeworkTemplate[]
  settings: Settings
  onToast: (text: string, type?: 'info' | 'success' | 'error') => void
}

type Tab = 'todo' | 'done' | 'template'

export function HomeworkView({ courses, homework, templates, settings, onToast }: Props) {
  const [tab, setTab] = useState<Tab>('todo')
  const [editing, setEditing] = useState<Homework | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [tplOpen, setTplOpen] = useState(false)

  const now = Date.now()
  const courseName = (id?: string) => courses.find((c) => c.id === id)?.name

  const groups = useMemo(() => {
    const startOfToday = new Date(now)
    startOfToday.setHours(0, 0, 0, 0)
    const endOfToday = new Date(now)
    endOfToday.setHours(23, 59, 59, 999)
    const endOfWeek = endOfToday.getTime() + 6 * 864e5

    const todo = homework.filter((h) => !h.done)
    return {
      overdue: todo.filter((h) => h.dueAt && h.dueAt < startOfToday.getTime()),
      today: todo.filter((h) => h.dueAt && h.dueAt >= startOfToday.getTime() && h.dueAt <= endOfToday.getTime()),
      week: todo.filter((h) => h.dueAt && h.dueAt > endOfToday.getTime() && h.dueAt <= endOfWeek),
      later: todo.filter((h) => !h.dueAt || h.dueAt > endOfWeek),
      done: homework.filter((h) => h.done),
    }
  }, [homework, now])

  const openNew = () => {
    setEditing(null)
    setEditorOpen(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-2.5">
          <Eyebrow tone="grass">学习伙伴</Eyebrow>
        </div>
        <h1 className="page-title">作业</h1>
          <p className="page-sub">
            共 {groups.overdue.length + groups.today.length + groups.week.length + groups.later.length} 项待办
            {groups.overdue.length > 0 && <span className="text-cherry-500 font-medium"> · {groups.overdue.length} 项逾期</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setTplOpen(true)}>
            <Repeat size={14} /> 每周固定
          </Button>
          <Button size="sm" variant="primary" onClick={openNew}>
            <Plus size={15} /> 添加
          </Button>
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'todo', label: '待办', count: groups.overdue.length + groups.today.length + groups.week.length + groups.later.length },
          { value: 'done', label: '已完成', count: groups.done.length },
          { value: 'template', label: '每周模板', count: templates.length },
        ]}
      />

      {tab === 'todo' && (
        <div className="space-y-4">
          {groups.overdue.length > 0 && (
            <Group title="已逾期" tone="danger" count={groups.overdue.length}>
              {groups.overdue.map((h) => (
                <HwRow key={h.id} hw={h} courseName={courseName(h.courseId)} onToast={onToast} onEdit={() => { setEditing(h); setEditorOpen(true) }} />
              ))}
            </Group>
          )}
          {groups.today.length > 0 && (
            <Group title="今天" tone="warn" count={groups.today.length}>
              {groups.today.map((h) => (
                <HwRow key={h.id} hw={h} courseName={courseName(h.courseId)} onToast={onToast} onEdit={() => { setEditing(h); setEditorOpen(true) }} />
              ))}
            </Group>
          )}
          {groups.week.length > 0 && (
            <Group title="本周内" count={groups.week.length}>
              {groups.week.map((h) => (
                <HwRow key={h.id} hw={h} courseName={courseName(h.courseId)} onToast={onToast} onEdit={() => { setEditing(h); setEditorOpen(true) }} />
              ))}
            </Group>
          )}
          {groups.later.length > 0 && (
            <Group title="以后" count={groups.later.length}>
              {groups.later.map((h) => (
                <HwRow key={h.id} hw={h} courseName={courseName(h.courseId)} onToast={onToast} onEdit={() => { setEditing(h); setEditorOpen(true) }} />
              ))}
            </Group>
          )}
          {groups.overdue.length + groups.today.length + groups.week.length + groups.later.length === 0 && (
            <Card>
              <Empty
                icon={<ListChecks size={30} />}
                title="没有待办作业"
                description="添加一项作业,或者用「每周固定」设定自动重复的周作业"
                action={
                  <Button variant="primary" size="sm" onClick={openNew}>
                    添加作业
                  </Button>
                }
              />
            </Card>
          )}
        </div>
      )}

      {tab === 'done' && (
        <Card className="overflow-hidden">
          {groups.done.length === 0 ? (
            <Empty title="还没有完成的作业" />
          ) : (
            <div className="divide-y-2 divide-ink/[0.06]">
              {groups.done
                .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))
                .map((h) => (
                  <HwRow key={h.id} hw={h} courseName={courseName(h.courseId)} onToast={onToast} onEdit={() => { setEditing(h); setEditorOpen(true) }} />
                ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'template' && (
        <div className="space-y-3">
          <div className="rounded-xl bg-butter-100 border-2 border-ink/[0.08] p-3.5 text-[13px] text-ink-soft leading-relaxed">
            <strong>每周固定</strong>用来设定「每周五交周记」这类周期性作业。系统会自动把模板滚动生成本周及以后的具体待办,
            勾选完成后下一周自动生成新的,不用每周手填。
          </div>
          {templates.length === 0 ? (
            <Card>
              <Empty
                icon={<Repeat size={28} />}
                title="还没有每周模板"
                description="设定一次,以后每周自动出现"
                action={
                  <Button variant="primary" size="sm" onClick={() => setTplOpen(true)}>
                    新建每周模板
                  </Button>
                }
              />
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="divide-y-2 divide-ink/[0.06]">
                {templates.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="w-9 h-9 rounded-xl bg-butter-100 text-ink-soft grid place-items-center shrink-0">
                      <Repeat size={15} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-ink truncate">{t.title}</div>
                      <div className="text-[11px] text-ink-mute truncate">
                        每周{WEEKDAY_CN[t.weekday - 1]} {t.timeOfDay} 截止 · 第{t.startWeek}-{t.endWeek} 周
                        {t.courseId ? ` · ${courseName(t.courseId)}` : ''}
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        await deleteTemplate(t.id)
                        onToast('模板已删除', 'success')
                      }}
                      className="p-2 text-ink-mute hover:text-cherry-500 transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      <HomeworkDialog
        open={editorOpen}
        homework={editing}
        courses={courses}
        settings={settings}
        onToast={onToast}
        onClose={() => setEditorOpen(false)}
        onSave={async (h) => {
          await upsertHomework(h)
          onToast('作业已保存', 'success')
        }}
        onDelete={async (id) => {
          await deleteHomework(id)
          onToast('作业已删除', 'success')
        }}
      />

      <TemplateDialog
        open={tplOpen}
        courses={courses}
        settings={settings}
        onClose={() => setTplOpen(false)}
        onSave={async (t) => {
          await upsertTemplate(t)
          onToast('每周模板已保存,将自动生成待办', 'success')
        }}
      />
    </div>
  )
}

/* ---------------- 分组 ---------------- */
function Group({
  title,
  tone,
  count,
  children,
}: {
  title: string
  tone?: 'danger' | 'warn'
  count: number
  children: React.ReactNode
}) {
  const toneClass =
    tone === 'danger' ? 'text-cherry-500' : tone === 'warn' ? 'text-tangerine-600' : 'text-ink-soft'
  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-2.5 border-b border-ink/[0.08] flex items-center gap-2">
        <span className={cn('text-[13px] font-semibold', toneClass)}>{title}</span>
        <span className="text-[11px] text-ink-mute">{count}</span>
      </div>
      <div className="divide-y-2 divide-ink/[0.06]">{children}</div>
    </Card>
  )
}

/* ---------------- 单行 ---------------- */
function HwRow({
  hw,
  courseName,
  onToast,
  onEdit,
}: {
  hw: Homework
  courseName?: string
  onToast: (t: string, type?: 'info' | 'success' | 'error') => void
  onEdit: () => void
}) {
  const [busy, setBusy] = useState(false)
  const overdue = !hw.done && hw.dueAt && hw.dueAt < Date.now()

  return (
    <div className="flex items-center gap-3 px-4 py-3 group">
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          await toggleHomework(hw.id)
          setBusy(false)
        }}
        aria-label={hw.done ? '标记为未完成' : '标记为已完成'}
        title={hw.done ? '标记为未完成' : '标记为已完成'}
        className="shrink-0 text-ink-mute hover:text-grass-500 transition-colors"
      >
        {hw.done ? <CheckCircle2 size={20} className="text-grass-500" /> : <Circle size={20} />}
      </button>
      <button onClick={onEdit} className="min-w-0 flex-1 text-left">
        <div className={cn('text-sm truncate', hw.done ? 'text-ink-mute line-through' : 'text-ink')}>
          {hw.title}
        </div>
        <div className="flex items-center flex-wrap gap-x-2.5 gap-y-1 mt-0.5 text-[11px] text-ink-mute">
          {courseName && <span>{courseName}</span>}
          {hw.dueAt && (
            <span className={cn('inline-flex items-center gap-1', overdue && 'text-cherry-500 font-medium')}>
              <Clock size={10} />
              {new Date(hw.dueAt).getMonth() + 1}/{new Date(hw.dueAt).getDate()}{' '}
              {new Date(hw.dueAt).getHours()}:
              {String(new Date(hw.dueAt).getMinutes()).padStart(2, '0')}
              {!hw.done && <span className="text-ink-mute">· {countdown(hw.dueAt)}</span>}
            </span>
          )}
          {hw.attachments.length > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <Paperclip size={10} /> {hw.attachments.length}
            </span>
          )}
          {hw.priority === 2 && !hw.done && (
            <span className="inline-flex items-center gap-0.5 text-cherry-500">
              <AlertCircle size={10} /> 重要
            </span>
          )}
        </div>
      </button>
      <button
        onClick={onEdit}
        className="shrink-0 p-1.5 text-ink-mute opacity-0 group-hover:opacity-100 hover:text-ink-soft transition-all"
      >
        <Pencil size={14} />
      </button>
    </div>
  )
}

/* ---------------- 作业编辑 ---------------- */
function HomeworkDialog({
  open,
  homework,
  courses,
  settings,
  onClose,
  onSave,
  onDelete,
  onToast,
}: {
  open: boolean
  homework: Homework | null
  courses: Course[]
  settings: Settings
  onClose: () => void
  onSave: (h: Partial<Homework> & { title: string }) => Promise<void> | void
  onDelete: (id: string) => Promise<void> | void
  onToast?: (text: string, type?: 'info' | 'success' | 'error') => void
}) {
  const [title, setTitle] = useState('')
  const [courseId, setCourseId] = useState<string>('')
  const [detail, setDetail] = useState('')
  const [due, setDue] = useState('')
  const [priority, setPriority] = useState(1)
  const [attachments, setAttachments] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (homework) {
      setTitle(homework.title)
      setCourseId(homework.courseId ?? '')
      setDetail(homework.detail ?? '')
      // 本来没有截止时间就不要预填「明天」:用户只改个标题保存,
      // 会凭空多出一个截止时间,还可能触发提醒
      setDue(homework.dueAt ? toLocalInput(homework.dueAt) : '')
      setPriority(homework.priority)
      setAttachments(homework.attachments ?? [])
    } else {
      setTitle('')
      setCourseId('')
      setDetail('')
      setDue(defaultDue())
      setPriority(1)
      setAttachments([])
    }
  }, [open, homework])

  const submit = async () => {
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      /*
       * 用 null 表示「我要清空这个字段」。
       * 传 undefined 会被数据层当成「这次没改」,于是清空截止时间/课程/说明
       * 保存后旧值又回来了。
       */
      await onSave({
        id: homework?.id,
        title: title.trim(),
        courseId: courseId || null,
        detail: detail.trim() || null,
        dueAt: due ? new Date(due).getTime() : null,
        priority: priority as 0 | 1 | 2,
        attachments,
        done: homework?.done ?? false,
      } as any)
      onClose()
    } catch (err: any) {
      // 写库失败要留在弹窗里,不能已经关掉、输入全丢、还什么都没提示
      onToast?.(`保存失败:${err?.message ?? err}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={homework ? '编辑作业' : '添加作业'}
      footer={
        <>
          {homework && (
            <Button
              variant="ghost"
              className="mr-auto text-cherry-500 hover:bg-cherry-500/10"
              onClick={async () => {
                try {
                  await onDelete(homework.id)
                  onClose()
                } catch (err: any) {
                  onToast?.(`删除失败:${err?.message ?? err}`, 'error')
                }
              }}
            >
              <Trash2 size={15} /> 删除
            </Button>
          )}
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={submit} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="作业内容">
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如:第 5 章课后习题 1-10" />
        </Field>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="所属课程">
            <Select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">不指定</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="截止时间">
            <Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>

        <Field label="优先级">
          <Select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
            <option value={0}>普通</option>
            <option value={1}>一般</option>
            <option value={2}>重要</option>
          </Select>
        </Field>

        <Field label="详细说明">
          <Textarea rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="题目要求、提交方式、注意事项…" />
        </Field>

        <Field label="附件(可拍照上传作业/讲义)">
          <div className="space-y-2">
            <AttachmentThumbs
              ids={attachments}
              onRemove={(id) => {
                setAttachments((prev) => prev.filter((x) => x !== id))
                // 移除的图片不再被引用,顺手删掉,别让它永远占着存储
                deleteBlob(id).catch(() => {})
              }}
            />
            <ImagePicker
              onFiles={async (files) => {
                const ids = await Promise.all(files.map((f) => uploadImage(f)))
                setAttachments((prev) => [...prev, ...ids])
              }}
              label="选择图片"
            />
          </div>
        </Field>
      </div>
    </Modal>
  )
}

/* ---------------- 模板编辑 ---------------- */
function TemplateDialog({
  open,
  courses,
  settings,
  onClose,
  onSave,
}: {
  open: boolean
  courses: Course[]
  settings: Settings
  onClose: () => void
  onSave: (t: Partial<HomeworkTemplate> & { title: string }) => void
}) {
  const [title, setTitle] = useState('')
  const [courseId, setCourseId] = useState('')
  const [detail, setDetail] = useState('')
  const [weekday, setWeekday] = useState(5)
  const [timeOfDay, setTimeOfDay] = useState('23:59')
  const [startWeek, setStartWeek] = useState(1)
  const [endWeek, setEndWeek] = useState(Math.min(20, settings.weekCount))

  useEffect(() => {
    if (open) {
      setTitle('')
      setCourseId('')
      setDetail('')
      setWeekday(5)
      setTimeOfDay('23:59')
      setStartWeek(1)
      setEndWeek(Math.min(20, settings.weekCount))
    }
  }, [open, settings.weekCount])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建每周固定作业"
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!title.trim()) return
              onSave({
                title: title.trim(),
                courseId: courseId || undefined,
                detail: detail.trim() || undefined,
                weekday,
                timeOfDay,
                startWeek,
                endWeek,
                priority: 1,
              })
              onClose()
            }}
          >
            创建
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="作业内容">
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如:提交本周周记" />
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="所属课程">
            <Select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">不指定</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="每周几提交">
            <Select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
              {WEEKDAY_CN.map((w, i) => (
                <option key={w} value={i + 1}>
                  星期{w}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="截止时间">
            <Input type="time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} />
          </Field>
          <Field label="起始周">
            <Input type="number" min={1} value={startWeek} onChange={(e) => setStartWeek(Number(e.target.value))} />
          </Field>
          <Field label="结束周">
            <Input type="number" min={1} value={endWeek} onChange={(e) => setEndWeek(Number(e.target.value))} />
          </Field>
        </div>
        <Field label="说明">
          <Textarea rows={2} value={detail} onChange={(e) => setDetail(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

function toLocalInput(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function defaultDue(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(23, 59, 0, 0)
  return toLocalInput(d.getTime())
}

export { hhmmToMinutes }
