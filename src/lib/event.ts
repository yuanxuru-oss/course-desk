/**
 * 行程 —— 课程之外的校园活动(学生会会议、老师开会、党会、讲座…)
 *
 * 设计要点:**和课程刻意长得不一样**。
 *   课程 = 实心饱和色块(贴纸)
 *   行程 = 斜纹 + 虚线边框 + 低饱和底色(打印出来的行程单)
 * 两套视觉语言并排放,一眼能分清哪块是课、哪块是活动。
 */
import type { CourseEvent, EventKind, EventKindMeta, Settings } from '../types'
import { hhmmToMinutes, parseDate, weekToMonday } from './time.ts'

/** 行程专用强调色:藕紫 —— 刻意不与课表 8 色轮转重叠 */
export const EVENT_COLOR = '#8B6BB0'
export const EVENT_COLOR_SOFT = '#F1E8F8'

export const EVENT_KINDS: EventKindMeta[] = [
  { id: 'meeting', label: '会议', icon: '⚑' },
  { id: 'party', label: '党团', icon: '★' },
  { id: 'club', label: '社团', icon: '✿' },
  { id: 'lecture', label: '讲座', icon: '◈' },
  { id: 'other', label: '其他', icon: '●' },
]

export function eventKindMeta(kind: EventKind): EventKindMeta {
  return EVENT_KINDS.find((k) => k.id === kind) ?? EVENT_KINDS[EVENT_KINDS.length - 1]
}

/**
 * 行程块的视觉:米白纸片 + 斜纹 + 虚线边 —— 与实心课程块是两种材质。
 * 纸片底色接近不透明,保证文字永远清晰可读。
 */
export function eventBlockStyle(color: string = EVENT_COLOR) {
  return {
    backgroundColor: 'rgba(255, 253, 245, 0.94)',
    backgroundImage: `repeating-linear-gradient(45deg, ${color}38 0 2px, transparent 2px 8px)`,
    border: `2px dashed ${color}`,
    color,
  }
}

/** 行程在课表网格里占据的行(第几节 ~ 第几节) */
export interface EventSlot {
  /** 起始节次(1 起) */
  startPeriod: number
  /** 结束节次(含) */
  endPeriod: number
}

/**
 * 把时间吸附到某一节。
 *
 * 落在空档里(午休 11:40–14:00、晚饭 17:40–19:00、晚上没课)时,
 * 要吸附到**前一个相邻**节次,而不是「最后一节」——
 * 之前所有空档都会算出第 12 节,于是 12:30 的班会被画到 21:45 那一行。
 */
function snapPeriod(periods: Settings['periods'], t: number): number {
  if (t < hhmmToMinutes(periods[0].start)) return 0
  let hit = 0
  for (let i = 0; i < periods.length; i++) {
    if (hhmmToMinutes(periods[i].start) <= t) hit = i
    else break
  }
  return hit
}

export function eventSlot(ev: CourseEvent, settings: Settings): EventSlot | null {
  const periods = settings.periods
  if (!periods.length) return null
  const s = hhmmToMinutes(ev.start)
  const e = hhmmToMinutes(ev.end)

  // 找到包含开始时间的节次,找不到就吸附到前一个相邻节次
  let startPeriod = periods.findIndex((p) => {
    const ps = hhmmToMinutes(p.start)
    const pe = hhmmToMinutes(p.end)
    return s >= ps && s <= pe
  })
  if (startPeriod < 0) startPeriod = snapPeriod(periods, s)

  let endPeriod = periods.findIndex((p) => {
    const ps = hhmmToMinutes(p.start)
    const pe = hhmmToMinutes(p.end)
    return e >= ps && e <= pe
  })
  if (endPeriod < 0) endPeriod = snapPeriod(periods, e)

  return {
    startPeriod: periods[startPeriod].index,
    endPeriod: Math.max(periods[startPeriod].index, periods[endPeriod].index),
  }
}

/** 行程在某教学周的某一天是否出现 */
export interface EventOccurrence {
  event: CourseEvent
  /** 星期几(1=周一) */
  weekday: number
  /** 具体日期 YYYY-MM-DD */
  date: string
  slot: EventSlot
}

/** 取某教学周出现的全部行程(每周重复的每周都出现) */
export function eventsInWeek(
  events: CourseEvent[],
  week: number,
  settings: Settings,
): EventOccurrence[] {
  const monday = weekToMonday(week, settings.semesterStart)
  const out: EventOccurrence[] = []

  for (const ev of events) {
    const slot = eventSlot(ev, settings)
    if (!slot) continue
    const d = parseDate(ev.date)
    const weekday = d.getDay() === 0 ? 7 : d.getDay()

    if (ev.weekly) {
      // 每周重复:这一周里的同一个星期几都出现
      const date = new Date(monday)
      date.setDate(date.getDate() + weekday - 1)
      out.push({ event: ev, weekday, date: fmtDate(date), slot })
    } else {
      // 单次:只在本周之内才显示
      const diff = Math.round((d.getTime() - monday.getTime()) / 86_400_000)
      if (diff < 0 || diff > 6) continue
      out.push({ event: ev, weekday, date: ev.date, slot })
    }
  }

  return out.sort((a, b) => {
    if (a.weekday !== b.weekday) return a.weekday - b.weekday
    return hhmmToMinutes(a.event.start) - hhmmToMinutes(b.event.start)
  })
}

/**
 * 同一时段有多个行程时的分栏布局(经典日历算法)。
 * 重叠的行程并排摆放,而不是叠在一起互相遮挡。
 */
export interface PositionedEvent {
  occ: EventOccurrence
  /** 第几列(0 起) */
  lane: number
  /** 这一簇一共分了几列 */
  lanes: number
}

export function layoutEvents(occurrences: EventOccurrence[]): PositionedEvent[] {
  const out: PositionedEvent[] = []

  const byDay = new Map<number, EventOccurrence[]>()
  for (const o of occurrences) {
    const list = byDay.get(o.weekday) ?? []
    list.push(o)
    byDay.set(o.weekday, list)
  }

  for (const list of byDay.values()) {
    list.sort(
      (a, b) =>
        a.slot.startPeriod - b.slot.startPeriod || a.event.start.localeCompare(b.event.start),
    )

    // 扫描出「重叠簇」:时间上首尾相接/相交的一组
    let cluster: EventOccurrence[] = []
    let clusterEnd = -1
    const flush = () => {
      if (!cluster.length) return
      const laneEnds: number[] = []
      const assigned: { occ: EventOccurrence; lane: number }[] = []
      for (const o of cluster) {
        let lane = laneEnds.findIndex((end) => end < o.slot.startPeriod)
        if (lane < 0) {
          lane = laneEnds.length
          laneEnds.push(o.slot.endPeriod)
        } else {
          laneEnds[lane] = o.slot.endPeriod
        }
        assigned.push({ occ: o, lane })
      }
      const lanes = laneEnds.length
      for (const a of assigned) out.push({ occ: a.occ, lane: a.lane, lanes })
      cluster = []
      clusterEnd = -1
    }

    for (const o of list) {
      if (cluster.length && o.slot.startPeriod > clusterEnd) flush()
      cluster.push(o)
      clusterEnd = Math.max(clusterEnd, o.slot.endPeriod)
    }
    flush()
  }

  return out
}

/** 取某一天(按具体日期)的行程 */
export function eventsOnDate(
  events: CourseEvent[],
  date: string,
  settings: Settings,
): EventOccurrence[] {
  const weekday = parseDate(date).getDay() === 0 ? 7 : parseDate(date).getDay()
  return eventsInWeek(events, weekOfDate(date, settings), settings).filter((o) => {
    if (o.event.weekly) return o.weekday === weekday
    return o.date === date
  })
}

/** 某个日期属于第几教学周 */
export function weekOfDate(date: string, settings: Settings): number {
  const start = weekToMonday(1, settings.semesterStart)
  const monday = parseDate(date)
  const m = new Date(monday)
  m.setDate(m.getDate() - ((m.getDay() === 0 ? 7 : m.getDay()) - 1))
  m.setHours(0, 0, 0, 0)
  return Math.round((m.getTime() - start.getTime()) / (7 * 86_400_000)) + 1
}

export function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 「11/10 周二」这种短写法 */
export function shortDate(date: string): string {
  const d = parseDate(date)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function weekdayLabel(weekday: number): string {
  return ['一', '二', '三', '四', '五', '六', '日'][Math.min(7, Math.max(1, weekday)) - 1]
}

/**
 * 行程 → 备忘录正文。
 * 行程保存后会自动在备忘录里生成一条同名笔记,方便随时翻看和补充。
 */
export function eventToNoteContent(ev: CourseEvent): string {
  const kind = eventKindMeta(ev.kind)
  const d = parseDate(ev.date)
  const lines = [
    `**${ev.title}**`,
    ``,
    `- 类型:${kind.label}`,
    `- 时间:${d.getMonth() + 1} 月 ${d.getDate()} 日 星期${weekdayLabel(d.getDay() === 0 ? 7 : d.getDay())} ${ev.start} – ${ev.end}${ev.weekly ? '(每周重复)' : ''}`,
  ]
  if (ev.location) lines.push(`- 地点:${ev.location}`)
  if (ev.detail) lines.push(``, ev.detail)
  lines.push(``, `> 这条备忘由「行程」自动同步,行程改动会一并更新。`)
  return lines.join('\n')
}
