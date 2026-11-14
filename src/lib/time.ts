import type { Course, PeriodSlot, Settings } from '../types'

export const WEEKDAY_CN = ['一', '二', '三', '四', '五', '六', '日']

/** 默认节次时间表(可按学校作息在设置里改) */
export const DEFAULT_PERIODS: PeriodSlot[] = [
  { index: 1, start: '08:00', end: '08:45' },
  { index: 2, start: '08:55', end: '09:40' },
  { index: 3, start: '10:00', end: '10:45' },
  { index: 4, start: '10:55', end: '11:40' },
  { index: 5, start: '14:00', end: '14:45' },
  { index: 6, start: '14:55', end: '15:40' },
  { index: 7, start: '16:00', end: '16:45' },
  { index: 8, start: '16:55', end: '17:40' },
  { index: 9, start: '19:00', end: '19:45' },
  { index: 10, start: '19:55', end: '20:40' },
  { index: 11, start: '20:50', end: '21:35' },
  { index: 12, start: '21:45', end: '22:30' },
]

export function parseDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 取某个日期所在周的周一 00:00 */
export function mondayOf(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay() === 0 ? 7 : d.getDay()
  d.setDate(d.getDate() - (day - 1))
  return d
}

/** 日期 → 教学周次(学期开始周为第 1 周;学期之前返回 0,之后返回大于总周数的值) */
export function dateToWeek(date: Date, semesterStart: string): number {
  const start = mondayOf(parseDate(semesterStart))
  const cur = mondayOf(date)
  const diff = Math.round((cur.getTime() - start.getTime()) / (7 * 24 * 3600 * 1000))
  return diff + 1
}

/** 教学周次 → 该周周一 */
export function weekToMonday(week: number, semesterStart: string): Date {
  const start = mondayOf(parseDate(semesterStart))
  const d = new Date(start)
  d.setDate(d.getDate() + (week - 1) * 7)
  return d
}

/** 当前教学周(夹在 1..总周数 之间;学期还没开始时不能显示「第 0 周」) */
export function currentWeek(settings: Settings, now = new Date()): number {
  const raw = dateToWeek(now, settings.semesterStart)
  return Math.min(Math.max(1, raw), Math.max(1, settings.weekCount))
}

/** 该周第 weekday 天(1=周一)的日期 */
export function dateOfWeekday(week: number, weekday: number, semesterStart: string): Date {
  const monday = weekToMonday(week, semesterStart)
  const d = new Date(monday)
  d.setDate(d.getDate() + (weekday - 1))
  return d
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function minutesToHHMM(total: number): string {
  const h = Math.floor(total / 60) % 24
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** 该课程在指定教学周是否上课 */
export function courseInWeek(course: Course, week: number): boolean {
  if (week < course.startWeek || week > course.endWeek) return false
  if (course.singleWeeks && course.singleWeeks.length > 0) {
    return course.singleWeeks.includes(week)
  }
  return true
}

/** 课程的连堂节次列表 */
export function coursePeriods(course: Course): number[] {
  const out: number[] = []
  for (let i = 0; i < Math.max(1, course.periods || 1); i++) out.push(course.period + i)
  return out
}

/** 课程在当前作息下的起止时刻 */
export interface CourseTimeRange {
  /** 开始时间 HH:mm */
  start: string
  /** 结束时间 HH:mm */
  end: string
  /** 紧凑写法,如 "08:00–08:45" */
  label: string
}

/**
 * 按设置里的节次时间表,算出某门课实际几点到几点。
 * 连堂课取第一节的开始和最后一节的结束。
 */
export function courseTimeRange(course: Course, settings: Settings): CourseTimeRange | null {
  const periods = coursePeriods(course)
  const first = settings.periods.find((p) => p.index === periods[0])
  const last = settings.periods.find((p) => p.index === periods[periods.length - 1])
  if (!first || !last) return null
  return { start: first.start, end: last.end, label: `${first.start}–${last.end}` }
}

/** 一天中的时段:上午 / 下午 / 晚上 */
export function daySegment(hhmm: string): '上午' | '下午' | '晚上' {
  const h = hhmmToMinutes(hhmm) / 60
  if (h < 12) return '上午'
  if (h < 18) return '下午'
  return '晚上'
}

/** Date → HH:mm */
export function formatHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export interface Session {
  course: Course
  /** 教学周 */
  week: number
  /** 具体日期 */
  date: Date
  /** 起始节次 */
  period: number
  /** 节次数量 */
  periods: number
  start: Date
  end: Date
}

/** 计算某课程在某周某天的具体时间 */
export function sessionAt(
  course: Course,
  week: number,
  settings: Settings,
  overrideDate?: Date,
): Session | null {
  if (!courseInWeek(course, week)) return null
  const date = overrideDate ?? dateOfWeekday(week, course.weekday, settings.semesterStart)
  const periods = coursePeriods(course)
  const first = settings.periods.find((p) => p.index === periods[0])
  const last = settings.periods.find((p) => p.index === periods[periods.length - 1])
  if (!first || !last) return null
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  start.setMinutes(start.getMinutes() + hhmmToMinutes(first.start))
  const end = new Date(date)
  end.setHours(0, 0, 0, 0)
  end.setMinutes(end.getMinutes() + hhmmToMinutes(last.end))
  return { course, week, date, period: periods[0], periods: periods.length, start, end }
}

/** 某教学周的全部课程,按时间排序 */
export function sessionsInWeek(courses: Course[], week: number, settings: Settings): Session[] {
  const out: Session[] = []
  for (const c of courses) {
    if (c.hidden) continue
    const s = sessionAt(c, week, settings)
    if (s) out.push(s)
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime())
}

/** 找出下一节课(严格晚于 now) */
export function nextSession(
  courses: Course[],
  settings: Settings,
  now = new Date(),
  horizonWeeks = 8,
): Session | null {
  const week = Math.max(1, dateToWeek(now, settings.semesterStart))
  for (let w = week; w < week + horizonWeeks; w++) {
    const list = sessionsInWeek(courses, w, settings)
    const upcoming = list.find((s) => s.start.getTime() > now.getTime())
    if (upcoming) return upcoming
  }
  return null
}

/** 当前正在上的课 */
export function currentSession(
  courses: Course[],
  settings: Settings,
  now = new Date(),
): Session | null {
  const week = dateToWeek(now, settings.semesterStart)
  if (week < 1) return null
  return (
    sessionsInWeek(courses, week, settings).find(
      (s) => s.start.getTime() <= now.getTime() && s.end.getTime() >= now.getTime(),
    ) ?? null
  )
}

/** 今日课程 */
export function todaySessions(
  courses: Course[],
  settings: Settings,
  now = new Date(),
): Session[] {
  const week = dateToWeek(now, settings.semesterStart)
  if (week < 1) return []
  const today = now.getDay() === 0 ? 7 : now.getDay()
  return sessionsInWeek(courses, week, settings).filter((s) => s.course.weekday === today)
}

/** 人类可读的时间描述 */
export function relativeTime(target: number, now = Date.now()): string {
  const diff = target - now
  const abs = Math.abs(diff)
  const mins = Math.round(abs / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return diff > 0 ? `${mins} 分钟后` : `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return diff > 0 ? `${hours} 小时后` : `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return diff > 0 ? `${days} 天后` : `${days} 天前`
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function formatDateTimeFull(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function endOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

/** 倒计时文案 */
export function countdown(ts: number, now = Date.now()): string {
  const diff = ts - now
  if (diff < 0) return '已逾期'
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `剩 ${mins} 分钟`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `剩 ${hours} 小时`
  const days = Math.floor(hours / 24)
  if (days < 30) return `剩 ${days} 天`
  return `剩 ${Math.floor(days / 30)} 个月`
}

/** 学期范围描述 */
export function semesterRange(settings: Settings): string {
  const start = mondayOf(parseDate(settings.semesterStart))
  const end = new Date(start)
  end.setDate(end.getDate() + settings.weekCount * 7 - 1)
  const f = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`
  return `${start.getFullYear()} 学年 · ${f(start)} ~ ${f(end)}`
}

/** 判定两门课是否时间冲突(同星期、节次重叠、周次区间相交) */
export function coursesConflict(a: Course, b: Course): boolean {
  if (a.id === b.id) return false
  if (a.weekday !== b.weekday) return false
  const aPeriods = coursePeriods(a)
  const bPeriods = coursePeriods(b)
  const overlap = aPeriods.some((p) => bPeriods.includes(p))
  if (!overlap) return false
  const weekOverlap = a.startWeek <= b.endWeek && b.startWeek <= a.endWeek
  if (!weekOverlap) return false
  // 单双周冲突判断:如果双方都限定单/双周且互补,则不冲突
  if (a.singleWeeks?.length && b.singleWeeks?.length) {
    const shared = a.singleWeeks.filter((w) => b.singleWeeks!.includes(w))
    return shared.length > 0
  }
  return true
}

/** 找出与给定课程冲突的课程 */
export function findConflicts(course: Course, all: Course[]): Course[] {
  return all.filter((c) => coursesConflict(course, c))
}

/**
 * 赶课风险检测:相邻两节课之间,教室是否跨楼/跨校区,以及间隔是否过短
 */
export interface TransitRisk {
  from: Session
  to: Session
  gapMinutes: number
  crossBuilding: boolean
  crossCampus: boolean
  level: 'none' | 'low' | 'high'
  message: string
}

export function detectTransitRisks(
  courses: Course[],
  settings: Settings,
  now = new Date(),
  days = 3,
): TransitRisk[] {
  const risks: TransitRisk[] = []
  const week = Math.max(1, dateToWeek(now, settings.semesterStart))
  const seen = new Set<string>()

  for (let w = week; w < week + days; w++) {
    const list = sessionsInWeek(courses, w, settings)
    for (let i = 0; i < list.length - 1; i++) {
      const from = list[i]
      const to = list[i + 1]

      // 只看"同一天"的连续两节课,跨天的课不算赶课
      if (
        to.date.getFullYear() !== from.date.getFullYear() ||
        to.date.getMonth() !== from.date.getMonth() ||
        to.date.getDate() !== from.date.getDate()
      ) {
        continue
      }

      const key = `${from.course.id}-${to.course.id}-${w}`
      if (seen.has(key)) continue
      seen.add(key)

      const gapMinutes = Math.round((to.start.getTime() - from.end.getTime()) / 60000)
      const crossBuilding =
        !!from.course.building && !!to.course.building && from.course.building !== to.course.building
      const crossCampus = !!from.course.campus && !!to.course.campus && from.course.campus !== to.course.campus

      let level: TransitRisk['level'] = 'none'
      const msgs: string[] = []

      if (crossCampus) {
        level = 'high'
        msgs.push(`跨校区:${from.course.campus} → ${to.course.campus}`)
      } else if (crossBuilding && gapMinutes < 30) {
        level = 'high'
        msgs.push(`跨教学楼:${from.course.building} → ${to.course.building},只剩 ${gapMinutes} 分钟`)
      }

      if (gapMinutes < 10) {
        level = 'high'
        msgs.push(`间隔仅 ${gapMinutes} 分钟`)
      } else if (gapMinutes < 20 && level === 'none') {
        level = 'low'
        msgs.push(`间隔仅 ${gapMinutes} 分钟`)
      }

      if (level === 'none') continue

      risks.push({
        from,
        to,
        gapMinutes,
        crossBuilding,
        crossCampus,
        level,
        message: `${from.course.name} → ${to.course.name},${msgs.join(',')}`,
      })
    }
  }
  return risks
}
