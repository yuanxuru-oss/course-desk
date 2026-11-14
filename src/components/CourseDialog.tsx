import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Trash2, AlertTriangle, Link2, Plus, X, Clock } from 'lucide-react'
import type { Course, Settings } from '../types'
import { Button, Modal, Field, Input, Select, Textarea, Badge } from './ui'
import { findConflicts, WEEKDAY_CN } from '../lib/time'
import { hashColor } from '../lib/utils'

interface Props {
  open: boolean
  course: Course | null
  allCourses: Course[]
  settings: Settings
  onClose: () => void
  onSave: (c: Partial<Course> & { name: string }) => void
  onDelete?: (id: string) => void
}

export function CourseDialog({ open, course, allCourses, settings, onClose, onSave, onDelete }: Props) {
  const [form, setForm] = useState<Course>(() => blankCourse(settings))
  const [weekMode, setWeekMode] = useState<'all' | 'odd' | 'even' | 'custom'>('all')
  const [customWeeks, setCustomWeeks] = useState<number[]>([])
  const [resources, setResources] = useState<{ title: string; url: string }[]>([])
  const [resourceDraft, setResourceDraft] = useState({ title: '', url: '' })

  useEffect(() => {
    if (!open) return
    if (course) {
      setForm({ ...course })
      const sw = course.singleWeeks
      // 期望集合要与「单/双周」实际生成的结果完全一致,只比个数会把
      // {1,4} 这种自选周次误判成双周,于是原样保存就改掉了上课周次
      const range: number[] = []
      for (let w = course.startWeek; w <= course.endWeek; w++) range.push(w)
      const odd = range.filter((w) => w % 2 === 1)
      const even = range.filter((w) => w % 2 === 0)
      const same = (a: number[], b: number[]) => a.length === b.length && a.every((w, i) => w === b[i])
      const sorted = sw?.length ? [...sw].sort((a, b) => a - b) : []
      // 无论哪条分支都要重置 customWeeks,否则会带着上一门课的勾选
      setCustomWeeks(sorted)
      if (!sw?.length) setWeekMode('all')
      else if (same(sorted, odd)) setWeekMode('odd')
      else if (same(sorted, even)) setWeekMode('even')
      else setWeekMode('custom')
      setResources(course.resources ?? [])
    } else {
      const b = blankCourse(settings)
      setForm(b)
      setWeekMode('all')
      setCustomWeeks([])
      setResources([])
    }
    setResourceDraft({ title: '', url: '' })
  }, [open, course, settings])

  const conflicts = useMemo(() => {
    if (!form.name) return []
    const probe: Course = {
      ...form,
      id: course?.id ?? '__new__',
      singleWeeks: computedWeeks(),
    }
    return findConflicts(probe, allCourses.filter((c) => c.id !== course?.id))
  }, [form, allCourses, course, weekMode, customWeeks])

  function computedWeeks(): number[] | undefined {
    if (weekMode === 'all') return undefined
    // sort 会原地改数组:customWeeks 是 state,渲染期间排序会让 React 状态被悄悄改写
    if (weekMode === 'custom') return [...customWeeks].sort((a, b) => a - b)
    const out: number[] = []
    for (let w = form.startWeek; w <= form.endWeek; w++) {
      if (weekMode === 'odd' && w % 2 === 1) out.push(w)
      if (weekMode === 'even' && w % 2 === 0) out.push(w)
    }
    return out
  }

  const set = <K extends keyof Course>(key: K, value: Course[K]) => setForm((f) => ({ ...f, [key]: value }))

  const submit = () => {
    if (!form.name.trim()) return
    onSave({
      ...form,
      name: form.name.trim(),
      singleWeeks: computedWeeks(),
      color: form.color ?? hashColor(form.name),
      resources: resources.filter((r) => r.title.trim() || r.url.trim()),
    })
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={course ? '编辑课程' : '添加课程'}
      footer={
        <>
          {course && onDelete && (
            <Button
              variant="ghost"
              className="mr-auto text-cherry-500 hover:bg-cherry-500/10"
              onClick={() => {
                onDelete(course.id)
                onClose()
              }}
            >
              <Trash2 size={15} /> 删除
            </Button>
          )}
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={submit}>
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {conflicts.length > 0 && (
          <div className="rounded-xl bg-butter-100 border border-ink/10 p-3 flex gap-2.5">
            <AlertTriangle size={16} className="text-tangerine-600 shrink-0 mt-0.5" />
            <div className="text-[13px] text-ink">
              <div className="font-medium mb-1">时间冲突</div>
              {conflicts.map((c) => (
                <div key={c.id}>
                  与「{c.name}」(星期{WEEKDAY_CN[c.weekday - 1]} 第{c.period}节)冲突
                </div>
              ))}
            </div>
          </div>
        )}

        <Field label="课程名称">
          <Input
            autoFocus
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="如:高等数学"
          />
        </Field>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="任课教师">
            <Input value={form.teacher ?? ''} onChange={(e) => set('teacher', e.target.value)} placeholder="如:张老师" />
          </Field>
          <Field label="教室">
            <Input value={form.location ?? ''} onChange={(e) => set('location', e.target.value)} placeholder="如:教三 302" />
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="校区" hint="填了才能做跨校区赶课提醒">
            <Input
              list="campus-list"
              value={form.campus ?? ''}
              onChange={(e) => set('campus', e.target.value)}
              placeholder="如:本部校区"
            />
            <datalist id="campus-list">
              <option value="本部校区" />
              <option value="新校区" />
              <option value="南校区" />
            </datalist>
          </Field>
          <Field label="教学楼" hint="用于跨楼赶课预警">
            <Input
              list="building-list"
              value={form.building ?? ''}
              onChange={(e) => set('building', e.target.value)}
              placeholder="如:第三教学楼"
            />
            <datalist id="building-list">
              <option value="第一教学楼" />
              <option value="第二教学楼" />
              <option value="第三教学楼" />
              <option value="实验楼" />
            </datalist>
          </Field>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="星期">
            <Select value={form.weekday} onChange={(e) => set('weekday', Number(e.target.value))}>
              {WEEKDAY_CN.map((w, i) => (
                <option key={w} value={i + 1}>
                  星期{w}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="开始节次">
            <Select value={form.period} onChange={(e) => set('period', Number(e.target.value))}>
              {settings.periods.map((p) => (
                <option key={p.index} value={p.index}>
                  第 {p.index} 节 ({p.start})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="连堂节数">
            <Select value={form.periods} onChange={(e) => set('periods', Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} 节
                </option>
              ))}
            </Select>
          </Field>
          {/* 选完节次,立刻看到这节课几点到几点 */}
          {(() => {
            const ps: number[] = []
            for (let i = 0; i < Math.max(1, form.periods || 1); i++) ps.push(form.period + i)
            const first = settings.periods.find((p) => p.index === ps[0])
            const last = settings.periods.find((p) => p.index === ps[ps.length - 1])
            if (!first || !last) return null
            return (
              <div className="sm:col-span-3 flex items-center gap-2 rounded-xl bg-butter-50 border-2 border-ink/[0.08] px-3 py-2">
                <Clock size={13} className="text-tangerine-600 shrink-0" />
                <span className="text-[12.5px] font-bold text-ink">
                  {first.start} – {last.end}
                </span>
                <span className="text-[11.5px] text-ink-mute">
                  第 {ps[0]}
                  {ps.length > 1 ? `-${ps[ps.length - 1]}` : ''} 节 · 按「设置 → 作息时间」自动换算
                </span>
              </div>
            )
          })()}
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="起始周">
            <Input
              type="number"
              min={1}
              max={settings.weekCount}
              value={form.startWeek}
              onChange={(e) => set('startWeek', Number(e.target.value))}
            />
          </Field>
          <Field label="结束周">
            <Input
              type="number"
              min={1}
              max={settings.weekCount}
              value={form.endWeek}
              onChange={(e) => set('endWeek', Number(e.target.value))}
            />
          </Field>
        </div>

        <Field label="上课周次">
          <div className="flex flex-wrap gap-2">
            {(
              [
                { k: 'all', l: '每周' },
                { k: 'odd', l: '单周' },
                { k: 'even', l: '双周' },
                { k: 'custom', l: '自选' },
              ] as const
            ).map((m) => (
              <button
                key={m.k}
                onClick={() => setWeekMode(m.k)}
                className={`px-3 h-9 rounded-lg text-[13px] font-medium border transition-colors ${
                  weekMode === m.k
                    ? 'border-tangerine-500 bg-tangerine-50 text-tangerine-700'
                    : 'border-ink/10 text-ink-soft hover:bg-butter-50'
                }`}
              >
                {m.l}
              </button>
            ))}
          </div>
        </Field>

        <Field
          label="本课提醒提前(分钟)"
          hint={`留空则跟随全局设置(当前 ${settings.courseLeadMinutes} 分钟)`}
        >
          <Input
            type="number"
            min={0}
            max={180}
            value={form.leadMinutes ?? ''}
            onChange={(e) =>
              set('leadMinutes', e.target.value === '' ? undefined : Number(e.target.value))
            }
            placeholder={`默认 ${settings.courseLeadMinutes}`}
          />
        </Field>

        {weekMode === 'custom' && (
          <div className="flex flex-wrap gap-1.5 pl-1">
            {Array.from({ length: form.endWeek - form.startWeek + 1 }, (_, i) => form.startWeek + i).map((w) => {
              const on = customWeeks.includes(w)
              return (
                <button
                  key={w}
                  onClick={() =>
                    setCustomWeeks((prev) =>
                      prev.includes(w) ? prev.filter((x) => x !== w) : [...prev, w].sort((a, b) => a - b),
                    )
                  }
                  className={`w-9 h-9 rounded-lg text-[13px] font-medium border transition-colors ${
                    on ? 'border-tangerine-500 bg-tangerine-500 text-white' : 'border-ink/10 text-ink-soft hover:bg-butter-50'
                  }`}
                >
                  {w}
                </button>
              )
            })}
          </div>
        )}

        <Field label="课程官网" hint="填了之后课表卡片上会出现直达按钮">
          <Input
            value={form.website ?? ''}
            onChange={(e) => set('website', e.target.value)}
            placeholder="https://..."
            inputMode="url"
          />
        </Field>

        <Field label="课程资料链接" hint="课件、题库、网盘等">
          <div className="space-y-2">
            {resources.map((r, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={r.title}
                  onChange={(e) =>
                    setResources((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                  }
                  placeholder="名称,如:第八章课件"
                />
                <Input
                  value={r.url}
                  onChange={(e) =>
                    setResources((prev) => prev.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
                  }
                  placeholder="https://..."
                />
                <button
                  onClick={() => setResources((prev) => prev.filter((_, j) => j !== i))}
                  className="shrink-0 px-2 text-ink-mute hover:text-cherry-500"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <Input
                value={resourceDraft.title}
                onChange={(e) => setResourceDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="名称"
              />
              <Input
                value={resourceDraft.url}
                onChange={(e) => setResourceDraft((d) => ({ ...d, url: e.target.value }))}
                placeholder="链接"
              />
              <Button
                size="sm"
                className="shrink-0"
                onClick={() => {
                  if (!resourceDraft.title && !resourceDraft.url) return
                  setResources((prev) => [...prev, { ...resourceDraft }])
                  setResourceDraft({ title: '', url: '' })
                }}
              >
                <Plus size={14} />
              </Button>
            </div>
          </div>
        </Field>

        <Field label="备注">
          <Textarea
            rows={2}
            value={form.remark ?? ''}
            onChange={(e) => set('remark', e.target.value)}
            placeholder="如:需要带计算器 / 每周三小组讨论"
          />
        </Field>

        {form.website && (
          <a
            href={form.website}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[13px] text-tangerine-600 hover:underline"
          >
            <Link2 size={13} /> 打开课程官网 <ExternalLink size={12} />
          </a>
        )}
      </div>
    </Modal>
  )
}

function blankCourse(settings: Settings): Course {
  const now = Date.now()
  return {
    id: '',
    name: '',
    startWeek: 1,
    endWeek: Math.min(16, settings.weekCount),
    weekday: 1,
    period: 1,
    periods: 1,
    createdAt: now,
    updatedAt: now,
  }
}
