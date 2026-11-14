/**
 * 自然语言录入解析器
 * 支持的输入形如:
 *   周三下午3点高数教三302
 *   周3 15:00-16:45 高等数学 教三302
 *   周一1-2节大学英语
 *   明天下午2点 小组会在一教201
 *   每周五交周记 / 周五交高数作业
 *
 * 另外支持「把一条聊天消息读成行程」:
 *   周三下午3点开党会,在教三201
 *   明天晚上7点学生会例会,学生活动中心301,记得带笔记本
 */
import type { EventKind, PeriodSlot } from '../types'

export interface ParsedCourse {
  name: string
  weekday: number
  period: number
  periods: number
  location?: string
  teacher?: string
  startTime?: string
  endTime?: string
  startWeek: number
  endWeek: number
  /** 解析过程中的提示,展示给用户确认 */
  notes: string[]
}

export interface ParsedHomework {
  title: string
  weekday: number
  timeOfDay: string
  startWeek: number
  endWeek: number
  notes: string[]
}

const CN_NUM: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  日: 7, 天: 7,
}

const FULLWIDTH = /[\uff01-\uff5e]/g

/** 中文数字转阿拉伯数字(支持 1-99) */
export function cnToNumber(text: string): number | null {
  if (/^\d+$/.test(text)) return Number(text)
  if (!/^[零一二两三四五六七八九十日天]+$/.test(text)) return null
  if (text.length === 1) return CN_NUM[text] ?? null
  if (text.startsWith('十')) return 10 + (CN_NUM[text[1]] ?? 0)
  if (text.includes('十')) {
    const [tens, ones] = text.split('十')
    const t = tens ? CN_NUM[tens] ?? 0 : 1
    const o = ones ? CN_NUM[ones] ?? 0 : 0
    return t * 10 + o
  }
  return null
}

/** 全角转半角 + 去除多余空白 */
export function normalize(input: string): string {
  return input
    .replace(FULLWIDTH, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[　\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 识别星期几,返回 1-7 */
export function parseWeekday(text: string): number | null {
  const patterns: [RegExp, number][] = [
    [/周([一二三四五六日天])/, 0],
    [/周([1-7])/, 0],
    [/星期([一二三四五六日天])/, 0],
    [/礼拜([一二三四五六日天])/, 0],
    [/(mon|tue|wed|thu|fri|sat|sun)/i, 0],
  ]
  for (const [re] of patterns) {
    const m = text.match(re)
    if (!m) continue
    const token = m[1].toLowerCase()
    if (/^[一二三四五六日天]$/.test(token)) return CN_NUM[token] ?? null
    if (/^[1-7]$/.test(token)) return Number(token)
    const en = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(token)
    if (en >= 0) return en + 1
  }
  return null
}

/** 相对日期 → 星期几 */
export function weekdayFromRelative(text: string, now = new Date()): number | null {
  if (/今天|今日/.test(text)) return now.getDay() === 0 ? 7 : now.getDay()
  if (/明天|明日/.test(text)) {
    const d = new Date(now)
    d.setDate(d.getDate() + 1)
    return d.getDay() === 0 ? 7 : d.getDay()
  }
  if (/后天/.test(text)) {
    const d = new Date(now)
    d.setDate(d.getDate() + 2)
    return d.getDay() === 0 ? 7 : d.getDay()
  }
  if (/昨天|昨日/.test(text)) {
    const d = new Date(now)
    d.setDate(d.getDate() - 1)
    return d.getDay() === 0 ? 7 : d.getDay()
  }
  return null
}

/** 解析时间点,返回分钟数 */
export function parseClock(text: string): { minutes: number; hadMeridiem: boolean; matched: boolean } {
  // 15:00 或 15:30
  const hm = text.match(/(\d{1,2}):(\d{2})/)
  if (hm) {
    return { minutes: Number(hm[1]) * 60 + Number(hm[2]), hadMeridiem: false, matched: true }
  }
  // 下午3点 / 上午8点半 / 晚上7点15分 / 今晚7点 / 3点
  const re = /(上午|早上|早晨|中午|下午|傍晚|晚上|夜里|今晚|今夜|明晚|明早)?\s*(\d{1,2}|[一二两三四五六七八九十]+)\s*[点时](\d{1,2}|半|一刻)?\s*分?/
  const m = text.match(re)
  if (!m) return { minutes: 0, hadMeridiem: false, matched: false }
  let hour: number
  const raw = m[2]
  if (/^\d+$/.test(raw)) hour = Number(raw)
  else hour = cnToNumber(raw) ?? 0
  let minute = 0
  if (m[3]) {
    if (m[3] === '半') minute = 30
    else if (/^\d+$/.test(m[3])) minute = Number(m[3])
  }
  const meridiem = m[1]
  let hadMeridiem = false
  if (meridiem) {
    hadMeridiem = true
    if (/下午|傍晚|晚|夜/.test(meridiem) && hour < 12) hour += 12
    if (meridiem === '中午' && hour < 12) hour = 12
    if (/上午|早上|早晨|早/.test(meridiem) && hour === 12) hour = 0
  } else if (hour >= 1 && hour <= 11) {
    // 无上下午:按常见作息推断
    if (hour <= 6) hour += 12
    hadMeridiem = false
  }
  return { minutes: hour * 60 + minute, hadMeridiem, matched: true }
}

/** 解析时间段 "15:00-16:45" / "3-4节" / "3-4点" */
export function parseTimeRange(text: string): { start?: number; end?: number; periods?: [number, number] } {
  // 节次范围
  const secRange = text.match(/(\d{1,2})\s*[-~－到至]\s*(\d{1,2})\s*节/)
  if (secRange) {
    return { periods: [Number(secRange[1]), Number(secRange[2])] }
  }
  // 单节
  const singleSec = text.match(/(\d{1,2})\s*节/)
  if (singleSec) {
    return { periods: [Number(singleSec[1]), Number(singleSec[1])] }
  }
  // HH:MM-HH:MM
  const full = text.match(/(\d{1,2}:\d{2})\s*[-~－到至]\s*(\d{1,2}:\d{2})/)
  if (full) {
    const toMin = (s: string) => {
      const [h, m] = s.split(':').map(Number)
      return h * 60 + m
    }
    return { start: toMin(full[1]), end: toMin(full[2]) }
  }
  // X点-X点(允许两端各带上下午,以及半小时)
  const points = text.match(
    /(上午|早上|早晨|中午|下午|傍晚|晚上|夜里|今晚|今夜|明晚)?\s*(\d{1,2}|[一二两三四五六七八九十]+)\s*[点时]\s*(\d{1,2}|半|一刻)?\s*分?\s*[-~－到至]\s*(上午|早上|早晨|中午|下午|傍晚|晚上|夜里|今晚|今夜|明晚)?\s*(\d{1,2}|[一二两三四五六七八九十]+)\s*[点时]\s*(\d{1,2}|半|一刻)?\s*分?/,
  )
  if (points) {
    const clockAt = (meridiem: string | undefined, hour: string, minute: string | undefined) => {
      const r = parseClock(`${meridiem ?? ''}${hour}点${minute ?? ''}`)
      return r.matched ? r.minutes : null
    }
    const a = clockAt(points[1], points[2], points[3])
    const b = clockAt(points[4], points[5], points[6])
    if (a !== null && b !== null) {
      /*
       * 原来这里把 points[0](整个匹配串)当起点、points[1](第一个数字)当终点,
       * 于是 "下午3点-4点" 解出来是 15:00–15:00,时长永远 0。
       * 现在两端各自解析;第二段没写上下午时,按「不早于起点」推一档。
       */
      const end = !points[4] && b <= a ? b + 720 : b
      return { start: a, end }
    }
  }
  return {}
}

/** 教室 / 地点识别 */
const PLACE_PATTERNS: RegExp[] = [
  // 教三302 / 一教201 / 教二305(允许"一/二"这样的楼号前缀)
  /(?:[一二三四五六七八九十\d]\s*)?教[一二三四五六七八九十\d]+(?:[室楼]\s*)?\d*[A-Za-z]?/,
  /[一二三四五六七八九十\d]+\s*[号楼幢栋]\s*\d*[A-Za-z]?/,
  /\d+\s*[号]?\s*教室/,
  /(实验楼|教学楼|物理楼|化学楼|生物楼|力学楼|体育馆|图书馆|报告厅|阶梯教室|机房|艺术中心|综合楼|活动中心|食堂|操场|游泳馆|篮球场|网球场|琴房|画室|演播厅|会议室)[A-Za-z0-9\-]*\d*/,
  /[一-龥]{1,4}(楼|馆|厅|室|中心)/,
  /[A-Z]\d{3,4}\b/,
]

export function parseLocation(text: string): string | undefined {
  for (const re of PLACE_PATTERNS) {
    const m = text.match(re)
    if (m) return m[0].trim()
  }
  return undefined
}

/** 课程名/地点切分:优先在地点前断开 */
function splitNameAndPlace(rest: string): { name: string; place?: string } {
  // 头尾的标点都要削:删掉「晚上7点-9点」之后会剩一个「- 」在前面
  const clean = (s: string) =>
    s
      .replace(/^[\s\-—_·,，。、:：;；/]+/, '')
      .replace(/[\s()（）\[\]【】,，。、:：;；\-—_/]+$/g, '')
      .trim()
  for (const re of PLACE_PATTERNS) {
    const m = rest.match(re)
    if (m && m.index !== undefined) {
      const name = clean(rest.slice(0, m.index))
      const place = m[0].trim()
      if (name) return { name, place }
      return { name: clean(rest.replace(m[0], '')), place }
    }
  }
  return { name: clean(rest) }
}

/** 常见课程词典,提升无标点输入的切分准确率 */
export const COURSE_HINTS = [
  '高等数学', '高数', '线性代数', '线代', '概率论', '大学英语', '英语', '大学物理', '大物',
  '数据结构', '算法设计', '计算机网络', '操作系统', '数据库系统', '软件工程', '面向对象',
  '数字逻辑', '离散数学', '编译原理', '人工智能', '机器学习', '深度学习', '计算机组成原理',
  '马克思主义基本原理', '马原', '中国近现代史纲要', '思修', '形势与政策', '毛泽东思想',
  '大学语文', '中国文学', '外国文学', '语言学概论', '传播学', '新闻学', '广告学',
  '微观经济学', '宏观经济学', '会计学', '财务管理', '金融学', '国际贸易', '市场营销',
  '管理学', '人力资源管理', '组织行为学', '运筹学', '统计学', '统计学原理',
  '体育', '体育鉴赏', '军事理论', '大学生心理健康', '职业规划', '劳动教育',
  '有机化学', '无机化学', '分析化学', '普通物理', '大学物理实验', '工程制图',
  '机械原理', '机械设计', '电路原理', '模拟电子', '数字电子', '自动控制原理',
]

const TEACHER_RE = /([一-龥]{1,4})\s*(?:老师|教授|副教授|讲师|教师)/

/**
 * 解析课程文本
 */
export function parseCourse(input: string, defaults?: { startWeek?: number; endWeek?: number }): ParsedCourse | null {
  const text = normalize(input)
  if (!text) return null
  const notes: string[] = []

  let weekday = parseWeekday(text)
  if (!weekday) weekday = weekdayFromRelative(text)
  if (!weekday) {
    notes.push('未识别到星期,已默认周一')
    weekday = 1
  }

  // 教学周范围,如 "1-16周" / "第3周起"
  let startWeek = defaults?.startWeek ?? 1
  let endWeek = defaults?.endWeek ?? 16
  const weekRange = text.match(/(\d{1,2})\s*[-~－到至]\s*(\d{1,2})\s*周/)
  if (weekRange) {
    startWeek = Number(weekRange[1])
    endWeek = Number(weekRange[2])
  } else {
    const singleWeek = text.match(/第\s*(\d{1,2})\s*周/)
    if (singleWeek) {
      startWeek = Number(singleWeek[1])
      endWeek = Number(singleWeek[1])
    }
  }

  const range = parseTimeRange(text)
  let startMinutes: number | undefined
  let endMinutes: number | undefined
  let period: number | undefined
  let periods: number | undefined

  if (range.periods) {
    period = range.periods[0]
    periods = range.periods[1] - range.periods[0] + 1
  } else if (range.start !== undefined && range.end !== undefined) {
    startMinutes = range.start
    endMinutes = range.end
  } else {
    const clock = parseClock(text)
    if (clock.matched) {
      startMinutes = clock.minutes
      endMinutes = clock.minutes + 45
      if (!clock.hadMeridiem) notes.push('未指定上午/下午,已按作息推断时间')
    }
  }

  // 从文本中剔除已识别的片段,剩下的是课程名 + 地点 + 老师
  let rest = text
  const stripPatterns: RegExp[] = [
    /周[一二三四五六日天1-7]/g,
    /星期[一二三四五六日天]/g,
    /礼拜[一二三四五六日天]/g,
    /今天|今日|明天|明日|后天|昨天|昨日/g,
    /\d{1,2}\s*[-~－到至]\s*\d{1,2}\s*周/g,
    /第\s*\d{1,2}\s*周/g,
    /\d{1,2}:\d{2}\s*[-~－到至]\s*\d{1,2}:\d{2}/g,
    /\d{1,2}\s*[-~－到至]\s*\d{1,2}\s*节/g,
    /第\s*\d{1,2}\s*节/g,
    /\d{1,2}\s*节/g,
    /(上午|早上|早晨|中午|下午|傍晚|晚上|夜里)/g,
    /\d{1,2}\s*[点时]\s*(?:\d{1,2}|半)?\s*分?/g,
    /[一二两三四五六七八九十]+\s*[点时]\s*(?:\d{1,2}|半)?\s*分?/g,
  ]
  for (const re of stripPatterns) rest = rest.replace(re, ' ')

  const teacherMatch = rest.match(TEACHER_RE)
  let teacher: string | undefined
  if (teacherMatch) {
    teacher = teacherMatch[1]
    rest = rest.replace(TEACHER_RE, ' ')
  }

  const { name, place } = splitNameAndPlace(rest)
  const cleanName = name.replace(/\s+/g, ' ').trim()

  if (!cleanName) return null

  return {
    name: cleanName,
    weekday,
    period: period ?? 1,
    periods: periods ?? 1,
    location: place,
    teacher,
    startTime: startMinutes !== undefined ? toHHMM(startMinutes) : undefined,
    endTime: endMinutes !== undefined ? toHHMM(endMinutes) : undefined,
    startWeek,
    endWeek,
    notes,
  }
}

export function toHHMM(minutes: number): string {
  /*
   * 不能 %24:23:00 的行程算结束时间是 24:00,取模后变成 00:00,
   * 于是「结束早于开始」,行程落到当天第 1 节。
   * 24:00 本身是合法写法,保留。
   */
  const total = Math.max(0, Math.min(24 * 60, Math.round(minutes)))
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** 解析作业/待办文本 */
export function parseHomework(input: string, defaults?: { startWeek?: number; endWeek?: number }): ParsedHomework | null {
  const text = normalize(input)
  if (!text) return null
  const notes: string[] = []

  const weekday = parseWeekday(text) ?? weekdayFromRelative(text) ?? 1
  const isRecurring = /每(周|星期|礼拜)/.test(text)

  const timeMatch = text.match(/(\d{1,2}:\d{2})/)
  let timeOfDay = timeMatch ? timeMatch[1] : '23:59'
  if (!timeMatch) {
    const clock = parseClock(text)
    if (clock.matched) timeOfDay = toHHMM(clock.minutes)
    else notes.push('未识别到截止时间,已设为 23:59')
  }

  let startWeek = defaults?.startWeek ?? 1
  let endWeek = defaults?.endWeek ?? 20
  const weekRange = text.match(/(\d{1,2})\s*[-~－到至]\s*(\d{1,2})\s*周/)
  if (weekRange) {
    startWeek = Number(weekRange[1])
    endWeek = Number(weekRange[2])
  }

  let title = text
    .replace(/每\s*(?:周|星期|礼拜)\s*[一二三四五六日天1-7]/g, '')
    .replace(/(?:周|星期|礼拜)\s*[一二三四五六日天1-7]/g, '')
    .replace(/每\s*(?:周|星期|礼拜)/g, '')
    .replace(/今天|今日|明天|明日|后天|昨天|昨日/g, '')
    .replace(/(\d{1,2}:\d{2})/g, '')
    .replace(/(上午|早上|中午|下午|晚上)/g, '')
    .replace(/\d{1,2}\s*[点时]\s*(?:\d{1,2}|半)?\s*分?/g, '')
    .replace(/\d{1,2}\s*[-~－到至]\s*\d{1,2}\s*周/g, '')
    .replace(/第\s*\d{1,2}\s*周/g, '')
    .replace(/(之前|以前|截止|deadline|前完成|提交|交|做)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!title) title = text
  if (isRecurring) notes.push('识别为每周重复任务')

  return { title, weekday, timeOfDay, startWeek, endWeek, notes }
}

/* =====================================================================
 * 行程识别 —— 把一条微信消息读成「什么时候、在哪、干什么」
 *
 *   "周三下午3点开党会,在教三201"
 *     → 党团 / 本周三 15:00–16:00 / 教三201
 *
 *   "明天晚上7点学生会例会,学生活动中心301,记得带笔记本"
 *     → 会议 / 明天 19:00–20:00 / 学生活动中心301 / 备注:记得带笔记本
 *
 * 识别结果一律先回填表单、让人确认,再落库。
 * ===================================================================== */

export interface ParsedEvent {
  /** 行程标题 */
  title: string
  /** 类型 */
  kind: EventKind
  /** 日期 YYYY-MM-DD */
  date: string
  /** 开始时间 HH:mm */
  start: string
  /** 结束时间 HH:mm */
  end: string
  /** 地点 */
  location?: string
  /** 备注 */
  detail?: string
  /** 每周重复 */
  weekly: boolean
  /** 识别过程中的提示(有拿不准的地方就说明) */
  notes: string[]
}

/* ---------------- 日期 ---------------- */

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() + n)
  return x
}

const REL_OFFSET: Record<string, number> = {
  大后天: 3, 后天: 2, 明天: 1, 明日: 1, 明晚: 1, 明早: 1, 今晚: 0, 今夜: 0, 今早: 0,
  今天: 0, 今日: 0, 前天: -2, 昨天: -1, 昨日: -1,
}

/**
 * 把「周三」「下周五」「今天」「12月3日」解析成具体日期。
 * 遇到「周X」默认取最近的那一天(含今天);「下/上」再整体平移一周。
 */
export function resolveEventDate(
  text: string,
  now = new Date(),
): { date: string; weekly: boolean; note?: string } {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  // 1) 具体月日(12月3日 / 11/12)
  const md =
    text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/) ??
    text.match(/(\d{1,2})\s*\/\s*(\d{1,2})(?!\s*[点时节])/)
  if (md) {
    const mo = Number(md[1])
    const da = Number(md[2])
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      let d = new Date(base.getFullYear(), mo - 1, da)
      // 已经过去很久 → 理解成明年
      if (d.getTime() < base.getTime() - 3 * 86_400_000) {
        d = new Date(base.getFullYear() + 1, mo - 1, da)
      }
      return { date: ymd(d), weekly: false }
    }
  }

  // 2) 今天 / 明天 / 后天…(今晚 / 明晚 只影响日期,时间由 parseEventTime 处理)
  const rel = text.match(/大后天|后天|明天|明日|明晚|明早|今晚|今夜|今早|今天|今日|前天|昨天|昨日/)
  if (rel) {
    return { date: ymd(addDays(base, REL_OFFSET[rel[0]])), weekly: false }
  }

  // 3) 星期几
  const wd = parseWeekday(text)
  if (wd) {
    const todayDow = base.getDay() === 0 ? 7 : base.getDay()
    const next = /下\s*(?:个)?\s*(?:周|星期|礼拜)/.test(text)
    const prev = /上\s*(?:个)?\s*(?:周|星期|礼拜)/.test(text)
    let d: Date
    if (next || prev) {
      /*
       * 不能「先归一到最近的周X,再 ±7 天」:
       * 本周三说「下周一」时,周一已经过去,归一时已经跳进了下周,
       * 再 +7 就变成两周后 —— 出现「下周三只跳一周、下周一跳两周」的自相矛盾。
       * 直接算「下周/上周的周一」再取星期几。
       */
      const mondayThisWeek = addDays(base, 1 - todayDow)
      const target = next ? addDays(mondayThisWeek, 7) : addDays(mondayThisWeek, -7)
      d = addDays(target, wd - 1)
    } else {
      const delta = (wd - todayDow + 7) % 7
      d = addDays(base, delta)
    }
    const weekly = /每\s*(?:周|星期|礼拜)/.test(text)
    return { date: ymd(d), weekly }
  }

  return { date: ymd(base), weekly: false, note: '没读到日期,先按今天' }
}

/* ---------------- 时间 ---------------- */

const MERIDIEM = '上午|早上|早晨|中午|下午|傍晚|晚上|夜里|今晚|今夜|明晚|明早'
const NUM_TOKEN = '\\d{1,2}|[一二两三四五六七八九十]+'

/** 由「下午 + 3 + 半」算出分钟数 */
function clockFrom(m: string | undefined, h: string | undefined, mi: string | undefined): number | null {
  if (!h) return null
  let hour = /^\d+$/.test(h) ? Number(h) : cnToNumber(h)
  if (hour === null || Number.isNaN(hour)) return null
  let minute = 0
  if (mi === '半') minute = 30
  else if (mi === '一刻') minute = 15
  else if (mi && /^\d+$/.test(mi)) minute = Number(mi)

  if (m) {
    if (/下午|傍晚|晚|夜/.test(m) && hour < 12) hour += 12
    if (m === '中午' && hour < 12) hour = 12
    if (/上午|早上|早晨|早/.test(m) && hour === 12) hour = 0
  } else if (hour >= 1 && hour <= 6) {
    // 没写上下午:1~6 点按下午/晚上理解,7~11 点按上午理解
    hour += 12
  }
  return hour * 60 + minute
}

/**
 * 读出行程的时间。
 * 支持:15:00-16:30 / 下午3点到4点半 / 晚上7点 / 3-4节 / 3点半
 */
export function parseEventTime(text: string): {
  start?: number
  end?: number
  periods?: [number, number]
} {
  // HH:MM-HH:MM
  const full = text.match(
    /(\d{1,2})\s*[:：]\s*(\d{2})\s*[-~－到至]\s*(\d{1,2})\s*[:：]\s*(\d{2})/,
  )
  if (full) {
    return {
      start: Number(full[1]) * 60 + Number(full[2]),
      end: Number(full[3]) * 60 + Number(full[4]),
    }
  }

  // 节次:3-4节 / 第5节
  const per = text.match(/(\d{1,2})\s*[-~－到至]\s*(\d{1,2})\s*节/) ??
    text.match(/第\s*(\d{1,2})\s*节/)
  if (per) {
    return { periods: [Number(per[1]), Number(per[2] ?? per[1])] }
  }

  // 3点到4点半(注意:结束时间的「半/一刻」也要捕获)
  const pts = text.match(
    new RegExp(
      `(${MERIDIEM})?\\s*(${NUM_TOKEN})\\s*[点时]\\s*(\\d{1,2}|半|一刻)?\\s*分?\\s*[-~－到至]\\s*(${MERIDIEM})?\\s*(${NUM_TOKEN})\\s*[点时]\\s*(\\d{1,2}|半|一刻)?`,
    ),
  )
  if (pts) {
    const s = clockFrom(pts[1], pts[2], pts[3])
    let e = clockFrom(pts[4], pts[5], pts[6])
    if (s !== null && e !== null) {
      if (!pts[4] && e <= s) e += 12 * 60 // 结束时间沿用开始时间的上下午
      return { start: s, end: e }
    }
  }

  // 单个时间点:下午3点 / 3点半 / 15:00
  const one = text.match(
    new RegExp(`(${MERIDIEM})?\\s*(${NUM_TOKEN})\\s*[点时]\\s*(\\d{1,2}|半|一刻)?\\s*分?`),
  )
  if (one) {
    const s = clockFrom(one[1], one[2], one[3])
    if (s !== null) return { start: s }
  }
  const hm = text.match(/(\d{1,2})\s*[:：]\s*(\d{2})/)
  if (hm) return { start: Number(hm[1]) * 60 + Number(hm[2]) }

  return {}
}

/* ---------------- 类型 ---------------- */

const EVENT_KIND_RULES: { kind: EventKind; words: string[] }[] = [
  {
    kind: 'party',
    words: [
      '党会', '党课', '党支', '党员', '党团', '党费', '入党', '团建', '团日', '团员', '团支',
      '联欢', '聚餐', '生日', '迎新', '送别', '团建',
    ],
  },
  {
    kind: 'meeting',
    words: [
      '会议', '例会', '班会', '开会', '碰头', '洽谈', '面谈', '谈话', '答辩', '面试', '会面',
      '见面', '见老师', '找老师', '小组会', '组会', '讨论', '部署',
    ],
  },
  {
    kind: 'club',
    words: ['社团', '纳新', '招新', '俱乐部', '社联', '志愿', '社会实践', '联谊', '评选'],
  },
  {
    kind: 'lecture',
    words: ['讲座', '报告', '分享会', '分享', '宣讲', '论坛', '沙龙', '培训', '演讲', '公开课', '听说'],
  },
]

/** 从文字里猜行程类型 */
export function inferEventKind(text: string): EventKind {
  for (const rule of EVENT_KIND_RULES) {
    if (rule.words.some((w) => text.includes(w))) return rule.kind
  }
  return 'other'
}

/* ---------------- 地点 ---------------- */

const EVENT_PLACE_PATTERNS: RegExp[] = [
  // 前缀最多 2 个汉字:「学生活动中心」要能认出来,但不能把「学生会例会」里的
  // 「例会」也吞掉(否则标题会被咬掉一截)。宁可少认,不可咬标题。
  /(?:[一-龥]{0,2}活动中心|教学楼|实验楼|综合楼|图书馆|体育馆|阶梯教室|大礼堂|报告厅|礼堂|会议室|咖啡厅|活动室|教室|食堂|操场|展厅)[A-Za-z0-9\-]*\d*/,
  // 教三302 / 一教201 / 二教305:楼号前缀必须一起吃掉,
  // 否则「一教201」会只摘到「教201」,标题里剩个「一」
  /(?:[一二三四五六七八九十\d]\s*)?教(?:[一二三四五六七八九十\d]+(?:[室楼])?\d*[A-Za-z]?|[室楼])/,
  /[一-龥]{1,4}楼(?:上|下|里|内)?[A-Za-z0-9\-]*\d*/,
  /[一-龥]{1,4}馆[A-Za-z0-9\-]*\d*/,
  /[一-龥]{1,4}厅[A-Za-z0-9\-]*\d*/,
  /\d+\s*教室/,
  /[A-Z]\d{3,4}\b/,
]

/** 行程地点:比课程地点更宽松一点(活动中心、会议室这类) */
export function parseEventLocation(text: string): string | undefined {
  const t = text.replace(/^(?:在|于|到|地点[:：]?|位置[:：]?|地址[:：]?)/, '').trim()
  for (const re of EVENT_PLACE_PATTERNS) {
    const m = t.match(re)
    if (!m) continue
    // 匹配到的开头如果带着介词,削掉(「在学生活动中心301」→「学生活动中心301」)
    const hit = m[0].trim().replace(/^(?:在|于|到)/, '').trim()
    if (hit) return hit
  }
  return parseLocation(t)
}

/* ---------------- 标题 ---------------- */

const LEAD_NOISE =
  /^(?:那个|对了|提醒一下|提醒|通知一下|通知|紧急|另外|还有|然后|顺便|重要|务必|记得|别忘了|大家|同学们|各位|请问|请|帮忙|帮我|我们|咱们|我)[,，、\s]*/

const LEAD_VERB = /^(?:去|来|要|得|需要|参加|参与|出席|开|举办|举行|进行|安排|准备|做|弄)/

/** 「在教三201有党会」里的那个「有」 */
const LEAD_PARTICLE = /^\s*(?:有|是)/

const EVENT_TITLE_STRIP: RegExp[] = [
  /大后天|后天|明晚|明早|明天|明日|今晚|今夜|今早|今天|今日|前天|昨天|昨日/g,
  /(?:下|这|本|上|每)\s*(?:个)?\s*(?:周|星期|礼拜)\s*[一二三四五六日天1-7]/g,
  /(?:周|星期|礼拜)\s*[一二三四五六日天1-7]/g,
  /\d{1,2}\s*月\s*\d{1,2}\s*[日号]?/g,
  /\d{1,2}\s*\/\s*\d{1,2}/g,
  /\d{1,2}\s*[:：]\s*\d{2}\s*[-~－到至]\s*\d{1,2}\s*[:：]\s*\d{2}/g,
  /\d{1,2}\s*[:：]\s*\d{2}/g,
  new RegExp(`(?:${MERIDIEM})\\s*(?:${NUM_TOKEN})\\s*[点时]\\s*(?:\\d{1,2}|半|一刻)?\\s*分?`, 'g'),
  new RegExp(`(?:${NUM_TOKEN})\\s*[点时]\\s*(?:\\d{1,2}|半|一刻)?\\s*分?`, 'g'),
  /第?\s*\d{1,2}\s*[-~－到至]\s*\d{1,2}\s*节/g,
  /第?\s*\d{1,2}\s*节/g,
]

/** 从剩下的文字里挑出标题 */
export function extractEventTitle(raw: string): string {
  let t = raw
  for (const re of EVENT_TITLE_STRIP) t = t.replace(re, ' ')
  t = t.replace(LEAD_NOISE, '')
  t = t.replace(/\s+/g, ' ').trim()
  t = t.replace(/[的地得了吧呀啊哦嗯呢嘛哈喔喔呀]+$/, '').trim()

  // 「有党会」→ 「党会」
  const noParticle = t.replace(LEAD_PARTICLE, '').trim()
  if (noParticle.length >= 2) t = noParticle

  // 去掉开头的动词(「开党会」→「党会」),但别把「开会」削成「会」
  const stripped = t.replace(LEAD_VERB, '').trim()
  if (stripped.length >= 2) t = stripped
  t = t.replace(/[的地得了吧呀啊哦嗯呢嘛哈]+$/, '').trim()
  return t
}

/* ---------------- 主入口 ---------------- */

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** 没读到时间时,取今天接下来最近的一节课 */
function nextPeriodSlot(
  periods: PeriodSlot[] | undefined,
  now: Date,
): { start: string; end: string } | null {
  if (!periods?.length) return null
  const clock = now.getHours() * 60 + now.getMinutes()
  for (const p of periods) {
    if (toMin(p.start) > clock) return { start: p.start, end: p.end }
  }
  return null
}

/** 段子里有没有日期线索 */
function hasDateSignal(text: string): boolean {
  return /\d{1,2}\s*月\s*\d{1,2}|大后天|后天|明晚|明早|明天|明日|今晚|今夜|今早|今天|今日|前天|昨天|昨日|(?:周|星期|礼拜)\s*[一二三四五六日天1-7]/.test(
    text,
  )
}

/** 段子里有没有时间线索 */
function hasTimeSignal(text: string): boolean {
  return /\d{1,2}\s*[:：]\s*\d{2}|[0-9一二两三四五六七八九十]+\s*[点时]\s*(?:\d{1,2}|半|一刻)?/.test(
    text,
  )
}

/**
 * 解析一条聊天消息 → 行程草稿
 *
 * @param opts.periods 学校作息表:用来把「第3-4节」换算成时间,
 *                     以及没写时间时挑最近一节课
 */
export function parseEvent(
  input: string,
  opts?: { now?: Date; periods?: PeriodSlot[] },
): ParsedEvent | null {
  // normalize() 会把 \n 压成空格,所以必须先切行、再逐行规范化
  // (之前先 normalize 再 split,lines 恒为 1 行,多行消息的第二行会被并进标题)
  const lines = input
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => normalize(l))
    .filter(Boolean)
  if (!lines.length) return null
  const now = opts?.now ?? new Date()
  const raw = lines[0]
  const notes: string[] = []
  const text = raw
  if (lines.length > 1) notes.push(`消息有 ${lines.length} 行,只识别了第 1 行`)

  const segs = text.split(/[,，;；。!！?？]+/).map((s) => s.trim()).filter(Boolean)
  if (!segs.length) return null

  // 主句 = 信号最多的一段(免得「提醒一下,周三下午3点…」这种前导寒暄把日期吃掉)
  let mainIdx = 0
  let bestScore = -1
  segs.forEach((s, i) => {
    const score =
      (hasDateSignal(s) ? 2 : 0) +
      (hasTimeSignal(s) ? 2 : 0) +
      (parseEventLocation(s) ? 1 : 0)
    if (score > bestScore) {
      bestScore = score
      mainIdx = i
    }
  })
  const main = segs[mainIdx]

  // —— 日期 ——
  const when = resolveEventDate(main, now)
  if (when.note) notes.push(when.note)

  // —— 时间 ——
  const t = parseEventTime(main)
  let start: number | undefined
  let end: number | undefined

  if (t.periods && opts?.periods?.length) {
    // 「3-4节」→ 按学校作息换算成钟点
    const i = opts.periods.findIndex((p) => p.index === t.periods![0])
    const j = opts.periods.findIndex((p) => p.index === t.periods![1])
    if (i >= 0) {
      start = toMin(opts.periods[i].start)
      end = j >= 0 ? toMin(opts.periods[j].end) : start + 45
    }
  }
  if (start === undefined && t.start !== undefined) start = t.start
  if (end === undefined && t.end !== undefined) end = t.end

  if (start === undefined) {
    const slot = nextPeriodSlot(opts?.periods, now)
    if (slot) {
      start = toMin(slot.start)
      end = toMin(slot.end)
      notes.push(`没读到时间,先按最近一节课 ${slot.start}–${slot.end} 排`)
    } else {
      start = 19 * 60
      end = 20 * 60
      notes.push('没读到时间,先按 19:00–20:00 排')
    }
  }
  if (end === undefined) {
    end = start + 60
    notes.push('没读到结束时间,先按 1 小时排')
  }
  if (end <= start) end = start + 60

  // —— 地点 / 备注 ——
  let location: string | undefined
  const detailParts: string[] = []
  let body = main
  const locInMain = parseEventLocation(body)
  if (locInMain) {
    location = locInMain
    // 把「在教三201」整段摘掉,别把那个「在」留在标题里
    const idx = body.indexOf(locInMain)
    if (idx >= 0) {
      const before = body.slice(0, idx).replace(/在\s*$/, '')
      body = `${before} ${body.slice(idx + locInMain.length)}`
    }
  }
  for (const seg of segs.filter((_, i) => i !== mainIdx)) {
    const loc = parseEventLocation(seg)
    if (loc) {
      if (!location) location = loc
      continue // 地点片段一律不进备注
    }
    const cleaned = seg.replace(LEAD_NOISE, '').trim()
    if (cleaned) detailParts.push(cleaned)
  }
  // 多行消息里除第一行以外都是补充说明(「记得带笔记本」)
  for (const extra of lines.slice(1)) {
    const cleaned = extra.replace(LEAD_NOISE, '').trim()
    if (cleaned) detailParts.push(cleaned)
  }

  // —— 标题 / 类型 ——
  let title = extractEventTitle(body)
  if (!title) {
    title = '新行程'
    notes.push('没读出标题,先留了个占位')
  }
  const kind = inferEventKind(`${title} ${main}`)

  return {
    title,
    kind,
    date: when.date,
    start: toHHMM(start),
    end: toHHMM(end),
    location,
    detail: detailParts.length ? detailParts.join(';') : undefined,
    weekly: when.weekly,
    notes,
  }
}
