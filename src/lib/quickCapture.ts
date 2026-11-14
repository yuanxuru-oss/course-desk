/**
 * 全局粘贴捕获 —— 像淘宝粘贴链接那样,在哪儿按 Ctrl+V 都能自动识别。
 *
 * 设计前提:**不该打扰用户**。
 *   - 粘贴到输入框 / 笔记正文里 → 完全不管,那是用户自己的输入
 *   - 粘贴一段普通文字(没有日期、没有时间、没有活动词)→ 静默忽略
 *   - 只有「看起来确实是一条活动消息」时才弹出识别卡片
 *
 * 识别成功后不直接入库,而是弹一张卡片让用户过目 —— 一键添加,或改一下再加。
 */
import type { PeriodSlot } from '../types'
import { COURSE_HINTS, parseEvent } from './nl.ts'
import type { ParsedEvent } from './nl.ts'

/** 出现这些词,基本可以确定是校园活动消息 */
const EVENT_WORDS = [
  '党会', '党课', '党员', '党支部', '党团', '团建', '团日', '团员', '联欢',
  '例会', '会议', '开会', '班会', '小组会', '组会', '碰头', '洽谈', '面谈', '谈话',
  '讲座', '报告', '宣讲', '论坛', '沙龙', '培训', '演讲',
  '社团', '纳新', '招新', '俱乐部', '志愿',
  '聚餐', '生日', '迎新', '送别', '面试', '答辩', '见老师', '找老师',
  '集合', '签到', '出发', '活动', '开会',
]

/** 粘贴文本长度上限:超过就不像是「一句话消息」 */
const MAX_LEN = 160

export interface QuickCapture {
  /** 解析出来的行程草稿 */
  parsed: ParsedEvent
  /** 原始文本 */
  raw: string
}

function hasDateSignal(text: string): boolean {
  // 今晚/明晚 这些口语说法必须算日期信号,不然最常见的「今晚7点开会」会被静默忽略
  return /\d{1,2}\s*月\s*\d{1,2}|大后天|后天|明晚|明早|明天|明日|今晚|今夜|今早|今天|今日|前天|昨天|昨日|(?:周|星期|礼拜)\s*[一二三四五六日天1-7]/.test(
    text,
  )
}

function hasTimeSignal(text: string): boolean {
  return /\d{1,2}\s*[:：]\s*\d{2}|[0-9一二两三四五六七八九十]+\s*[点时]\s*(?:\d{1,2}|半|一刻)?/.test(
    text,
  )
}

/** 这段文字值不值得打扰用户 */
export function looksLikeEvent(text: string): boolean {
  const t = text.trim()
  if (!t || t.length > MAX_LEN) return false
  if (!hasDateSignal(t)) return false
  if (hasTimeSignal(t)) return true
  return EVENT_WORDS.some((w) => t.includes(w))
}

/**
 * 试读一段文本。
 * 读得出「一条活动消息」就返回草稿,否则返回 null(调用方应保持安静)。
 */
export function parseQuickCapture(
  text: string,
  opts?: { now?: Date; periods?: PeriodSlot[] },
): QuickCapture | null {
  if (!looksLikeEvent(text)) return null

  const parsed = parseEvent(text, opts)
  if (!parsed) return null
  if (!parsed.title || parsed.title === '新行程') return null
  // 标题太长 → 多半是一整段话,不是一条消息
  if (parsed.title.length > 20) return null
  // 明显是课程名的,交给「导入 → 一句话录入」,这里不抢
  const hitCourse = COURSE_HINTS.find((h) => parsed.title === h || parsed.title.includes(h))
  if (hitCourse && !EVENT_WORDS.some((w) => parsed.title.includes(w))) return null

  return { parsed, raw: text.trim() }
}

/**
 * 粘贴事件落在哪儿?
 * 输入框、文本域、可编辑区域 → 用户自己正在输入,别插手。
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
