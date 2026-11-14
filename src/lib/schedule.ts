import type { PeriodSlot } from '../types'

/**
 * 作息时间(节次时间表)——按学校调整的那一套。
 *
 * 不同学校差别很大:有人 8:00 上第一节,有人 8:30;有人一节 45 分钟,
 * 有人 40 分钟;有人下午 1:30 开课,有人 2:00;还有考研式的 100 分钟大节。
 * 所以这里把「学校作息」当成一等公民,提供预设 + 生成器 + 手工微调 + 文本互转。
 */

/** 上午 / 下午 / 晚上 三段 */
export interface ScheduleBlock {
  id: 'morning' | 'afternoon' | 'evening'
  label: string
  /** 开始时间 HH:mm */
  start: string
  /** 这一段有几节 */
  count: number
}

export const DEFAULT_BLOCKS: ScheduleBlock[] = [
  { id: 'morning', label: '上午', start: '08:00', count: 4 },
  { id: 'afternoon', label: '下午', start: '14:00', count: 4 },
  { id: 'evening', label: '晚上', start: '19:00', count: 4 },
]

/** 一节课时长 + 课间休息(分钟) */
export interface Pace {
  /** 每节时长(分钟) */
  duration: number
  /** 课间休息(分钟) */
  gap: number
}

export const DEFAULT_PACE: Pace = { duration: 45, gap: 10 }

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function toHHMM(total: number): string {
  const t = ((total % 1440) + 1440) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

/**
 * 按「分段 + 时长 + 课间」生成完整作息表。
 * 每段独立从自己的开始时间往后排,段与段之间天然形成午休 / 晚自习前的空档。
 */
export function generatePeriods(blocks: ScheduleBlock[], pace: Pace): PeriodSlot[] {
  const out: PeriodSlot[] = []
  let index = 1
  for (const b of blocks) {
    if (b.count <= 0) continue
    let cursor = toMinutes(b.start)
    for (let i = 0; i < b.count; i++) {
      const start = cursor
      const end = start + pace.duration
      out.push({ index: index++, start: toHHMM(start), end: toHHMM(end) })
      cursor = end + pace.gap
    }
  }
  return out
}

/** 作息预设:常见的几种高校作息 */
export interface SchedulePreset {
  id: string
  label: string
  desc: string
  blocks: ScheduleBlock[]
  pace: Pace
}

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  {
    id: 'std45',
    label: '标准 45 分钟制',
    desc: '8:00 上课,上午 4 节、下午 4 节、晚上 4 节(共 12 节)',
    blocks: [
      { id: 'morning', label: '上午', start: '08:00', count: 4 },
      { id: 'afternoon', label: '下午', start: '14:00', count: 4 },
      { id: 'evening', label: '晚上', start: '19:00', count: 4 },
    ],
    pace: { duration: 45, gap: 10 },
  },
  {
    id: 'std40',
    label: '紧凑 40 分钟制',
    desc: '8:00 上课,课间只歇 5 分钟',
    blocks: [
      { id: 'morning', label: '上午', start: '08:00', count: 4 },
      { id: 'afternoon', label: '下午', start: '13:30', count: 4 },
      { id: 'evening', label: '晚上', start: '18:30', count: 2 },
    ],
    pace: { duration: 40, gap: 5 },
  },
  {
    id: 'std50',
    label: '宽松 50 分钟制',
    desc: '一节 50 分钟,10 节到 20:50 结束',
    blocks: [
      { id: 'morning', label: '上午', start: '08:00', count: 4 },
      { id: 'afternoon', label: '下午', start: '14:00', count: 3 },
      { id: 'evening', label: '晚上', start: '19:00', count: 2 },
    ],
    pace: { duration: 50, gap: 10 },
  },
  {
    id: 'big100',
    label: '100 分钟大节制',
    desc: '考研式:一天 5 个大节,每节连上两小节',
    blocks: [
      { id: 'morning', label: '上午', start: '08:00', count: 2 },
      { id: 'afternoon', label: '下午', start: '14:00', count: 2 },
      { id: 'evening', label: '晚上', start: '19:00', count: 1 },
    ],
    pace: { duration: 100, gap: 20 },
  },
  {
    id: 'late1330',
    label: '下午 1:30 开课',
    desc: '上午 8:30 开始,下午 1:30 接上',
    blocks: [
      { id: 'morning', label: '上午', start: '08:30', count: 4 },
      { id: 'afternoon', label: '下午', start: '13:30', count: 4 },
      { id: 'evening', label: '晚上', start: '19:00', count: 2 },
    ],
    pace: { duration: 45, gap: 10 },
  },
]

/**
 * 从文本解析作息表。支持下面这些写法(每行一节):
 *   1 08:00-08:45
 *   第2节 08:55 - 09:40
 *   08:00~08:45
 *   08:00—08:45
 */
export function parsePeriodsText(text: string): PeriodSlot[] | null {
  const lines = text
    .split(/[\n\r;；]+/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length) return null

  const out: PeriodSlot[] = []
  const re = /(\d{1,2})\s*[:：.]\s*(\d{1,2})\s*[-–—~～至到]\s*(\d{1,2})\s*[:：.]\s*(\d{1,2})/
  for (const line of lines) {
    const m = line.match(re)
    if (!m) return null
    const start = `${String(Number(m[1])).padStart(2, '0')}:${String(Number(m[2])).padStart(2, '0')}`
    const end = `${String(Number(m[3])).padStart(2, '0')}:${String(Number(m[4])).padStart(2, '0')}`
    if (toMinutes(end) <= toMinutes(start)) return null
    out.push({ index: out.length + 1, start, end })
  }
  return out.length ? out : null
}

/** 作息表 → 文本(方便复制给同学 / 粘贴到备忘录) */
export function formatPeriodsText(periods: PeriodSlot[]): string {
  return periods.map((p) => `第${p.index}节 ${p.start}-${p.end}`).join('\n')
}

/** 一天中的时段标签 */
export function segmentLabel(hhmm: string): '上午' | '下午' | '晚上' {
  const h = toMinutes(hhmm) / 60
  if (h < 12) return '上午'
  if (h < 18) return '下午'
  return '晚上'
}

/** 按天色给时段标签上色:上午奶黄、下午蓝紫、晚上暖黑 */
export const SEGMENT_STYLE: Record<'上午' | '下午' | '晚上', string> = {
  上午: 'bg-butter-200 text-ink-soft border-butter-300',
  下午: 'bg-periwi-100 text-periwi-700 border-periwi-200',
  晚上: 'bg-ink/10 text-ink-soft border-ink/15',
}

/** 从现有作息反推出三段(用于「载入当前设置」) */
export function blocksFromPeriods(periods: PeriodSlot[]): ScheduleBlock[] {
  const groups: Record<string, PeriodSlot[]> = { morning: [], afternoon: [], evening: [] }
  for (const p of periods) {
    const h = toMinutes(p.start) / 60
    const key = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'
    groups[key].push(p)
  }
  const make = (id: 'morning' | 'afternoon' | 'evening', label: string): ScheduleBlock => {
    const g = groups[id]
    return { id, label, start: g[0]?.start ?? DEFAULT_BLOCKS.find((b) => b.id === id)!.start, count: g.length }
  }
  return [make('morning', '上午'), make('afternoon', '下午'), make('evening', '晚上')]
}

/** 从现有作息反推每节时长与课间(取众数) */
export function paceFromPeriods(periods: PeriodSlot[]): Pace {
  const durations: number[] = []
  const gaps: number[] = []
  for (let i = 0; i < periods.length; i++) {
    durations.push(toMinutes(periods[i].end) - toMinutes(periods[i].start))
    if (i > 0) {
      const prev = periods[i - 1]
      // 跨过午休 / 晚间空档的不算课间
      const gap = toMinutes(periods[i].start) - toMinutes(prev.end)
      if (gap > 0 && gap <= 60) gaps.push(gap)
    }
  }
  const mode = (arr: number[], fallback: number) => {
    if (!arr.length) return fallback
    const counts = new Map<number, number>()
    for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1)
    let best = arr[0]
    let bestN = 0
    for (const [v, n] of counts) {
      if (n > bestN || (n === bestN && v < best)) {
        best = v
        bestN = n
      }
    }
    return best
  }
  return { duration: mode(durations, DEFAULT_PACE.duration), gap: mode(gaps, DEFAULT_PACE.gap) }
}
