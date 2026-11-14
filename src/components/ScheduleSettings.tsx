import { useEffect, useMemo, useState } from 'react'
import {
  Clock,
  Plus,
  Trash2,
  Wand2,
  Copy,
  ClipboardPaste,
  AlertTriangle,
  Building2,
  RefreshCw,
  Check,
} from 'lucide-react'
import type { PeriodSlot, Settings } from '../types'
import {
  DEFAULT_BLOCKS,
  DEFAULT_PACE,
  SCHEDULE_PRESETS,
  SEGMENT_STYLE,
  blocksFromPeriods,
  formatPeriodsText,
  generatePeriods,
  parsePeriodsText,
  paceFromPeriods,
  segmentLabel,
  type ScheduleBlock,
  type Pace,
} from '../lib/schedule'
import { db } from '../db'
import { Button, Field, Input, Modal } from './ui'
import { cn } from '../lib/utils'

interface Props {
  settings: Settings
  onSave: (patch: Partial<Settings>) => void
  onToast: (text: string, type?: 'info' | 'success' | 'error') => void
}

/**
 * 作息时间编辑器 —— 按学校调整的核心入口。
 *
 * 三种改法:
 *   1. 套用预设(标准 45 分钟制 / 40 分钟制 / 100 分钟大节…)
 *   2. 用「上午 / 下午 / 晚上」三段 + 每节时长 + 课间,一键生成
 *   3. 手工逐节微调,或从文本粘贴导入
 */
export function ScheduleSettings({ settings, onSave, onToast }: Props) {
  const periods = settings.periods

  // 生成器的临时状态(初值从当前设置反推)
  const [blocks, setBlocks] = useState<ScheduleBlock[]>(() => blocksFromPeriods(periods))
  const [pace, setPace] = useState<Pace>(() => paceFromPeriods(periods))
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [usedMax, setUsedMax] = useState(1)

  useEffect(() => {
    db.courses.toArray().then((cs) => {
      const max = cs.reduce((m, c) => Math.max(m, c.period + Math.max(1, c.periods || 1) - 1), 1)
      setUsedMax(max)
    })
  }, [periods.length])

  /** 换一整张表时,如果节数不够会挡住已有课程 */
  const applyPeriods = (next: PeriodSlot[], label: string) => {
    onSave({ periods: next })
    const tooFew = next.length < usedMax
    onToast(
      tooFew
        ? `${label}已应用。注意:已有课程排到了第 ${usedMax} 节,超出当前作息范围`
        : `${label}已应用,共 ${next.length} 节`,
      tooFew ? 'error' : 'success',
    )
  }

  const applyPreset = (id: string) => {
    const p = SCHEDULE_PRESETS.find((x) => x.id === id)
    if (!p) return
    const next = generatePeriods(p.blocks, p.pace)
    setBlocks(p.blocks.map((b) => ({ ...b })))
    setPace({ ...p.pace })
    applyPeriods(next, `「${p.label}」`)
  }

  const applyGenerated = () => {
    const next = generatePeriods(blocks, pace)
    if (!next.length) {
      onToast('至少要有一节课,请把某一段的节数改成大于 0', 'error')
      return
    }
    applyPeriods(next, '自定义作息')
  }

  const loadCurrent = () => {
    setBlocks(blocksFromPeriods(periods))
    setPace(paceFromPeriods(periods))
    onToast('已把当前作息载入生成器', 'info')
  }

  const updatePeriod = (i: number, patch: Partial<PeriodSlot>) => {
    const next = periods.map((p, idx) => (idx === i ? { ...p, ...patch } : p))
    onSave({ periods: next })
  }

  const removePeriod = async (i: number) => {
    const removedIndex = periods[i]?.index ?? i + 1
    const next = periods
      .filter((_, idx) => idx !== i)
      .map((p, idx) => ({ ...p, index: idx + 1 }))
    /*
     * 课程存的是节次数字。删掉中间某一节后,后面所有节的编号都会前移,
     * 课表里排在第 5 节的课会突然改用「新第 5 节」的时间 —— 上课时间整体错位,
     * 之前没有任何提示。这里同步把后面课程的节次也减 1。
     */
    const courses = await db.courses.toArray()
    const shifted = courses.filter((c) => c.period > removedIndex)
    if (shifted.length) {
      for (const c of shifted) {
        await db.courses.update(c.id, { period: c.period - 1, updatedAt: Date.now() })
      }
      onToast(`已删除第 ${removedIndex} 节,并同步前移了 ${shifted.length} 门课的节次`, 'info')
    }
    onSave({ periods: next })
  }

  const addPeriod = () => {
    const last = periods[periods.length - 1]
    const start = last ? addMinutes(last.end, 10) : '08:00'
    const end = addMinutes(start, pace.duration)
    const next = [...periods, { index: periods.length + 1, start, end }]
    onSave({ periods: next })
  }

  const copyText = async () => {
    const text = formatPeriodsText(periods)
    try {
      await navigator.clipboard.writeText(text)
      onToast('作息表已复制到剪贴板', 'success')
    } catch {
      onToast('复制失败,浏览器不允许访问剪贴板', 'error')
    }
  }

  const applyPaste = () => {
    const parsed = parsePeriodsText(pasteText)
    if (!parsed) {
      onToast('没看懂这个格式。每行写成「1 08:00-08:45」或「08:00-08:45」就行', 'error')
      return
    }
    applyPeriods(parsed, '粘贴的作息表')
    setPasteOpen(false)
    setPasteText('')
  }

  const segments = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of periods) map.set(segmentLabel(p.start), (map.get(segmentLabel(p.start)) ?? 0) + 1)
    return [...map.entries()]
  }, [periods])

  return (
    <div className="space-y-4">
      {/* 学校名 */}
      <Field label="学校名称" hint="选填。填了会显示在左侧栏标题下方,方便你区分不同学校的作息">
        <Input
          value={settings.schoolName ?? ''}
          placeholder="例如:南方科技大学"
          onChange={(e) => onSave({ schoolName: e.target.value })}
        />
      </Field>

      {/* 预设 */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Building2 size={13} className="text-ink-mute" />
          <span className="text-[12.5px] font-bold text-ink">快速套用</span>
          <span className="text-[11px] text-ink-mute">先选一个最接近的,再微调</span>
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          {SCHEDULE_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p.id)}
              className="text-left rounded-2xl border-2 border-ink/[0.1] bg-white px-3.5 py-2.5 hover:border-tangerine-300 hover:bg-butter-50 transition-colors"
            >
              <div className="text-[13px] font-bold text-ink">{p.label}</div>
              <div className="text-[11px] text-ink-mute mt-0.5 leading-relaxed">{p.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 生成器 */}
      <div className="rounded-2xl border-2 border-ink/[0.1] bg-butter-50 p-3.5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Wand2 size={13} className="text-tangerine-600" />
            <span className="text-[12.5px] font-bold text-ink">按学校作息生成</span>
          </div>
          <Button size="sm" variant="ghost" onClick={loadCurrent} title="把当前作息载入生成器">
            <RefreshCw size={12} /> 载入当前
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="每节时长(分钟)">
            <Input
              type="number"
              min={10}
              max={180}
              value={pace.duration}
              onChange={(e) => setPace({ ...pace, duration: Math.max(10, Number(e.target.value) || 45) })}
            />
          </Field>
          <Field label="课间休息(分钟)">
            <Input
              type="number"
              min={0}
              max={60}
              value={pace.gap}
              onChange={(e) => setPace({ ...pace, gap: Math.max(0, Number(e.target.value) || 0) })}
            />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {blocks.map((b, i) => (
            <div key={b.id} className="rounded-xl bg-white border-2 border-ink/[0.08] p-2 space-y-1.5">
              <div className="text-[11px] font-bold text-ink-soft">{b.label}</div>
              <Input
                type="time"
                value={b.start}
                className="h-8 text-[12px] px-2"
                onChange={(e) => {
                  const next = [...blocks]
                  next[i] = { ...b, start: e.target.value }
                  setBlocks(next)
                }}
              />
              <Input
                type="number"
                min={0}
                max={12}
                value={b.count}
                className="h-8 text-[12px] px-2"
                onChange={(e) => {
                  const next = [...blocks]
                  next[i] = { ...b, count: Math.max(0, Math.min(12, Number(e.target.value) || 0)) }
                  setBlocks(next)
                }}
              />
              <div className="text-[10px] text-ink-mute text-center -mt-0.5">节</div>
            </div>
          ))}
        </div>

        <Button size="sm" variant="primary" onClick={applyGenerated} className="w-full">
          <Wand2 size={13} /> 生成作息表
        </Button>
      </div>

      {/* 明细表 */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5">
            <Clock size={13} className="text-ink-mute" />
            <span className="text-[12.5px] font-bold text-ink">节次明细</span>
            <span className="text-[11px] text-ink-mute">{periods.length} 节</span>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={copyText} title="复制为文本">
              <Copy size={12} /> 复制
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPasteOpen(true)} title="从文本导入">
              <ClipboardPaste size={12} /> 粘贴导入
            </Button>
          </div>
        </div>

        {segments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {segments.map(([name, n]) => (
              <span
                key={name}
                className={cn(
                  'text-[11px] font-bold px-2 py-0.5 rounded-full border',
                  SEGMENT_STYLE[name as '上午' | '下午' | '晚上'],
                )}
              >
                {name} {n} 节
              </span>
            ))}
          </div>
        )}

        <div className="rounded-2xl border-2 border-ink/[0.1] overflow-hidden bg-white">
          <div className="grid grid-cols-[42px_1fr_1fr_54px_34px] gap-1.5 px-3 py-2 bg-butter-100 text-[11px] font-bold text-ink-soft">
            <span>节次</span>
            <span>开始</span>
            <span>结束</span>
            <span>时段</span>
            <span />
          </div>
          <div className="divide-y-2 divide-ink/[0.06] max-h-[340px] overflow-y-auto">
            {periods.map((p, i) => (
              <div key={p.index} className="grid grid-cols-[42px_1fr_1fr_54px_34px] gap-1.5 items-center px-3 py-1.5">
                <span className="text-[12px] font-bold text-ink-soft">第{p.index}</span>
                <Input
                  type="time"
                  value={p.start}
                  className="h-8 text-[12px] px-2"
                  onChange={(e) => updatePeriod(i, { start: e.target.value })}
                />
                <Input
                  type="time"
                  value={p.end}
                  className="h-8 text-[12px] px-2"
                  onChange={(e) => updatePeriod(i, { end: e.target.value })}
                />
                <span
                  className={cn(
                    'text-[10px] font-bold text-center px-1 py-0.5 rounded-full border',
                    SEGMENT_STYLE[segmentLabel(p.start)],
                  )}
                >
                  {segmentLabel(p.start)}
                </span>
                <button
                  onClick={() => removePeriod(i)}
                  className="p-1.5 rounded-full text-ink-mute hover:bg-cherry-500/10 hover:text-cherry-500 transition-colors"
                  title="删除这一节"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
          <div className="px-3 py-2 border-t-2 border-ink/[0.06] bg-butter-50">
            <Button size="sm" variant="secondary" onClick={addPeriod}>
              <Plus size={13} /> 添加一节
            </Button>
          </div>
        </div>

        {usedMax > periods.length && (
          <div className="mt-2 flex items-start gap-2 rounded-xl bg-cherry-500/10 border-2 border-cherry-500/25 p-2.5">
            <AlertTriangle size={13} className="text-cherry-500 shrink-0 mt-0.5" />
            <p className="text-[11.5px] text-ink-soft leading-relaxed">
              有课程排在第 {usedMax} 节,超出了现在的 {periods.length} 节作息,这些课在课表上会看不到。
              把节次加到 {usedMax} 节以上,或者改一下这门课的节次。
            </p>
          </div>
        )}
      </div>

      {/* 粘贴导入弹窗 */}
      <Modal
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        title="粘贴作息表"
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setPasteOpen(false)}>
              取消
            </Button>
            <Button size="sm" variant="primary" onClick={applyPaste}>
              <Check size={13} /> 导入
            </Button>
          </>
        }
      >
        <p className="text-[12.5px] text-ink-soft leading-relaxed mb-2.5">
          每行一节,支持这几种写法:
        </p>
        <pre className="text-[12px] font-mono text-ink bg-butter-50 border-2 border-ink/[0.08] rounded-xl p-3 mb-2.5 leading-relaxed">
{`1 08:00-08:45
第2节 08:55 - 09:40
08:00~08:45`}
        </pre>
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          rows={8}
          placeholder={'8:00-8:45\n8:55-9:40\n...'}
          className="w-full rounded-2xl border-2 border-ink/[0.12] bg-white px-3 py-2.5 text-sm font-mono text-ink leading-relaxed resize-y focus:border-tangerine-400 focus:ring-4 focus:ring-tangerine-100 focus:outline-none"
        />
      </Modal>
    </div>
  )
}

function addMinutes(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  const total = ((h || 0) * 60 + (m || 0) + mins) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
