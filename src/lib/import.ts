/**
 * 课表导入:Excel(教务系统导出) / PDF / 图片 OCR
 * 教务系统导出格式五花八门,这里做了:
 *   1) 表头别名映射(长表)
 *   2) 星期 × 节次矩阵表解析
 *   3) 自由文本行解析(PDF/OCR 兜底)
 */
import * as XLSX from 'xlsx'
import type { Course } from '../types'

export interface ImportedCourse {
  name: string
  teacher?: string
  location?: string
  weekday: number
  period: number
  periods: number
  startWeek: number
  endWeek: number
  singleWeeks?: number[]
  /** 合并相邻周次时记下的差异(比如「第10-12周由李四授课」) */
  remark?: string
  /** 来源行,便于回溯 */
  source?: string
}

export interface ImportResult {
  courses: ImportedCourse[]
  warnings: string[]
  /** 未识别但保留下来的原始内容 */
  unmatched: string[]
}

const HEADER_ALIASES: Record<string, string[]> = {
  name: ['课程名称', '课程名', '课程', '科目', '课程名称(全称)', '课程(名称)'],
  teacher: ['教师', '教师姓名', '任课教师', '任课老师', '老师', '授课教师', '教师名称'],
  location: ['地点', '教室', '上课地点', '上课教室', '教学地点', '教室地点', '上课地点/教室', '场地'],
  weekday: ['星期', '上课星期', '星期几', '周次星期', '上课时间(星期)'],
  period: ['节次', '上课节次', '节', '时间段'],
  weeks: ['周次', '上课周次', '周数', '起止周', '周次(周)', '周次范围', '开课周次'],
  time: ['上课时间', '时间', '时间/节次', '上课时间及地点'],
}

const WEEKDAY_CHARS = ['一', '二', '三', '四', '五', '六', '日']

/** 从表头名推断字段:先精确匹配,再按"最长别名"包含匹配 */
function matchField(header: string): string | null {
  const h = String(header ?? '')
    .replace(/[\s()（）]/g, '')
    .toLowerCase()
  if (!h) return null

  // 1) 精确匹配
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      const a = alias.replace(/[\s()（）]/g, '').toLowerCase()
      if (h === a) return field
    }
  }

  // 2) 包含匹配:取最长的命中别名,同长度按字段优先级
  const priority = ['weeks', 'weekday', 'period', 'location', 'teacher', 'time', 'name']
  let best: { field: string; len: number } | null = null
  for (const field of priority) {
    for (const alias of HEADER_ALIASES[field]) {
      const a = alias.replace(/[\s()（）]/g, '').toLowerCase()
      if (a.length < 2) continue
      if (h.includes(a) && (!best || a.length > best.len)) {
        best = { field, len: a.length }
      }
    }
  }
  return best?.field ?? null
}

function parseWeekdayValue(raw: unknown): number | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  // 优先匹配「周X / 星期X / 礼拜X」,避免把教室名里的"教三"当成星期三
  const explicit = s.match(/[周星期礼拜]\s*([一二三四五六日天1-7])/)
  if (explicit) {
    const token = explicit[1]
    if (/^[1-7]$/.test(token)) return Number(token)
    const idx = WEEKDAY_CHARS.indexOf(token === '天' ? '日' : token)
    if (idx >= 0) return idx + 1
  }
  if (/^[1-7]$/.test(s)) return Number(s)
  // 兜底:整串就是一个星期字符(表头可能是"一"这种写法)
  if (s.length === 1) {
    const idx = WEEKDAY_CHARS.indexOf(s === '天' ? '日' : s)
    if (idx >= 0) return idx + 1
  }
  return null
}

/** 解析节次:"1-2" / "第1-2节" / "1,2,3" / "1-2节" */
function parsePeriodValue(raw: unknown): { period: number; periods: number } | null {
  const s = String(raw ?? '').replace(/第|节/g, '').trim()
  if (!s) return null
  const range = s.match(/(\d{1,2})\s*[-~－—到至]\s*(\d{1,2})/)
  if (range) {
    const a = Number(range[1])
    const b = Number(range[2])
    return { period: Math.min(a, b), periods: Math.abs(b - a) + 1 }
  }
  const list = s.match(/\d{1,2}/g)
  if (list && list.length) {
    const nums = list.map(Number).filter((n) => n >= 1 && n <= 20)
    if (nums.length) {
      const min = Math.min(...nums)
      const max = Math.max(...nums)
      return { period: min, periods: max - min + 1 }
    }
  }
  return null
}

/** 解析周次:"1-16" / "1-16周" / "单周" / "双周" / "第1-8周(单)" */
function parseWeeksValue(raw: unknown): { startWeek: number; endWeek: number; singleWeeks?: number[] } | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const range = s.match(/(\d{1,2})\s*[-~－—到至]\s*(\d{1,2})/)
  if (range) {
    const startWeek = Number(range[1])
    const endWeek = Number(range[2])
    // 奇数周/单周标记
    if (/单/.test(s) && endWeek >= startWeek) {
      const singleWeeks: number[] = []
      for (let w = startWeek; w <= endWeek; w++) if (w % 2 === 1) singleWeeks.push(w)
      return { startWeek, endWeek, singleWeeks }
    }
    if (/双/.test(s) && endWeek >= startWeek) {
      const singleWeeks: number[] = []
      for (let w = startWeek; w <= endWeek; w++) if (w % 2 === 0) singleWeeks.push(w)
      return { startWeek, endWeek, singleWeeks }
    }
    return { startWeek, endWeek }
  }
  const single = s.match(/第?\s*(\d{1,2})\s*周/)
  if (single) {
    const w = Number(single[1])
    return { startWeek: w, endWeek: w, singleWeeks: [w] }
  }
  return null
}

/** 从任意文本里挖出周次信息(比"周次列"更严格:必须出现"周"或括号) */
function extractWeeks(text: string): { startWeek: number; endWeek: number; singleWeeks?: number[] } | null {
  // 1) 明确带"周"的范围,如 "1-16周"
  const range = text.match(/(\d{1,2})\s*[-~－—到至]\s*(\d{1,2})\s*周/)
  if (range) {
    const startWeek = Number(range[1])
    const endWeek = Number(range[2])
    if (endWeek >= startWeek) {
      if (/单/.test(text)) {
        const singleWeeks: number[] = []
        for (let w = startWeek; w <= endWeek; w++) if (w % 2 === 1) singleWeeks.push(w)
        return { startWeek, endWeek, singleWeeks }
      }
      if (/双/.test(text)) {
        const singleWeeks: number[] = []
        for (let w = startWeek; w <= endWeek; w++) if (w % 2 === 0) singleWeeks.push(w)
        return { startWeek, endWeek, singleWeeks }
      }
      return { startWeek, endWeek }
    }
  }

  // 2) 括号里的范围,如 "(1-16)" "(1-16周)"
  const paren = text.match(/[（(]\s*(\d{1,2})\s*[-~－—到至]\s*(\d{1,2})\s*周?\s*[)）]/)
  if (paren) {
    const startWeek = Number(paren[1])
    const endWeek = Number(paren[2])
    if (endWeek >= startWeek) return { startWeek, endWeek }
  }

  // 3) 单周,如 "第3周"
  const single = text.match(/第\s*(\d{1,2})\s*周/)
  if (single) {
    const w = Number(single[1])
    return { startWeek: w, endWeek: w, singleWeeks: [w] }
  }

  return null
}

const PLACE_WORD_RE =
  /^(?:实验楼|教学楼|物理楼|化学楼|生物楼|力学楼|体育馆|图书馆|报告厅|阶梯教室|机房|艺术中心|综合楼|活动中心|食堂|操场|游泳馆|篮球场|网球场|琴房|画室|演播厅|会议室|体育馆|实验室)/

/** 一个独立的 token 是否就是"教室/地点" */
function isPlaceToken(tk: string): boolean {
  const t = tk.replace(/\s+/g, '')
  if (!t) return false
  // 教三302 / 一教201 / 教二 305 / 教三楼
  if (/^(?:[一二三四五六七八九十\d])?教[一二三四五六七八九十\d]+(?:[室楼])?\d*[A-Za-z]?$/.test(t)) return true
  if (/^[一二三四五六七八九十\d]+[号楼幢栋]\d*[A-Za-z]?$/.test(t)) return true
  if (/^\d+教室$/.test(t)) return true
  // 教学楼 / 外语楼201 / 阶梯教室A101 / 文学院 / 机房 / 操场 / 篮球场
  // (要整串匹配,否则「机房实习」这种课程名会被当成地点)
  if (/^[一-龥]{1,6}(?:楼|馆|厅|室|中心|球场|礼堂|食堂|房|院|场|园|所|站|路|街)(?:[A-Za-z]?\d{1,4})?$/.test(t))
    return true
  if (/^[A-Z]\d{3,4}$/.test(t)) return true
  return false
}

/** 常见姓氏(判断「裸姓名」是不是教师) */
const SURNAMES = new Set(
  '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜谢邹柏窦章云苏潘葛范彭鲁韦马苗方俞任袁柳史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐傅皮卞齐康伍余元顾孟平黄萧尹姚邵汪祁毛禹狄米贝明臧计伏成戴谈宋庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万柯管卢莫房解应宗丁宣邓郁单杭洪包左石崔吉龚程嵇邢裴陆荣翁荀羊惠甄曲家封储靳段富巫乌焦巴牧山谷车侯班秋仲伊宫宁仇栾甘厉祖武符刘景詹龙叶幸韶郜黎印宿白怀蒲鄂索赖卓蔺屠蒙池乔邢翟'.split(''),
)

/** 常见的课程属性词,不是人名 */
const NOT_A_NAME = /^(?:必修|选修|限选|考查|考试|实验|理论|实践|全周|单周|双周|学分|学时|大纲|教材|分组|辅导|答疑|重修|补修|面向|面向对象|工科|理科|文科|公共|专业|通识|必修课|选修课)$/

/**
 * 判断一个 token 是不是「裸姓名」(教师)。
 * 教务表里教师常常就写「张三」,没有「老师」后缀。
 * 靠姓氏判断比靠字数稳 —— 两三个汉字的词可能是「必修」「实验」这类属性词。
 */
function looksLikeTeacherName(tk: string): boolean {
  if (!/^[一-龥]{2,4}$/.test(tk)) return false
  if (!SURNAMES.has(tk[0])) return false
  if (isPlaceToken(tk)) return false
  if (NOT_A_NAME.test(tk)) return false
  return true
}

/** 单元格里的「元信息行」:周次、单双周、节次范围 —— 不是课程名也不是教师 */
function isMetaLine(line: string): boolean {
  const t = line.trim()
  if (!t) return true
  if (/^\d{1,2}\s*[-~－—到至]\s*\d{0,2}\s*周?$/.test(t)) return true
  if (/^第?\s*\d{1,2}\s*周/.test(t)) return true
  if (/^[（(]?\s*(?:单|双)\s*周?\s*[)）]?$/.test(t)) return true
  if (/^\d{1,2}\s*[-~－—到至]\s*\d{1,2}\s*节$/.test(t)) return true
  if (/^\d{1,2}\s*节$/.test(t)) return true
  if (/^[（(][^）)]*[)）]$/.test(t) && !/[一-龥]{2,4}(老师|教授|讲师)/.test(t)) return true
  return false
}

/** 从一段文本中拆出教师与地点(按空白分词,避免把后面的数字误吞进教室号) */
function extractTeacherAndPlace(text: string): { teacher?: string; location?: string; rest: string } {
  let teacher: string | undefined
  let location: string | undefined
  let rest = text

  // 1) 括号里的教师,如 "(张老师)"
  const parenTeacher = rest.match(/[（(]\s*([\u4e00-\u9fa5]{1,4})\s*(?:老师|教授|副教授|讲师|教师)\s*[)）]/)
  if (parenTeacher) {
    teacher = parenTeacher[1]
    rest = rest.replace(parenTeacher[0], ' ')
  }

  // 2) 逐个 token 识别教师与地点
  const kept: string[] = []
  for (const raw of rest.split(/\s+/).filter(Boolean)) {
    const tk = raw.replace(/^[（(@*]+|[)）,，。;；:：]+$/g, '')
    if (!teacher) {
      const m = tk.match(/^([\u4e00-\u9fa5]{1,4})(?:老师|教授|副教授|讲师|教师)$/)
      if (m) {
        teacher = m[1]
        continue
      }
    }
    if (!location && isPlaceToken(tk)) {
      location = tk
      continue
    }
    kept.push(tk)
  }
  rest = kept.join(' ')

  // 3) 兜底:教师与课程名连写,如 "高等数学张老师"
  if (!teacher) {
    const m = rest.match(/([\u4e00-\u9fa5]{1,3})(老师|教授|副教授|讲师|教师)/)
    if (m) {
      teacher = m[1]
      rest = rest.replace(m[0], ' ')
    }
  }

  return { teacher, location, rest: rest.replace(/\s+/g, ' ').trim() }
}

/** 从文本里提取课程名(去掉周次、节次、地点、老师后剩下的部分) */
function extractName(text: string): string {
  const cleaned = text
    .replace(/[（(][^）)]{0,12}[）)]/g, ' ')
    .replace(/\d{1,2}\s*[-~－—到至]\s*\d{1,2}\s*周/g, ' ')
    .replace(/第\s*\d{1,2}\s*周/g, ' ')
    .replace(/\d{1,2}\s*[-~－—到至]\s*\d{1,2}\s*节/g, ' ')
    .replace(/第\s*\d{1,2}\s*节/g, ' ')
    .replace(/\d{1,2}\s*节/g, ' ')
    .replace(/周[一二三四五六日天1-7]/g, ' ')
    .replace(/星期[一二三四五六日天]/g, ' ')
    .replace(/[\d:：~\-—至到]/g, ' ')
  return cleaned
    .split(/\s+/)
    .filter((tk) => tk && !isPlaceToken(tk))
    .join(' ')
    .trim()
}

/**
 * 解析一行自由文本(用于 PDF / OCR)
 */
export function parseFreeTextLine(line: string): ImportedCourse | null {
  const text = line.trim()
  if (!text || text.length < 2) return null

  const weekday = parseWeekdayValue(text)
  if (!weekday) return null

  let periodInfo = parsePeriodValue(text.match(/(\d{1,2}\s*[-~－—到至]\s*\d{1,2}\s*节|\d{1,2}\s*节)/)?.[0] ?? '')
  if (!periodInfo) {
    const tm = text.match(/(\d{1,2}:\d{2})\s*[-~－—到至]\s*(\d{1,2}:\d{2})/)
    if (tm) periodInfo = { period: 1, periods: 1 }
  }
  if (!periodInfo) return null

  const weeks = extractWeeks(text) ?? { startWeek: 1, endWeek: 16 }
  const { teacher, location, rest } = extractTeacherAndPlace(text)
  const name = extractName(rest) || extractName(text)
  if (!name) return null

  return {
    name,
    teacher,
    location,
    weekday,
    period: periodInfo.period,
    periods: periodInfo.periods,
    startWeek: weeks.startWeek,
    endWeek: weeks.endWeek,
    singleWeeks: weeks.singleWeeks,
    source: text,
  }
}

/* ---------------- 矩阵型课表 ---------------- */

/** 中文数字 → 阿拉伯数字(一 ~ 九十九) */
const CN_DIGIT: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

function cnToNumber(s: string): number | null {
  if (!s) return null
  // 十 / 十九 / 二十 / 二十一
  if (s.includes('十')) {
    const [a, b] = s.split('十')
    const tens = a ? CN_DIGIT[a] : 1
    const ones = b ? CN_DIGIT[b] : 0
    if (tens === undefined || ones === undefined) return null
    return tens * 10 + ones
  }
  if (s.length === 1) {
    const v = CN_DIGIT[s]
    return v === undefined ? null : v
  }
  return null
}

/**
 * 解析节次标签。
 *
 * 教务系统导出的节次写法五花八门,这些都得认:
 *   第一节 / 第1节 / 1 / 一 / 1-2节 / 第1-2节 / 1,2节 / 1、2节 / 大节(1-2)
 * 返回起始节次 + 连续节数。
 */
export function parsePeriodLabel(raw: unknown): { start: number; count: number } | null {
  let s = String(raw ?? '').trim()
  if (!s) return null
  s = s.replace(/[（(][^)）]*[)）]/g, ' ') // 去掉括号注释
  s = s.replace(/大节|小节|单节|连排/g, '')
  // 中文数字先转成阿拉伯数字(只在这一个标签上做,影响面可控)
  s = s.replace(/[零〇一二两三四五六七八九十]{1,3}/g, (m) => {
    const n = cnToNumber(m)
    return n === null ? m : String(n)
  })
  s = s.replace(/第|节/g, ' ').trim()
  if (!s) return null

  // 1-2 / 1~2 / 1到2 / 1－2
  const range = s.match(/(\d{1,2})\s*[-~－—到至]\s*(\d{1,2})/)
  if (range) {
    const a = Number(range[1])
    const b = Number(range[2])
    if (a >= 1 && a <= 30 && b >= a && b <= 30) return { start: a, count: b - a + 1 }
  }
  // 1,2,3 / 1、2
  if (/^\d{1,2}(\s*[,，、]\s*\d{1,2})+$/.test(s)) {
    const nums = s
      .split(/[,，、]/)
      .map((x) => Number(x.trim()))
      .filter((n) => n >= 1 && n <= 30)
    if (nums.length) return { start: Math.min(...nums), count: nums.length }
  }
  // 单个节次
  const one = s.match(/^(\d{1,2})$/)
  if (one) {
    const n = Number(one[1])
    if (n >= 1 && n <= 30) return { start: n, count: 1 }
  }
  return null
}

/**
 * 左列/表头给的是不是「时间」而不是「第 N 节」。
 *
 * 很多教务导出的 PDF 课表,行首写的是 08:00-08:45 这种具体时间,
 * 没有「第一节」字样。这种表如果只认节次标签,整张表会被判成「不是课表」。
 */
export function isTimeLabel(raw: unknown): boolean {
  return /^\s*\d{1,2}\s*[:：]\s*\d{2}/.test(String(raw ?? ''))
}

/** 矩阵的排布方式 */
export interface MatrixLayout {
  /** 表头在第几行(教务导出常在第一行放学校/学期标题) */
  headerRow: number
  /** true = 行是星期、列是节次(转置表) */
  transposed: boolean
}

/**
 * 判断一个二维表是否为课表矩阵,并认出它的排布方向。
 *
 * 真实教务导出的样子差别很大,这里都得认:
 *   · 表头前面可能有「XX大学2025-2026学年第1学期课程表」这种标题行
 *   · 节次标签可能是「第一节」(中文数字)也可能是「第1节」
 *   · 有些系统是行=星期、列=节次(转置)
 */
export function detectMatrixLayout(rows: any[][]): MatrixLayout | null {
  if (!rows.length) return null

  // 长表优先:表头里能认出「课程名称 / 教师 / 星期 / 节次」这些列,那就是长表,别走矩阵
  if (looksLikeLongTableHeader(rows[0] ?? [])) return null

  const limit = Math.min(rows.length, 10)
  for (let r = 0; r < limit; r++) {
    const head = (rows[r] ?? []).map((c) => String(c ?? '').trim())
    const weekdayCols = head.filter((h) => parseWeekdayValue(h) !== null).length
    const periodCols = head.filter((h) => parsePeriodLabel(h) !== null).length
    const timeCols = head.filter((h) => isTimeLabel(h)).length

    const rowLabels = rows
      .slice(r + 1, r + 8)
      .map((x) => String(x?.[0] ?? '').trim())
      .filter(Boolean)
    if (!rowLabels.length) continue
    const weekdayRows = rowLabels.filter((l) => parseWeekdayValue(l) !== null).length
    const periodRows = rowLabels.filter((l) => parsePeriodLabel(l) !== null).length
    // 行首写的是 08:00-08:45 也算「节次轴」,只是具体节号按行序推
    const timeRows = rowLabels.filter((l) => isTimeLabel(l)).length
    const need = Math.max(1, Math.ceil(rowLabels.length / 2))

    // 横向:表头是星期,行首是节次(或时间)
    if (weekdayCols >= 2 && (periodRows >= need || timeRows >= need)) {
      return { headerRow: r, transposed: false }
    }
    // 纵向(转置):表头是节次(或时间),行首是星期
    if ((periodCols >= 2 || timeCols >= 2) && weekdayRows >= need) {
      return { headerRow: r, transposed: true }
    }
  }
  return null
}

/**
 * 表头像不像「长表型」课表。
 *
 * 必须挡在矩阵检测前面:长表里常有一列「序号」(1、2、3……),
 * 而「1」既像星期几(一)又像节次,不做这道闸就会被误判成矩阵。
 *
 * 注意区分:
 *   长表表头 → 「星期」「节次」这种**通用词**单独成列
 *   矩阵表头 → 「星期一」「第一节」这种**具体值**
 */
function looksLikeLongTableHeader(head: (string | number)[]): boolean {
  const raw = head.map((h) => String(h ?? '').replace(/[\s()（）]/g, '').toLowerCase())
  const fields = head.map((h) => matchField(String(h ?? ''))).filter(Boolean)
  if (fields.length < 3) return false
  // 有「课程名称」这一列,基本可以确定是长表
  if (fields.includes('name')) return true
  const genericWeekday = raw.some((h) => h === '星期' || h === '礼拜' || h === '星期几' || h === '上课星期')
  const genericPeriod = raw.some((h) => h === '节次' || h === '节' || h === '上课节次')
  return genericWeekday && genericPeriod
}

/** 从 XLSX 的合并单元格信息里,算出某个格子横跨几行(横向表)或几列(纵向表) */
function mergeSpan(
  merges: { s: { r: number; c: number }; e: { r: number; c: number } }[],
  r: number,
  c: number,
  transposed: boolean,
): number {
  for (const m of merges) {
    if (transposed) {
      if (m.s.r === r && c >= m.s.c && c <= m.e.c) return m.e.c - m.s.c + 1
    } else {
      if (m.s.c === c && r >= m.s.r && r <= m.e.r) return m.e.r - m.s.r + 1
    }
  }
  return 1
}

/**
 * 解析矩阵型课表。
 *
 * @param layout  表头行号与方向(横向:行=节次 列=星期;纵向:行=星期 列=节次)
 * @param merges  XLSX 合并单元格信息,用来还原「一节课连排两节」
 */
function parseMatrix(
  rows: any[][],
  layout: MatrixLayout,
  merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [],
): ImportedCourse[] {
  const head = (rows[layout.headerRow] ?? []).map((c) => String(c ?? '').trim())
  const out: ImportedCourse[] = []

  // 横向表:列 = 星期;纵向表:列 = 节次
  const colWeekday = layout.transposed ? [] : head.map((h) => parseWeekdayValue(h))
  let timeColSeq = 0
  const colPeriod = layout.transposed
    ? head.map((h) => {
        const p = parsePeriodLabel(h)
        if (p) return p
        // 表头写的是 08:00-08:45:按列序推节次
        if (isTimeLabel(h)) return { start: ++timeColSeq, count: 1 }
        return null
      })
    : []

  /*
   * 同理,行首写的是时间(08:00-08:45)而不是「第1节」时,
   * 按行序推节次。排在「第N节」之后兜底,不影响正常的表。
   */
  const periodByRow = new Map<number, { start: number; count: number }>()
  if (!layout.transposed) {
    const timeRows: number[] = []
    for (let r = layout.headerRow + 1; r < rows.length; r++) {
      const label = String(rows[r]?.[0] ?? '').trim()
      if (isTimeLabel(label) && !parsePeriodLabel(label)) timeRows.push(r)
    }
    if (timeRows.length >= 2) timeRows.forEach((r, i) => periodByRow.set(r, { start: i + 1, count: 1 }))
  }

  for (let r = layout.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? []
    const label = String(row[0] ?? '').trim()

    // 这一行的「星期」和「节次」
    const rowWeekday = layout.transposed ? parseWeekdayValue(label) : null
    const rowPeriod = layout.transposed ? null : parsePeriodLabel(label) ?? periodByRow.get(r) ?? null
    if (layout.transposed && !rowWeekday) continue
    if (!layout.transposed && !rowPeriod) continue

    for (let c = 1; c < row.length; c++) {
      const weekday = layout.transposed ? rowWeekday : colWeekday[c]
      const periodInfo = layout.transposed ? colPeriod[c] : rowPeriod
      if (!weekday || !periodInfo) continue

      const cellRaw = row[c]
      if (cellRaw === null || cellRaw === undefined || String(cellRaw).trim() === '') continue
      const cell = String(cellRaw)
      const lines = cell
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean)
      if (!lines.length) continue

      /*
       * 单元格有两种排法:
       *   多行 → 「课程名 / 教师 / 教室」一行一项(最常见)
       *   单行 → 全挤在一格、用空格分隔(「高等数学 张三 教三302 1-16周」)
       * 单行时得按空格切开,否则「张三」这种裸教师名会被算进课程名。
       */
      const singleLine = lines.length === 1
      let name = ''
      let tail: string[] = []
      if (singleLine) {
        const tokens = lines[0].split(/\s+/).filter(Boolean)
        // 找到第一个「教师」或「教室」token,前面的一段是课程名
        let cut = tokens.length
        for (let i = 1; i < tokens.length; i++) {
          const tk = tokens[i].replace(/^[（(@*]+|[)）,，。;；:：]+$/g, '').trim()
          if (!tk || isMetaLine(tokens[i])) continue
          const isTeacher =
            /([一-龥]{1,4})(?:老师|教授|副教授|讲师|教师)/.test(tk) || looksLikeTeacherName(tk)
          if (isTeacher || isPlaceToken(tk)) {
            cut = i
            break
          }
        }
        name = tokens.slice(0, cut).join(' ')
        tail = tokens.slice(cut)
      } else {
        let nameIdx = 0
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          if (line.startsWith('@') || /^[（(]/.test(line)) continue
          if (/^\d{1,2}\s*[-~－]?\s*\d{0,2}\s*周/.test(line)) continue
          name = line
          nameIdx = i
          break
        }
        tail = lines.slice(nameIdx + 1)
      }
      if (!name) name = lines[0].replace(/^@/, '')
      name = name.replace(/\s+/g, ' ').trim()
      if (!name) continue

      const joined = lines.join(' ')

      /*
       * 教务矩阵单元格的标准结构是「课程名 / 教师 / 教室」,一行一项。
       * 按行取比按词扫准得多 —— 尤其是「张三」这种裸姓名:
       * 没有「老师」后缀,按词扫认不出来,但按位置就知道它是教师。
       */
      let teacher: string | undefined
      let location: string | undefined
      for (const line of tail) {
        if (isMetaLine(line)) continue
        const tk = line.replace(/^[（(@*]+|[)）,，。;；:：]+$/g, '').trim()
        if (!tk) continue
        if (!teacher) {
          const tm = tk.match(/([\u4e00-\u9fa5]{1,4})(?:老师|教授|副教授|讲师|教师)/)
          if (tm) {
            teacher = tm[1]
            continue
          }
          if (looksLikeTeacherName(tk)) {
            teacher = tk
            continue
          }
        }
        if (!location && isPlaceToken(tk)) {
          location = tk
          continue
        }
      }
      if (!teacher || !location) {
        const fb = extractTeacherAndPlace(joined)
        teacher = teacher ?? fb.teacher
        location = location ?? fb.location
      }
      const weeks = extractWeeks(joined) ?? { startWeek: 1, endWeek: 16 }

      // 单元格里的"(单周)""(双周)"标记
      let singleWeeks = weeks.singleWeeks
      if (!singleWeeks) {
        const isOdd = /[（(]\s*单\s*[)）]|单周/.test(joined)
        const isEven = /[（(]\s*双\s*[)）]|双周/.test(joined)
        if (isOdd || isEven) {
          singleWeeks = []
          for (let w = weeks.startWeek; w <= weeks.endWeek; w++) {
            if (isOdd && w % 2 === 1) singleWeeks.push(w)
            if (isEven && w % 2 === 0) singleWeeks.push(w)
          }
        }
      }

      const pm = joined.match(/(\d{1,2})\s*[-~－—到至]\s*(\d{1,2})\s*节/)
      const singleSec = joined.match(/(\d{1,2})\s*节/)

      // 节次:单元格内明写的范围优先;其次看合并单元格跨了几节/几列
      let finalPeriod = periodInfo.start
      let finalCount = periodInfo.count
      if (pm) {
        finalPeriod = Number(pm[1])
        finalCount = Number(pm[2]) - Number(pm[1]) + 1
      } else if (singleSec) {
        finalPeriod = Number(singleSec[1])
        finalCount = 1
      } else {
        // 合并单元格:横向表里跨了多行 = 连排多节
        const span = mergeSpan(merges, r, c, layout.transposed)
        if (span > 1) {
          if (layout.transposed) {
            // 纵向表:跨列 → 用列头算出起始节与节数
            const last = colPeriod[c + span - 1]
            if (last) {
              finalPeriod = periodInfo.start
              finalCount = last.start + last.count - periodInfo.start
            }
          } else {
            // 横向表:跨行 → 用行首标签算出起始节与节数
            const lastLabel = parsePeriodLabel(String(rows[r + span - 1]?.[0] ?? '').trim())
            if (lastLabel) {
              finalPeriod = periodInfo.start
              finalCount = lastLabel.start + lastLabel.count - periodInfo.start
            } else {
              finalCount = span
            }
          }
        }
      }

      out.push({
        name: extractName(name) || name,
        teacher,
        location,
        weekday,
        period: finalPeriod,
        periods: Math.max(1, finalCount),
        startWeek: weeks.startWeek,
        endWeek: weeks.endWeek,
        singleWeeks,
        source: cell.replace(/\n/g, ' '),
      })
    }
  }
  return out
}

/** 解析长表型课表 */
function parseLongTable(rows: any[][]): { courses: ImportedCourse[]; warnings: string[] } {
  const courses: ImportedCourse[] = []
  const warnings: string[] = []
  if (rows.length < 2) return { courses, warnings: ['表格只有表头,没有数据行'] }

  const header = rows[0].map((h) => String(h ?? '').trim())
  const fieldMap: (string | null)[] = header.map(matchField)

  const idx = {
    name: fieldMap.indexOf('name'),
    teacher: fieldMap.indexOf('teacher'),
    location: fieldMap.indexOf('location'),
    weekday: fieldMap.indexOf('weekday'),
    period: fieldMap.indexOf('period'),
    weeks: fieldMap.indexOf('weeks'),
    time: fieldMap.indexOf('time'),
  }

  if (idx.name < 0) {
    return {
      courses: [],
      warnings: [
        `没有找到「课程名称」列。当前表头:${header.filter(Boolean).join(' | ') || '(空)'}`,
      ],
    }
  }

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? []
    const get = (i: number) => (i >= 0 ? String(row[i] ?? '').trim() : '')
    const name = get(idx.name)
    if (!name) continue

    const blob = row.map((c) => String(c ?? '')).join(' ')

    let weekday = idx.weekday >= 0 ? parseWeekdayValue(get(idx.weekday)) : null
    let periodInfo = idx.period >= 0 ? parsePeriodValue(get(idx.period)) : null
    let weeks = idx.weeks >= 0 ? parseWeeksValue(get(idx.weeks)) : null

    // 从「上课时间」综合列里挖
    const timeCell = idx.time >= 0 ? get(idx.time) : ''
    const timeBlob = timeCell || blob
    if (!weekday) weekday = parseWeekdayValue(timeBlob)
    if (!periodInfo) {
      const pm = timeBlob.match(/(\d{1,2})\s*[-~－—到至]\s*(\d{1,2})\s*节/) ?? timeBlob.match(/(\d{1,2})\s*节/)
      if (pm) periodInfo = parsePeriodValue(pm[0])
    }
    if (!weeks) weeks = extractWeeks(timeBlob)

    if (!weekday) {
      warnings.push(`第 ${r + 1} 行「${name}」未识别星期,已跳过`)
      continue
    }
    if (!periodInfo) periodInfo = { period: 1, periods: 1 }
    if (!weeks) weeks = { startWeek: 1, endWeek: 16 }

    let teacher = idx.teacher >= 0 ? get(idx.teacher) : ''
    let location = idx.location >= 0 ? get(idx.location) : ''
    if (!teacher || !location) {
      const found = extractTeacherAndPlace(blob)
      if (!teacher) teacher = found.teacher ?? ''
      if (!location) location = found.location ?? ''
    }

    courses.push({
      name,
      teacher: teacher || undefined,
      location: location || undefined,
      weekday,
      period: periodInfo.period,
      periods: periodInfo.periods,
      startWeek: weeks.startWeek,
      endWeek: weeks.endWeek,
      singleWeeks: weeks.singleWeeks,
      source: `第 ${r + 1} 行`,
    })
  }
  return { courses, warnings }
}

/** 解析 Excel 文件 */
export async function parseExcel(file: File): Promise<ImportResult> {
  const warnings: string[] = []
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: false })
  const courses: ImportedCourse[] = []
  const unmatched: string[] = []

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, blankrows: false, defval: '' })
    if (!rows.length) continue

    const layout = detectMatrixLayout(rows)
    if (layout) {
      const merges = (sheet['!merges'] ?? []) as {
        s: { r: number; c: number }
        e: { r: number; c: number }
      }[]
      const m = parseMatrix(rows, layout, merges)
      courses.push(...m)
      if (m.length) {
        warnings.push(
          `工作表「${sheetName}」按${layout.transposed ? '星期×节次' : '节次×星期'}矩阵解析,得到 ${m.length} 门课`,
        )
      }
      continue
    }

    const res = parseLongTable(rows)
    courses.push(...res.courses)
    warnings.push(...res.warnings.map((w) => `工作表「${sheetName}」:${w}`))
    if (!res.courses.length && res.warnings.length === 0) {
      warnings.push(`工作表「${sheetName}」未解析出课程`)
    }
  }

  // 兜底:完全没解析出来时,尝试自由文本行解析
  if (!courses.length) {
    const allRows: string[] = []
    for (const sheetName of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName], { header: 1, blankrows: false, defval: '' })
      for (const r of rows) {
        const line = r.map((c) => String(c ?? '').trim()).filter(Boolean).join(' ')
        if (line) allRows.push(line)
      }
    }
    for (const line of allRows) {
      const c = parseFreeTextLine(line)
      if (c) courses.push(c)
      else unmatched.push(line)
    }
    if (courses.length) warnings.push(`已用自由文本模式解析,得到 ${courses.length} 门课`)
  }

  return { courses, warnings, unmatched: unmatched.slice(0, 20) }
}

/** 解析纯文本(来自 PDF / OCR) */
/**
 * 从二维表格解析课程(Excel 的工作表、PDF 还原出来的网格,都走这里)。
 *
 * 先试「星期 × 节次」矩阵,不行再试长表,最后兜底自由文本。
 */
export function parseTable(
  rows: (string | number | null)[][],
  label = '表格',
): ImportResult {
  const warnings: string[] = []
  const courses: ImportedCourse[] = []
  const unmatched: string[] = []
  if (!rows?.length) {
    return { courses, warnings: [`${label}是空的`], unmatched }
  }

  const norm = rows.map((r) => (r ?? []).map((c) => String(c ?? '').trim()))
  const layout = detectMatrixLayout(norm)
  if (layout) {
    const m = parseMatrix(norm, layout)
    if (m.length) {
      warnings.push(
        `${label}按${layout.transposed ? '星期×节次' : '节次×星期'}矩阵解析,得到 ${m.length} 门课`,
      )
      return { courses: m, warnings, unmatched }
    }
  }

  const res = parseLongTable(norm)
  courses.push(...res.courses)
  warnings.push(...res.warnings.map((w) => `${label}:${w}`))
  if (!res.courses.length && res.warnings.length === 0) {
    warnings.push(`${label}未解析出课程`)
  }
  return { courses, warnings, unmatched }
}

export function parsePlainText(text: string): ImportResult {
  const warnings: string[] = []
  const courses: ImportedCourse[] = []
  const unmatched: string[] = []
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  for (const line of lines) {
    const c = parseFreeTextLine(line)
    if (c) courses.push(c)
    else if (line.length > 3) unmatched.push(line)
  }

  if (!courses.length && lines.length) {
    warnings.push('没有解析出课程。可尝试在「手工录入」里用一句话录入,或检查图片是否清晰。')
  }
  return { courses, warnings, unmatched: unmatched.slice(0, 20) }
}

/**
 * 把「同一门课、同一时段、周次相邻」的几条合成一条。
 *
 * 教务 PDF 经常把一门课按周次拆成好几段写,还换老师:
 *   高等数学 / 张三 / 教三302 / 第7-8周
 *   高等数学 / 张三 / 教三302 / 第9周
 *   高等数学 / 李四 / 教三302 / 第10-12周
 * 对用户来说这是「同一门课,7 到 12 周都上」,不该在列表里出现三次。
 *
 * 合并规则(保守,避免把不同的课吞掉):
 *   · 课程名 / 星期 / 起始节 / 节数 / 教室 都相同
 *   · 周次重叠或相邻(中间不断周)
 *   · 带单双周的课不参与(周次不是连续区间)
 * 合并后保留最早的教师,换老师的情况写进备注。
 */
export function mergeAdjacentWeekSegments(list: ImportedCourse[]): ImportedCourse[] {
  const groups = new Map<string, ImportedCourse[]>()
  const order: string[] = []
  for (const c of list) {
    const key = [
      c.name.replace(/\s+/g, ''),
      c.weekday,
      c.period,
      c.periods,
      (c.location ?? '').replace(/\s+/g, ''),
      // 单双周不是连续区间,不参与合并(周次集合也进 key,避免误并)
      c.singleWeeks?.length ? 's:' + c.singleWeeks.join(',') : 'range',
    ].join('|')
    const arr = groups.get(key)
    if (arr) arr.push(c)
    else {
      groups.set(key, [c])
      order.push(key)
    }
  }

  const out: ImportedCourse[] = []
  for (const key of order) {
    const arr = groups.get(key)!
    if (arr.length === 1) {
      out.push(arr[0])
      continue
    }
    const sorted = [...arr].sort((a, b) => a.startWeek - b.startWeek || a.endWeek - b.endWeek)
    let cur: ImportedCourse = { ...sorted[0] }
    const notes: string[] = cur.remark ? [cur.remark] : []
    const flush = () => {
      if (notes.length) cur.remark = notes.join(';')
      out.push(cur)
    }
    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i]
      const adjacent = next.startWeek <= cur.endWeek + 1
      if (!adjacent) {
        flush()
        cur = { ...next }
        notes.length = 0
        if (next.remark) notes.push(next.remark)
        continue
      }
      if (next.teacher && next.teacher !== cur.teacher) {
        const w = next.startWeek === next.endWeek ? `第${next.startWeek}周` : `第${next.startWeek}-${next.endWeek}周`
        notes.push(`${w}由${next.teacher}授课`)
      }
      cur.endWeek = Math.max(cur.endWeek, next.endWeek)
      if (!cur.teacher) cur.teacher = next.teacher
      if (!cur.location) cur.location = next.location
    }
    flush()
  }
  return out
}

/** 去重合并 */export function dedupeCourses(list: ImportedCourse[]): ImportedCourse[] {
  const seen = new Map<string, ImportedCourse>()
  for (const c of list) {
    /*
     * 周次也要算进键里:同名课在不同周次上是两段安排
     * (比如「高等数学」第 7-8 周是张三、第 10-12 周是李四),
     * 只按「课程名+星期+节次」去重会把后面的直接吞掉。
     */
    const key = `${c.name}|${c.weekday}|${c.period}|${c.periods}|${c.startWeek}-${c.endWeek}`
    if (!seen.has(key)) seen.set(key, c)
  }
  return [...seen.values()]
}

/** 转成可入库的 Course */
/**
 * 课程「内容签名」。
 *
 * 用来判断两门课是不是同一条安排 —— 导入时靠它跳过重复,
 * 启动时靠它清理已经重复的数据。
 *
 * 故意做成**与 id 无关**:同一份课表导入两次,id 是随机/新建的,
 * 但内容签名一定相同;反过来,改过教室或周次的课签名会变,
 * 不会被误判成重复(宁可留两条,也不要吞掉信息)。
 */
export function courseSignature(c: {
  name: string
  weekday: number
  period: number
  periods: number
  startWeek: number
  endWeek: number
  singleWeeks?: number[]
  teacher?: string
  location?: string
}): string {
  const norm = (s?: string) => (s ?? '').replace(/\s+/g, '').trim()
  const weeks = (c.singleWeeks ?? []).slice().sort((a, b) => a - b).join(',')
  return [
    norm(c.name),
    c.weekday,
    c.period,
    c.periods,
    c.startWeek,
    c.endWeek,
    weeks,
    norm(c.teacher),
    norm(c.location),
  ].join('|')
}

/** 由签名生成确定性 id:同一门课永远得到同一个 id,重复导入不会变成两条 */
function signatureId(sig: string): string {
  let h1 = 0x811c9dc5
  let h2 = 5381
  for (let i = 0; i < sig.length; i++) {
    const ch = sig.charCodeAt(i)
    h1 ^= ch
    h1 = Math.imul(h1, 0x01000193)
    h2 = (Math.imul(h2, 33) + ch) | 0
  }
  return `course_${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`
}

export function courseIdFor(c: Parameters<typeof courseSignature>[0]): string {
  return signatureId(courseSignature(c))
}

/** 转成可入库的 Course */
export function toCourses(list: ImportedCourse[]): Course[] {
  const now = Date.now()
  return list.map((c) => ({
    // 确定性 id:同一份课表重复导入 → 命中同一条,而不是再插一条
    id: courseIdFor(c),
    name: c.name,
    teacher: c.teacher,
    location: c.location,
    weekday: c.weekday,
    period: c.period,
    periods: c.periods,
    startWeek: c.startWeek,
    endWeek: c.endWeek,
    singleWeeks: c.singleWeeks,
    remark: c.remark,
    createdAt: now,
    updatedAt: now,
  }))
}
