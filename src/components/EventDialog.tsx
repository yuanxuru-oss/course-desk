import { useEffect, useState } from 'react'
import { Trash2, AlertTriangle, Clock, Flag, Repeat, Zap, Check } from 'lucide-react'
import type { CourseEvent, EventKind, Settings } from '../types'
import { Button, Modal, Field, Input, Select, Textarea, Toggle } from './ui'
import { EVENT_KINDS, eventKindMeta, EVENT_COLOR } from '../lib/event'
import { parseDate } from '../lib/time'
import { parseEvent } from '../lib/nl'
import type { ParsedEvent } from '../lib/nl'
import { cn } from '../lib/utils'

interface Props {
  open: boolean
  event: CourseEvent | null
  settings: Settings
  onClose: () => void
  onSave: (ev: Partial<CourseEvent> & { title: string }) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

function blankEvent(settings: Settings): CourseEvent {
  const today = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`
  // 默认给一个晚上 7 点起的时段(学生会的常见时间)
  const evening = settings.periods.find((x) => x.index >= 9) ?? settings.periods[settings.periods.length - 1]
  return {
    id: '',
    title: '',
    kind: 'meeting',
    date,
    start: evening?.start ?? '19:00',
    end: evening?.end ?? '20:00',
    weekly: false,
    createdAt: 0,
    updatedAt: 0,
  }
}

export function EventDialog({ open, event, settings, onClose, onSave, onDelete }: Props) {
  const [form, setForm] = useState<CourseEvent>(() => event ?? blankEvent(settings))
  /** 粘贴进来的聊天消息原文 */
  const [pasteText, setPasteText] = useState('')
  /** 上一次识别出来的结果 */
  const [parsed, setParsed] = useState<ParsedEvent | null>(null)
  const [pasteError, setPasteError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setForm(event ? { ...event } : blankEvent(settings))
    setPasteText('')
    setParsed(null)
    setPasteError(null)
  }, [open, event, settings])

  const set = <K extends keyof CourseEvent>(k: K, v: CourseEvent[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  /** 把微信消息读成行程,填进表单 */
  const handleParse = () => {
    const p = parseEvent(pasteText, { now: new Date(), periods: settings.periods })
    if (!p) {
      setParsed(null)
      setPasteError('没读出内容。试试「周三下午3点开党会,在教三201」这种写法')
      return
    }
    setPasteError(null)
    setParsed(p)
    setForm((f) => ({
      ...f,
      title: p.title,
      kind: p.kind,
      date: p.date,
      start: p.start,
      end: p.end,
      location: p.location ?? f.location,
      detail: p.detail ?? f.detail,
      weekly: p.weekly,
    }))
  }

  const kind = eventKindMeta(form.kind)
  const d = parseDate(form.date)
  const invalidTime = form.end <= form.start
  // 日期被清空时 parseDate('') 会给出 1900-01-01,存进去这条行程
  // 在任何视图里都不可见(相当于数据静默丢失),所以禁止空日期保存
  const invalidDate = !/^\d{4}-\d{2}-\d{2}$/.test(form.date)
  /** id 为空 = 还没落库的新行程(比如从速记识别出来的草稿) */
  const isNew = !event?.id

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isNew ? '添加行程' : '编辑行程'}
      footer={
        <>
          {event && !isNew && (
            <Button
              size="sm"
              variant="danger"
              className="mr-auto"
              onClick={async () => {
                await onDelete(event.id)
                onClose()
              }}
            >
              <Trash2 size={13} /> 删除
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!form.title.trim() || invalidTime || invalidDate}
            onClick={async () => {
              await onSave({ ...form, title: form.title.trim() })
              onClose()
            }}
          >
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* ============ 速记:把微信消息粘进来,自动识别 ============ */}
        <div
          className="rounded-2xl border-2 border-dashed px-3.5 py-3"
          style={{ borderColor: `${EVENT_COLOR}59`, backgroundColor: `${EVENT_COLOR}0D` }}
        >
          <div className="flex items-center gap-1.5 mb-2">
            <Zap size={13} style={{ color: EVENT_COLOR }} className="shrink-0" />
            <span className="text-[12px] font-bold" style={{ color: EVENT_COLOR }}>
              粘贴聊天消息
            </span>
            <span className="text-[11px] text-ink-mute truncate">
              微信里收到的那句话,复制过来直接识别
            </span>
          </div>

          <div className="flex gap-2">
            <Input
              value={pasteText}
              onChange={(e) => {
                setPasteText(e.target.value)
                setParsed(null)
                setPasteError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleParse()
                }
              }}
              placeholder="例:周三下午3点开党会,在教三201"
              className="!rounded-full"
            />
            <Button
              size="sm"
              variant="primary"
              onClick={handleParse}
              disabled={!pasteText.trim()}
              className="shrink-0"
            >
              识别
            </Button>
          </div>

          {parsed && (
            <div className="mt-2.5 rounded-xl bg-white/80 border-2 border-ink/[0.07] px-2.5 py-2">
              <div className="flex items-start gap-1.5">
                <Check size={12} className="text-grass-600 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-[11.5px] text-ink-soft">
                    <span className="font-bold" style={{ color: EVENT_COLOR }}>
                      {parsed.title}
                    </span>
                    <span className="text-ink-mute">
                      {' · '}
                      {eventKindMeta(parsed.kind).label} · {parsed.date} {parsed.start}–{parsed.end}
                      {parsed.weekly ? ' · 每周重复' : ''}
                    </span>
                  </div>
                  {parsed.location && (
                    <div className="text-[11px] text-ink-mute mt-0.5">地点:{parsed.location}</div>
                  )}
                  {parsed.detail && (
                    <div className="text-[11px] text-ink-mute mt-0.5">备注:{parsed.detail}</div>
                  )}
                  {parsed.notes.map((n, i) => (
                    <div key={i} className="text-[11px] text-ink-mute mt-0.5">
                      · {n}
                    </div>
                  ))}
                  <div className="text-[11px] text-tangerine-600 font-semibold mt-1">
                    已填好,确认无误后点「保存」
                  </div>
                </div>
              </div>
            </div>
          )}

          {pasteError && (
            <div className="text-[11px] text-cherry-500 mt-1.5 font-semibold">{pasteError}</div>
          )}
        </div>

        {/* 行程的视觉标识:斜纹虚线,和课程的实心色块区分开 */}
        <div
          className="rounded-2xl px-3.5 py-3 flex items-center gap-2.5"
          style={{
            backgroundColor: `${EVENT_COLOR}14`,
            backgroundImage: `repeating-linear-gradient(45deg, ${EVENT_COLOR}33 0 2px, transparent 2px 7px)`,
            border: `2px dashed ${EVENT_COLOR}`,
          }}
        >
          <span className="text-[18px] leading-none">{kind.icon}</span>
          <div className="min-w-0">
            <div className="text-[12.5px] font-bold" style={{ color: EVENT_COLOR }}>
              {form.title || '未命名行程'}
            </div>
            <div className="text-[11px] text-ink-mute">
              {d.getMonth() + 1}/{d.getDate()} · {form.start}–{form.end} · 行程(斜纹块)
            </div>
          </div>
        </div>

        <Field label="行程标题" hint="比如:学生会例会、老师开会、党会、社团招新">
          <Input
            value={form.title}
            autoFocus
            placeholder="例如:学生会例会"
            onChange={(e) => set('title', e.target.value)}
          />
        </Field>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="类型">
            <Select value={form.kind} onChange={(e) => set('kind', e.target.value as EventKind)}>
              {EVENT_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.icon} {k.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="日期">
            <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="开始时间">
            <Input type="time" value={form.start} onChange={(e) => set('start', e.target.value)} />
          </Field>
          <Field label="结束时间">
            <Input type="time" value={form.end} onChange={(e) => set('end', e.target.value)} />
          </Field>
        </div>

        {invalidDate && (
          <div className="flex items-center gap-2 rounded-xl bg-cherry-500/10 border-2 border-cherry-500/25 px-3 py-2">
            <AlertTriangle size={13} className="text-cherry-500 shrink-0" />
            <span className="text-[12px] text-ink-soft">请先选一个日期,否则这条行程不会出现在任何视图里</span>
          </div>
        )}

        {invalidTime && (
          <div className="flex items-center gap-2 rounded-xl bg-cherry-500/10 border-2 border-cherry-500/25 px-3 py-2">
            <AlertTriangle size={13} className="text-cherry-500 shrink-0" />
            <span className="text-[12px] text-ink-soft">结束时间要晚于开始时间</span>
          </div>
        )}

        <Field label="地点" hint="比如:学生活动中心 301">
          <Input
            value={form.location ?? ''}
            placeholder="学生活动中心 301"
            onChange={(e) => set('location', e.target.value)}
          />
        </Field>

        <Field label="备注" hint="要带的东西、要准备的话题…(会一起同步到备忘录)">
          <Textarea
            rows={3}
            value={form.detail ?? ''}
            placeholder="带上本月总结和活动策划案"
            onChange={(e) => set('detail', e.target.value)}
          />
        </Field>

        <div className="rounded-2xl border-2 border-ink/[0.1] px-3.5 py-1">
          <Toggle
            checked={!!form.weekly}
            onChange={(v) => set('weekly', v)}
            label={
              <span className="inline-flex items-center gap-1.5">
                <Repeat size={13} /> 每周重复
              </span>
            }
            hint={`固定在每周${['一', '二', '三', '四', '五', '六', '日'][(d.getDay() === 0 ? 7 : d.getDay()) - 1]}的这个时段`}
          />
        </div>

        <div className="flex items-start gap-2 rounded-xl bg-butter-50 border-2 border-ink/[0.08] px-3 py-2.5">
          <Flag size={13} className="text-tangerine-600 shrink-0 mt-0.5" />
          <p className="text-[11.5px] text-ink-soft leading-relaxed">
            保存后会自动在「备忘」里生成一条同名笔记,行程改动时同步更新;删除行程时这条笔记也会一起删掉。
          </p>
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-ink-mute">
          <Clock size={11} />
          行程会显示在课表里(斜纹块),并按提前提醒时间推送通知
        </div>
      </div>
    </Modal>
  )
}
