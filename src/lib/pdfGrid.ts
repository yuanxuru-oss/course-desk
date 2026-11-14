/**
 * 带表格线的 PDF 课表:按**真实格子**还原课程
 *
 * 为什么需要它(以及为什么之前的启发式不够):
 *   教务系统导出的 PDF 多数是「画了线的表格」。这种表的文字是**按格子窄宽逐字折行**的,
 *   一门课会被拆成好几行、甚至在任意一个字中间断开:
 *       「《线性代数》,王」/「胜,外语楼201,第14-16」/「周」
 *   靠「按 y 聚行 + 猜列」永远拼不回来 —— 但表格线本身已经把答案画出来了。
 *
 * 做法:
 *   1. 从 PDF 的路径操作里取出所有横线 / 竖线(表格边框)
 *   2. 竖线聚类 → 列边界;用表头「星期一…星期日」认出哪几列是星期
 *   3. 每一列单独取横线(合并单元格的中间那条线本来就没画)→ 得到这一列真实的格子
 *   4. 格子里所有文字按「从上到下、从左到右」拼起来,再按《课程名》切段
 *   5. 节次:用「第N节」那一列的行边界去对照,算出这节课占用第几到第几节
 *
 * 格子里的多个条目:
 *   · 一个格子里有《A》…《B》… → 按顺序把这个格子占的节次均分给它们
 *   · 一个格子里只有《A》,但有好几组「教师,教室,周次」→ 同名课程,周次不同,各自占满整格
 */

export interface GridCourse {
  name: string
  teacher?: string
  location?: string
  weekday: number
  /** 起始节次(1 开始) */
  period: number
  /** 连续节数 */
  periods: number
  startWeek: number
  endWeek: number
  singleWeeks?: number[]
  /** 原始单元格文字,便于用户核对 */
  source: string
}

interface Pt {
  s: string
  x: number
  y: number
  w: number
  h: number
}

interface Seg {
  x0: number
  y0: number
  x1: number
  y1: number
}

const cluster = (vals: number[], tol = 2): number[] => {
  const out: number[] = []
  for (const v of [...vals].sort((a, b) => a - b)) {
    if (!out.length || Math.abs(out[out.length - 1] - v) > tol) out.push(v)
  }
  return out
}

/** 从 operator list 里抠出所有直线段(处理 cm 变换) */
export function segmentsFromOps(ops: { fnArray: number[]; argsArray: any[] }, OPS: any): Seg[] {
  const segs: Seg[] = []
  let ctm = [1, 0, 0, 1, 0, 0]
  const mul = (m: number[], n: number[]) => [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
  const apply = (x: number, y: number) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    const args = ops.argsArray[i]
    if (fn === OPS.transform && Array.isArray(args)) {
      ctm = mul(ctm, args)
      continue
    }
    if (fn !== OPS.constructPath || !args) continue
    const [subOps, coords] = args as [number[], number[]]
    let k = 0
    let cur: number[] = [0, 0]
    for (const op of subOps) {
      if (op === OPS.moveTo) {
        cur = apply(coords[k++], coords[k++])
        continue
      }
      if (op === OPS.lineTo) {
        const next = apply(coords[k++], coords[k++])
        segs.push({ x0: cur[0], y0: cur[1], x1: next[0], y1: next[1] })
        cur = next
        continue
      }
      if (op === OPS.rectangle) {
        const x = coords[k++]
        const y = coords[k++]
        const w = coords[k++]
        const h = coords[k++]
        const a = apply(x, y)
        const b = apply(x + w, y)
        const c = apply(x + w, y + h)
        const d = apply(x, y + h)
        segs.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1] })
        segs.push({ x0: b[0], y0: b[1], x1: c[0], y1: c[1] })
        segs.push({ x0: c[0], y0: c[1], x1: d[0], y1: d[1] })
        segs.push({ x0: d[0], y0: d[1], x1: a[0], y1: a[1] })
        continue
      }
    }
  }
  return segs
}

const WEEKDAY_CN_RE = /^(星期|周|礼拜)([一二三四五六日天])$/

function weekdayFromLabel(s: string): number | null {
  const m = s.trim().match(WEEKDAY_CN_RE)
  if (!m) return null
  const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }
  return map[m[2]] ?? null
}

/** 「第7-8周」「第9周」「1-16周」「(单周)」 */
function parseWeeks(t: string): { startWeek: number; endWeek: number; singleWeeks?: number[] } | null {
  const s = t.replace(/\s/g, '')
  const range = s.match(/第?(\d{1,2})\s*[-~－—到至]\s*(\d{1,2})\s*周/)
  if (range) {
    const a = Number(range[1])
    const b = Number(range[2])
    if (a >= 1 && b >= a && b <= 30) return { startWeek: a, endWeek: b }
  }
  const one = s.match(/第?(\d{1,2})\s*周/)
  if (one) {
    const a = Number(one[1])
    if (a >= 1 && a <= 30) return { startWeek: a, endWeek: a }
  }
  return null
}

const looksLikeWeeks = (t: string) => /第?\d{1,2}\s*([-~－—到至]\s*\d{1,2})?\s*周/.test(t.replace(/\s/g, ''))

/** 教师名:2-4 个汉字,且不像地名/课程名 */
function looksLikeTeacher(t: string): boolean {
  return /^[\u4e00-\u9fa5·]{2,4}$/.test(t) && !/^(周[一二三四五六日天]?|星期|上午|下午|晚上|第.+节)$/.test(t)
}

/** 教室:外语楼201 / 教三302 / 外语楼201 / 操场 */
function looksLikePlace(t: string): boolean {
  return (
    /[\u4e00-\u9fa5]{1,6}\s*[A-Za-z]?\d{2,4}/.test(t) ||
    /(楼|馆|室|厅|中心|校区|操场|教室)/.test(t)
  )
}

interface Cell {
  y0: number
  y1: number
  text: string
  items: Pt[]
}

/** 一格里可能有多门课:按《》切段 */
function splitCourses(text: string): { name: string; rest: string }[] {
  const norm = text.replace(/\s+/g, ' ').trim()
  const parts = norm.split('《')
  const out: { name: string; rest: string }[] = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim()
    if (!part) continue
    if (i === 0) {
      // 《》之前的残留文字:通常是上一格内容的尾巴,没有课程名就跳过
      continue
    }
    const close = part.indexOf('》')
    const name = (close >= 0 ? part.slice(0, close) : part).trim()
    const rest = (close >= 0 ? part.slice(close + 1) : '').trim()
    if (name) out.push({ name, rest })
  }
  return out
}

/** 把「,教师,教室,第X-Y周」这种尾巴切成若干三元组 */
function parseTriplets(rest: string): { teacher?: string; location?: string; weeks: ReturnType<typeof parseWeeks> }[] {
  const tokens = rest
    .split(/[,，;；、]/)
    .map((t) => t.trim())
    .filter(Boolean)
  const groups: { teacher?: string; location?: string; weeks: ReturnType<typeof parseWeeks> }[] = []
  let cur: { teacher?: string; location?: string; weeks: ReturnType<typeof parseWeeks> } | null = null
  for (const tk of tokens) {
    const weeks = looksLikeWeeks(tk) ? parseWeeks(tk) : null
    const isPlace = !weeks && looksLikePlace(tk)
    const isTeacher = !weeks && !isPlace && looksLikeTeacher(tk)
    if (!cur) cur = { teacher: undefined, location: undefined, weeks: null }
    if (isTeacher && !cur.teacher) {
      cur.teacher = tk
      continue
    }
    if (isPlace && !cur.location) {
      cur.location = tk
      continue
    }
    if (weeks) {
      cur.weeks = weeks
      groups.push(cur)
      cur = null
      continue
    }
    // 认不出来的碎片:当成地点兜底
    if (!cur.location) cur.location = tk
  }
  if (cur && (cur.teacher || cur.location)) groups.push(cur)
  return groups
}

/**
 * 从一页 PDF 还原课程。
 * 返回 null 表示「这页不是带表格线的课表」,调用方应退回旧办法。
 */
export function coursesFromPageGrid(segs: Seg[], items: any[]): GridCourse[] | null {
  if (segs.length < 20) return null

  const horiz = segs
    .filter((s) => Math.abs(s.y0 - s.y1) < 0.8)
    .map((s) => ({ y: s.y0, x0: Math.min(s.x0, s.x1), x1: Math.max(s.x0, s.x1) }))
  const vert = segs
    .filter((s) => Math.abs(s.x0 - s.x1) < 0.8)
    .map((s) => ({ x: s.x0, y0: Math.min(s.y0, s.y1), y1: Math.max(s.y0, s.y1) }))

  const pts: Pt[] = items
    .filter((it) => it && typeof it.str === 'string' && it.str.trim())
    .map((it) => ({
      s: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: Number(it.width) || 0,
      h: Number(it.height) || 10,
    }))
  if (!pts.length || !horiz.length || !vert.length) return null

  // 表头:同时出现多个「星期X」
  const wdLabels = pts
    .map((p) => ({ p, wd: weekdayFromLabel(p.s) }))
    .filter((x) => x.wd !== null) as { p: Pt; wd: number }[]
  if (wdLabels.length < 2) return null
  const headerY = Math.max(...wdLabels.map((x) => x.p.y))

  const bodyH = horiz.filter((h) => h.y < headerY - 2)
  const bodyV = vert.filter((v) => v.y0 < headerY - 2)
  if (bodyH.length < 6 || bodyV.length < 4) return null

  const bodyTop = headerY - 2
  const bodyBottom = Math.min(...bodyH.map((h) => h.y))
  const colXs = cluster(bodyV.map((v) => v.x)).filter((x) => x > 20)
  if (colXs.length < 4) return null

  interface Col {
    x0: number
    x1: number
    ys: number[]
    text: string
  }
  const cols: Col[] = []
  for (let i = 0; i < colXs.length - 1; i++) {
    const x0 = colXs[i]
    const x1 = colXs[i + 1]
    if (x1 - x0 < 6) continue
    const width = x1 - x0
    const ys = [bodyBottom, bodyTop]
    for (const h of bodyH) {
      const ov = Math.min(h.x1, x1) - Math.max(h.x0, x0)
      if (ov >= width * 0.6) ys.push(h.y)
    }
    const text = pts
      .filter((p) => p.x + p.w / 2 >= x0 && p.x + p.w / 2 <= x1)
      .map((p) => p.s)
      .join('')
    cols.push({ x0, x1, ys: cluster(ys), text })
  }

  // 哪几列是星期几
  const weekdayCols = new Map<number, { col: Col; wd: number }>()
  for (const { p, wd } of wdLabels) {
    const cx = p.x + p.w / 2
    const col = cols.find((c) => cx >= c.x0 && cx <= c.x1)
    if (col) weekdayCols.set(col.x0, { col, wd })
  }
  if (weekdayCols.size < 2) return null

  // 节次列:文字是「第N节」
  const periodCol = cols.find((c) => /第[一二三四五六七八九十\d]{1,3}节/.test(c.text))
  if (!periodCol) return null

  const CN: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
  const periodOf = (s: string): number | null => {
    const m = s.trim().match(/^第([一二三四五六七八九十\d]{1,3})节$/)
    if (!m) return null
    const raw = m[1]
    if (/^\d+$/.test(raw)) return Number(raw)
    // 十一 / 十二 / 十三
    if (raw.length === 2 && raw[0] === '十') return 10 + (CN[raw[1]] ?? 0)
    if (raw.length === 1) return CN[raw] ?? null
    if (raw.length === 3 && raw[1] === '十') return (CN[raw[0]] ?? 0) * 10 + (CN[raw[2]] ?? 0)
    return null
  }

  // 节次行(用节次列自己的格子)
  const periodRows: { period: number; y0: number; y1: number }[] = []
  for (let i = 0; i < periodCol.ys.length - 1; i++) {
    const y0 = periodCol.ys[i]
    const y1 = periodCol.ys[i + 1]
    const label = pts.find((p) => {
      const cx = p.x + p.w / 2
      const cy = p.y + p.h / 2
      return cx >= periodCol.x0 && cx <= periodCol.x1 && cy > y0 - 1 && cy < y1 + 1
    })
    const n = label ? periodOf(label.s) : null
    if (n) periodRows.push({ period: n, y0, y1 })
  }
  if (periodRows.length < 3) return null

  const courses: GridCourse[] = []

  for (const { col, wd } of weekdayCols.values()) {
    // 这一列自己的格子
    const cells: Cell[] = []
    for (let i = 0; i < col.ys.length - 1; i++) {
      const y0 = col.ys[i]
      const y1 = col.ys[i + 1]
      const inCell = pts
        .filter((p) => {
          const cx = p.x + p.w / 2
          const cy = p.y + p.h / 2
          return cx >= col.x0 && cx <= col.x1 && cy > y0 - 1 && cy < y1 + 1 && p.y < bodyTop
        })
        .sort((a, b) => b.y - a.y || a.x - b.x)
      if (!inCell.length) continue
      cells.push({ y0, y1, text: inCell.map((t) => t.s).join(''), items: inCell })
    }

    for (const cell of cells) {
      const span = periodRows.filter((r) => r.y1 > cell.y0 + 1 && r.y0 < cell.y1 - 1)
      if (!span.length) continue
      // 行是从下往上扫的,节次号要从上往下取
      const nums = span.map((r) => r.period).sort((a, b) => a - b)
      const startPeriod = nums[0]
      const periodCount = nums[nums.length - 1] - startPeriod + 1

      const chunks = splitCourses(cell.text)
      if (!chunks.length) continue

      const withGroups = chunks.map((c) => ({ ...c, groups: parseTriplets(c.rest) }))

      /*
       * 一个格子里有多门课(《A》…《B》…)→ 把这个格子的节次按顺序分开;
       * 只有一门课但有好几组「教师,教室,周次」→ 同名课、不同周次,每组都占满整格。
       */
      const k = withGroups.length
      const base = Math.floor(periodCount / k)
      const rem = periodCount % k
      let cursor = 0
      withGroups.forEach((chunk, gi) => {
        const share = Math.max(1, base + (gi < rem ? 1 : 0))
        const groups = chunk.groups.length
          ? chunk.groups
          : [{ teacher: undefined, location: undefined, weeks: null as ReturnType<typeof parseWeeks> }]
        for (const g of groups) {
          const weeks = g.weeks ?? { startWeek: 1, endWeek: 16 }
          const offset = groups.length > 1 ? 0 : cursor
          courses.push({
            name: chunk.name,
            teacher: g.teacher,
            location: g.location,
            weekday: wd,
            period: startPeriod + offset,
            periods: Math.min(share, periodCount - offset),
            startWeek: weeks.startWeek,
            endWeek: weeks.endWeek,
            singleWeeks: weeks.singleWeeks,
            source: cell.text,
          })
        }
        if (groups.length === 1) cursor += share
      })
    }
  }

  return courses.length ? courses : null
}
