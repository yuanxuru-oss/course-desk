/**
 * 提醒引擎:从课程表 / 作业 / 模板生成待提醒事件,并通过启用的通道投递。
 *
 * 通道:
 *   local   —— 浏览器系统通知(页面打开时可靠)
 *   webpush —— Web Push,页面关闭也能收到(需要配置推送服务)
 *   wechat  —— 微信(通过 Server 酱或自建代理)
 *
 * 去重:每条提醒有确定性 id,已投递记录写在 outbox 表。
 */
import { db, uid } from '../db'
import type { Course, CourseEvent, Homework, HomeworkTemplate, Reminder, Settings } from '../types'
import { dateToWeek, dateOfWeekday, hhmmToMinutes, sessionsInWeek, weekToMonday } from './time.ts'
import { eventsInWeek } from './event'
import { showNotification } from './notify'
import { sendWebpush } from './push'
import { sendWechat } from './wechat'

/** 稳定的提醒 id,用于跨重启去重 */
function reminderId(kind: string, refId: string, fireAt: number): string {
  return `${kind}:${refId}:${Math.floor(fireAt / 1000)}`
}

function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/** 生成未来 horizonDays 天内的所有提醒 */
export function buildReminders(
  courses: Course[],
  homework: Homework[],
  templates: HomeworkTemplate[],
  settings: Settings,
  now = new Date(),
  horizonDays = 7,
  events: CourseEvent[] = [],
): Reminder[] {
  const out: Reminder[] = []
  const hwLead = settings.homeworkLeadMinutes

  // 1) 课程提醒
  const week = Math.max(1, dateToWeek(now, settings.semesterStart))
  for (let w = week; w <= week + Math.ceil(horizonDays / 7); w++) {
    for (const s of sessionsInWeek(courses, w, settings)) {
      const courseLead = s.course.leadMinutes ?? settings.courseLeadMinutes
      const fireAt = s.start.getTime() - courseLead * 60_000
      if (fireAt < now.getTime() - 60 * 60_000) continue
      if (fireAt > now.getTime() + horizonDays * 86_400_000) continue
      out.push({
        id: reminderId('course', s.course.id, fireAt),
        fireAt,
        title: `${courseLead} 分钟后上课 · ${s.course.name}`,
        body: [
          s.course.location ? `📍 ${s.course.location}` : '',
          s.course.teacher ? `👤 ${s.course.teacher}` : '',
          `🕘 ${s.start.getHours()}:${String(s.start.getMinutes()).padStart(2, '0')} 开始`,
        ]
          .filter(Boolean)
          .join('  |  '),
        kind: 'course',
        refId: s.course.id,
      })
    }
  }

  // 1.5) 行程提醒(课程之外的校园活动)
  for (let w = week; w <= week + Math.ceil(horizonDays / 7); w++) {
    for (const o of eventsInWeek(events, w, settings)) {
      const [sh, sm] = o.event.start.split(':').map(Number)
      const [eh, em] = o.event.end.split(':').map(Number)
      const start = new Date(o.date)
      start.setHours(sh || 0, sm || 0, 0, 0)
      const end = new Date(o.date)
      end.setHours(eh || 0, em || 0, 0, 0)
      const lead = settings.courseLeadMinutes
      const fireAt = start.getTime() - lead * 60_000
      if (fireAt < now.getTime() - 60 * 60_000) continue
      if (fireAt > now.getTime() + horizonDays * 86_400_000) continue
      out.push({
        id: reminderId('event', `${o.event.id}_${o.date}`, fireAt),
        fireAt,
        title: `${lead} 分钟后有行程 · ${o.event.title}`,
        body: [
          `🕘 ${o.event.start} – ${o.event.end}`,
          o.event.location ? `📍 ${o.event.location}` : '',
        ]
          .filter(Boolean)
          .join('  |  '),
        kind: 'event',
        refId: o.event.id,
      })
    }
  }

  // 2) 作业提醒
  for (const h of homework) {
    if (h.done || !h.dueAt) continue
    const fireAt = h.dueAt - hwLead * 60_000
    if (fireAt < now.getTime() - 60 * 60_000) continue
    if (fireAt > now.getTime() + horizonDays * 86_400_000) continue
    const course = courses.find((c) => c.id === h.courseId)
    out.push({
      id: reminderId('homework', h.id, fireAt),
      fireAt,
      title: `作业提醒 · ${h.title}`,
      body: [
        course ? `📘 ${course.name}` : '',
        `⏰ ${new Date(h.dueAt).getMonth() + 1}/${new Date(h.dueAt).getDate()} ${new Date(h.dueAt).getHours()}:${String(new Date(h.dueAt).getMinutes()).padStart(2, '0')} 截止`,
        hwLead > 0 ? `还有 ${Math.round((h.dueAt - now.getTime()) / 3600_000)} 小时` : '',
      ]
        .filter(Boolean)
        .join('  |  '),
      kind: 'homework',
      refId: h.id,
    })
  }

  // 3) 每天早安汇总
  if (settings.dailyDigestEnabled) {
    const [hh, mm] = settings.dailyDigestTime.split(':').map(Number)
    for (let d = 0; d <= horizonDays; d++) {
      const day = new Date(now)
      day.setDate(day.getDate() + d)
      day.setHours(hh, mm, 0, 0)
      const fireAt = day.getTime()
      if (fireAt < now.getTime() - 60 * 60_000) continue
      if (fireAt > now.getTime() + horizonDays * 86_400_000) continue
      out.push({
        id: reminderId('digest', dayKey(fireAt), fireAt),
        fireAt,
        title: '今日课程速览',
        body: '打开课程桌查看今天的课程与待办',
        kind: 'digest',
        refId: dayKey(fireAt),
      })
    }
  }

  return out.sort((a, b) => a.fireAt - b.fireAt)
}

/** 作业模板滚动:为本周生成实例(不重复) */
export function materializeTemplates(
  templates: HomeworkTemplate[],
  existing: Homework[],
  settings: Settings,
  now = new Date(),
): Homework[] {
  const created: Homework[] = []
  const week = Math.max(1, dateToWeek(now, settings.semesterStart))
  /*
   * 去重键**不能带 dueAt**:用户在作业里改过截止时间后,dueAt 变了,
   * 键对不上就会被判成「缺失」,下次启动用同一个确定性 id 重新生成,
   * 把用户的修改和已勾选状态一起覆盖掉。
   * 同理,只看「这条是否已经物化」(id 是否存在),用户删掉之后也不会复活。
   */
  const existingKeys = new Set(existing.map((h) => `${h.templateId ?? ''}|${h.week ?? ''}`))
  const existingIds = new Set(existing.map((h) => h.id))

  for (let w = week; w < week + 4; w++) {
    for (const t of templates) {
      if (w < t.startWeek || w > t.endWeek) continue
      const date = dateOfWeekday(w, t.weekday, settings.semesterStart)
      const [hh, mm] = t.timeOfDay.split(':').map(Number)
      const due = new Date(date)
      due.setHours(hh, mm, 0, 0)
      if (due.getTime() < now.getTime() - 86_400_000) continue
      const key = `${t.id}|${w}`
      const id = `hw_tpl_${t.id}_w${w}`
      if (existingKeys.has(key) || existingIds.has(id)) continue
      existingKeys.add(key)
      created.push({
        // 确定性 id:重复执行不会产生重复条目
        id,
        title: t.title,
        courseId: t.courseId,
        detail: t.detail,
        dueAt: due.getTime(),
        done: false,
        attachments: [],
        week: w,
        templateId: t.id,
        priority: t.priority,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    }
  }
  return created
}

/** 检查是否已投递 */
async function alreadySent(id: string, fireAt: number, channel: string): Promise<boolean> {
  const rec = await db.outbox.get(`${id}::${channel}`)
  return !!rec
}

async function markSent(id: string, fireAt: number, channel: string) {
  await db.outbox.put({
    id: `${id}::${channel}`,
    fireAt,
    channel,
    sentAt: Date.now(),
  })
}

/**
 * 正在投递中的「提醒::通道」。
 *
 * alreadySent → 发送 → markSent 之间没有事务,如果两个 tick 并发
 * (切回标签页时 visibilitychange 和 focus 会各触发一次),
 * 两边都会读到「没发过」,于是同一条微信推送发两遍。local 通道靠
 * 通知 tag 会互相覆盖看不出来,微信/WebPush 是真的双份。
 */
const inflight = new Set<string>()

/** 投递一条提醒到所有启用通道 */
export async function deliver(reminder: Reminder, settings: Settings): Promise<void> {
  const channels: string[] = []
  if (settings.channels.local) channels.push('local')
  if (settings.channels.webpush && settings.pushServerUrl) channels.push('webpush')
  if (settings.channels.wechat && (settings.wechatKey || settings.wechatProxy)) channels.push('wechat')

  for (const channel of channels) {
    const key = `${reminder.id}::${channel}`
    if (inflight.has(key)) continue
    if (await alreadySent(reminder.id, reminder.fireAt, channel)) continue
    inflight.add(key)
    let ok = false
    try {
      if (channel === 'local') {
        ok = await showNotification(reminder.title, reminder.body, {
          tag: reminder.id,
          requireInteraction: reminder.kind === 'homework',
        })
      } else if (channel === 'webpush') {
        ok = await sendWebpush(settings.pushServerUrl, {
          title: reminder.title,
          body: reminder.body,
          tag: reminder.id,
        })
      } else if (channel === 'wechat') {
        ok = await sendWechat(settings, reminder.title, reminder.body)
      }
    } catch (err) {
      console.warn(`[reminder] ${channel} 投递失败`, err)
    } finally {
      inflight.delete(key)
    }
    if (ok) await markSent(reminder.id, reminder.fireAt, channel)
  }
}

/** 一次性执行:处理所有到期提醒 */
export async function runTick(
  courses: Course[],
  homework: Homework[],
  templates: HomeworkTemplate[],
  settings: Settings,
  now = new Date(),
  horizonDays = 7,
  events: CourseEvent[] = [],
): Promise<number> {
  const reminders = buildReminders(courses, homework, templates, settings, now, horizonDays, events)
  let fired = 0
  for (const r of reminders) {
    if (r.fireAt > now.getTime()) break
    await deliver(r, settings)
    fired++
  }
  return fired
}

/** 把提醒计划同步到推送服务(页面关闭也能送达的关键) */
export async function syncScheduleToServer(
  courses: Course[],
  homework: Homework[],
  templates: HomeworkTemplate[],
  settings: Settings,
  events: CourseEvent[] = [],
): Promise<boolean> {
  if (!settings.pushServerUrl) return false
  const reminders = buildReminders(courses, homework, templates, settings, new Date(), 14, events)
  try {
    const res = await fetch(`${settings.pushServerUrl.replace(/\/+$/, '')}/api/schedule`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reminders, settings: { timezoneOffset: new Date().getTimezoneOffset() } }),
    })
    return res.ok
  } catch (err) {
    console.warn('[reminder] 同步计划到推送服务失败', err)
    return false
  }
}

/** 计算某天的课表文字摘要(用于早安推送) */
export function daySummary(courses: Course[], settings: Settings, date: Date): string {
  const week = dateToWeek(date, settings.semesterStart)
  if (week < 1) return '学期还未开始'
  const weekday = date.getDay() === 0 ? 7 : date.getDay()
  const list = sessionsInWeek(courses, week, settings).filter((s) => s.course.weekday === weekday)
  if (!list.length) return '今天没有课'
  return list
    .map((s) => `${s.start.getHours()}:${String(s.start.getMinutes()).padStart(2, '0')} ${s.course.name}${s.course.location ? `@${s.course.location}` : ''}`)
    .join('\n')
}

/** 语义化时间槽:把"第几节课"换算成时间,用于非课表提醒 */
export function slotTime(settings: Settings, period: number): { start: number; end: number } {
  const slot = settings.periods.find((p) => p.index === period)
  return {
    start: slot ? hhmmToMinutes(slot.start) : 8 * 60,
    end: slot ? hhmmToMinutes(slot.end) : 8 * 60 + 45,
  }
}

export { weekToMonday }
