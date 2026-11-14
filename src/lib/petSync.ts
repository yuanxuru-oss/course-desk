import type { Course, CourseEvent, Homework, Settings } from '../types'
import { currentWeek, dateToWeek, formatHHMM, WEEKDAY_CN } from './time'
import { eventsInWeek, eventKindMeta } from './event'

/**
 * 把「今天要看的东西」压缩成一个小快照,通过 coursedesk://sync 推给桌面版。
 *
 * 为什么需要这一步:桌面版是独立的 Electron 窗口,有自己的 IndexedDB,
 * 和浏览器里的完全不通。网页没法直接写它的库,只能用协议传一份小数据过去。
 *
 * 快照只保留桌宠会显示的内容(今天的课、行程、待交作业、周次),
 * 体积通常 < 1KB,远低于 Windows 命令行长度限制。
 */
export interface PetSnapshot {
  /** 生成时间 */
  t: number
  /** 第几周 */
  week: number
  /** 今天的课程 */
  today: { n: string; s: string; e: string; l?: string; c?: string }[]
  /** 正在上 / 下一节 */
  hero: { n: string; s: string; e: string; l?: string; c?: string; live: boolean } | null
  /** 今天的行程 */
  events: { n: string; s: string; e: string; l?: string; k: string }[]
  /** 待交作业(最多 3 条) */
  hw: { n: string; d: string }[]
}

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function buildSnapshot(
  courses: Course[],
  events: CourseEvent[],
  homework: Homework[],
  settings: Settings,
  now = new Date(),
): PetSnapshot {
  const week = currentWeek(settings, now)
  const weekday = now.getDay() === 0 ? 7 : now.getDay()

  const todayCourses = courses
    .filter((c) => c.weekday === weekday && courseInWeekNumber(c, week))
    .map((c) => {
      const range = courseTimeRangeLite(c, settings)
      return {
        n: c.name,
        s: range?.start ?? '',
        e: range?.end ?? '',
        l: c.location,
        c: c.color,
      }
    })
    .sort((a, b) => a.s.localeCompare(b.s))

  const minutes = now.getHours() * 60 + now.getMinutes()
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number)
    return (h || 0) * 60 + (m || 0)
  }

  const live = todayCourses.find((c) => c.s && c.e && toMin(c.s) <= minutes && minutes <= toMin(c.e))
  const next = todayCourses.find((c) => c.s && toMin(c.s) > minutes)
  const heroBase = live ?? next ?? null
  const hero = heroBase ? { ...heroBase, live: !!live } : null

  const todayEvents = eventsInWeek(events, week, settings)
    .filter((o) => o.weekday === weekday)
    .map((o) => ({
      n: o.event.title,
      s: o.event.start,
      e: o.event.end,
      l: o.event.location,
      k: eventKindMeta(o.event.kind).label,
    }))
    .sort((a, b) => a.s.localeCompare(b.s))

  const hw = homework
    .filter((h) => !h.done && h.dueAt)
    .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
    .slice(0, 3)
    .map((h) => {
      const d = new Date(h.dueAt!)
      const sameDay = new Date(now).toDateString() === d.toDateString()
      const hh = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      return {
        n: h.title,
        d: sameDay ? `今天 ${hh}` : `${d.getMonth() + 1}/${d.getDate()} ${hh}`,
      }
    })

  return { t: now.getTime(), week, today: todayCourses, hero, events: todayEvents, hw }
}

function courseInWeekNumber(c: Course, week: number): boolean {
  return week >= c.startWeek && week <= c.endWeek
}

/** 只算起止时间,不依赖完整 settings 校验 */
function courseTimeRangeLite(c: Course, settings: Settings): { start: string; end: string; label: string } | null {
  const slot = settings.periods.find((p) => p.index === c.period)
  if (!slot) return null
  const count = c.periods ?? 1
  const last = settings.periods.find((p) => p.index === c.period + count - 1) ?? slot
  return { start: slot.start, end: last.end, label: `${slot.start}-${last.end}` }
}

/** 通过协议把快照推给桌面版(没装的话浏览器什么都不会发生) */
export function pushSnapshot(snap: PetSnapshot): boolean {
  try {
    const url = `coursedesk://sync?d=${toBase64Url(JSON.stringify(snap))}`
    // 用隐藏 iframe 触发,避免 location.href 让页面产生导航记录
    const f = document.createElement('iframe')
    f.style.display = 'none'
    f.src = url
    document.body.appendChild(f)
    setTimeout(() => f.remove(), 1500)
    return true
  } catch {
    return false
  }
}

/** 桌宠是否被用户打开过(用来决定要不要推) */
export function desktopPetWanted(): boolean {
  try {
    return localStorage.getItem('coursedesk:desktopPetWanted') === '1'
  } catch {
    return false
  }
}

/** 给气泡用的一句话(带行程) */
export function snapshotHeadline(snap: PetSnapshot): { text: string; hint?: string } {
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number)
    return (h || 0) * 60 + (m || 0)
  }

  if (snap.hero) {
    const h = snap.hero
    if (h.live) return { text: `正在上《${h.n}》,还剩 ${h.e}`, hint: h.l }
    return { text: `还有 ${h.s} 就上《${h.n}》`, hint: h.l }
  }
  const ev = snap.events.find((e) => toMin(e.s) > nowMin)
  if (ev) return { text: `${ev.s} 有「${ev.n}」`, hint: ev.l ?? ev.k }
  if (snap.events[0]) return { text: `今天「${snap.events[0].n}」${snap.events[0].s}`, hint: snap.events[0].l }
  if (snap.today.length === 0 && snap.events.length === 0) return { text: '今天没课也没安排' }
  return { text: `第 ${snap.week} 周` }
}
