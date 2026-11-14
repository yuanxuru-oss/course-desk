import { segmentsFromOps, coursesFromPageGrid } from './pdfGrid.ts'
import type { ImportedCourse } from './import.ts'
/**
 * PDF 课表还原
 *
 * 教务系统导出的 PDF 课表有两种形态:
 *   1. 网格表 —— 左列是节次(或时间),表头是星期,格子里是「课程名 / 教师 / 教室」
 *   2. 纯文本列表 —— 一行一门课
 *
 * 第 2 种直接按行解析就行;第 1 种必须把 PDF 的文字项还原成二维表,
 * 才能走和 Excel 完全一样的矩阵解析。
 *
 * 还原里最容易错、也最要命的一点:
 *   一个格子里换行写的「高等数学 / 张三 / 教三302」在 PDF 里是**三个独立文字项**,
 *   基线(y)各不相同。只按 y 聚行就会把它拆成三行,于是「张三」被当成一门课、
 *   或者整格内容全丢。
 *   所以这里不是「聚行 → 输出」,而是「聚行 → 切格 → 用节次标签划出行带 → 把行带里
 *   同一列的碎片按顺序拼回一格」。
 *
 * 第二个坑是**居中对齐**:教务 PDF 的格子文字常常是居中的,同一个列里每行的起始 x
 *   都不一样。所以列不是按「起始 x 聚类」得来的,而是优先用表头(星期/节次)每个标签的
 *   横向区间定列,格子按区间重叠度归列 —— 居中也认得出来。
 */

export const PDF_WORKER_URL = 'pdf.worker.min.mjs'

/** 一个文字项,归一化之后的样子 */
interface PdfPt {
  x: number
  y: number
  right: number
  size: number
  s: string
}

interface PdfCell {
  x: number
  right: number
  text: string
}

interface PdfRow {
  y: number
  pts: PdfPt[]
}

interface PdfCol {
  left: number
  right: number
}

const WEEKDAY_RE = /^(?:星期|礼拜|周)[一二三四五六日天1-7]|^[一二三四五六日天]$/
const PERIOD_RE = /^第?\s*\d{1,2}\s*节?$|^第\s*[零〇一二两三四五六七八九十]{1,3}\s*节$/
const TIME_RE = /^\d{1,2}[:：]\d{2}/

/** 节次标签(第一节 / 第1节 / 3 / 一二三节…) */
export function looksLikePeriodLabel(s: string): boolean {
  const t = s.replace(/\s/g, '')
  if (!t || t.length > 6) return false
  return PERIOD_RE.test(t)
}

/** 星期标签(星期一 / 周一 / 一) */
export function looksLikeWeekdayLabel(s: string): boolean {
  const t = s.replace(/\s/g, '')
  if (!t || t.length > 5) return false
  return WEEKDAY_RE.test(t)
}

/** 时间标签(08:00 / 08:00-08:45) */
export function looksLikeTimeLabel(s: string): boolean {
  return TIME_RE.test(s.trim())
}

function median(nums: number[]): number {
  if (!nums.length) return 0
  const a = [...nums].sort((p, q) => p - q)
  return a[Math.floor(a.length / 2)]
}

/**
 * 把 pdf.js 的 textContent.items 归一化。
 *
 * 字号取 transform 的缩放(变换矩阵前两个分量),取不到再退回 height。
 * 宽度取 item.width,取不到按字数估一个 —— 宽度决定「两段文字是不是同一格」。
 */
function collectPoints(items: any[]): PdfPt[] {
  const out: PdfPt[] = []
  for (const it of items) {
    if (!it || typeof it.str !== 'string') continue
    const s = it.str
    if (!s.trim()) continue
    const tr = it.transform ?? []
    const scale = Math.hypot(Number(tr[0] ?? 0), Number(tr[1] ?? 0))
    const h = Math.abs(Number(it.height ?? 0))
    // 字号优先取 height(pdf.js 直接给),取不到再用变换矩阵的缩放
    const size = h > 0.5 && h < 300 ? h : scale > 0.1 ? scale : 10
    const x = Number(tr[4] ?? 0)
    const y = Number(tr[5] ?? 0)
    const w = Number(it.width ?? 0) || Math.max(size, s.length * size * 0.55)
    out.push({ x, y, right: x + w, size, s })
  }
  return out
}

/** 按基线聚行:容忍度按字号给,并且**不丢任何一个点**(落不进已有行就开新行) */
function clusterRows(pts: PdfPt[], tol: number): PdfRow[] {
  const rows: PdfRow[] = []
  for (const p of [...pts].sort((m, n) => n.y - m.y)) {
    let hit: PdfRow | undefined
    for (const r of rows) {
      if (Math.abs(r.y - p.y) <= tol) {
        hit = r
        break
      }
    }
    if (!hit) {
      hit = { y: p.y, pts: [] }
      rows.push(hit)
    }
    hit.pts.push(p)
  }
  return rows
}

function joinText(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  // 中文之间不加空格;英文/数字之间要加,否则 "HighMath" 会黏在一起
  const needSpace = /[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b)
  return a + (needSpace ? ' ' : '') + b
}

/** 行内按横向间隙切格 */
function splitCells(pts: PdfPt[], gap: number): PdfCell[] {
  const cells: PdfCell[] = []
  for (const p of [...pts].sort((m, n) => m.x - n.x)) {
    const last = cells[cells.length - 1]
    if (last && p.x - last.right <= gap) {
      last.text = joinText(last.text, p.s)
      last.right = Math.max(last.right, p.right)
    } else {
      cells.push({ x: p.x, right: p.right, text: p.s })
    }
  }
  return cells
}

/** 用表头的每个标签定列(标签本身就大致居中在自己那一列上) */
function columnsFromHeader(cells: PdfCell[]): PdfCol[] {
  return [...cells]
    .sort((a, b) => a.x - b.x)
    .map((c) => ({ left: c.x, right: c.right }))
}

/** 没有表头时的兜底:把横向区间重叠的格子并成一列 */
function clusterColumns(cells: PdfCell[], gap: number): PdfCol[] {
  const cols: PdfCol[] = []
  for (const c of [...cells].sort((a, b) => a.x - b.x)) {
    let best: PdfCol | undefined
    let bestOverlap = 0
    for (const col of cols) {
      const ov = Math.min(col.right, c.right) - Math.max(col.left, c.x)
      if (ov > bestOverlap) {
        bestOverlap = ov
        best = col
      }
    }
    const width = Math.max(1, c.right - c.x)
    if (best && bestOverlap > Math.max(2, width * 0.3)) {
      best.left = Math.min(best.left, c.x)
      best.right = Math.max(best.right, c.right)
    } else if (best && c.x - best.right <= gap && c.x >= best.left) {
      // 落在同一列的右边一点点(居中文字宽度估小了),并进去
      best.right = Math.max(best.right, c.right)
    } else {
      cols.push({ left: c.x, right: c.right })
    }
  }
  return cols.sort((a, b) => a.left - b.left)
}

/** 这个格子落在第几列、横跨几列 */
function locate(cell: PdfCell, cols: PdfCol[]): { index: number; span: number } {
  let first = -1
  let last = -1
  for (let i = 0; i < cols.length; i++) {
    const ov = Math.min(cols[i].right, cell.right) - Math.max(cols[i].left, cell.x)
    if (ov > 0) {
      if (first < 0) first = i
      last = i
    }
  }
  if (first >= 0) return { index: first, span: last - first + 1 }
  // 完全不重叠:按中心找最近的列
  const mid = (cell.x + cell.right) / 2
  let bi = 0
  let bd = Infinity
  for (let i = 0; i < cols.length; i++) {
    const d = Math.abs((cols[i].left + cols[i].right) / 2 - mid)
    if (d < bd) {
      bd = d
      bi = i
    }
  }
  return { index: bi, span: 1 }
}

/**
 * 把 PDF 一页的文字项还原成二维表。
 *
 * 返回 null 表示「这不像一张网格表」,调用方应该退回按行解析文本。
 */
export function rowsFromPdfItems(items: any[]): string[][] | null {
  const pts = collectPoints(items)
  if (pts.length < 6) return null

  const size = median(pts.map((p) => p.size)) || 10
  const rowTol = Math.max(1.5, size * 0.55)
  const gapTol = Math.max(4, size * 0.7)

  const rowObjs = clusterRows(pts, rowTol)
  if (rowObjs.length < 2) return null
  const rowCells = rowObjs.map((r) => ({ y: r.y, cells: splitCells(r.pts, gapTol) }))

  // 1) 找表头:前 6 行里,第一行有 ≥2 个「星期」或「节次」标签的就是表头
  let headerIdx = -1
  for (let i = 0; i < Math.min(6, rowCells.length); i++) {
    const cells = rowCells[i].cells
    const wd = cells.filter((c) => looksLikeWeekdayLabel(c.text)).length
    const pd = cells.filter((c) => looksLikePeriodLabel(c.text)).length
    if (wd >= 2 || pd >= 2) {
      headerIdx = i
      break
    }
  }

  // 2) 定列
  const allCells = rowCells.flatMap((r) => r.cells)
  const cols =
    headerIdx >= 0
      ? columnsFromHeader(rowCells[headerIdx].cells)
      : clusterColumns(allCells, gapTol * 2)
  if (cols.length < 2 || cols.length > 20) return null

  // 3) 每个格子归列
  const mapped = rowCells.map((r) => {
    const byCol = new Map<number, string>()
    const spans: number[] = []
    for (const c of r.cells) {
      const { index, span } = locate(c, cols)
      byCol.set(index, byCol.has(index) ? `${byCol.get(index)!}\n${c.text}` : c.text)
      if (span > 1) spans.push(span)
    }
    return { y: r.y, byCol, spans }
  })

  /*
   * 4) 划行带
   *
   * 关键点:格子里几行字是**竖直居中**的,所以「课程名」那一行的基线
   * 往往比同一行的「节次」标签更高。如果按「标签行开新带、其余行往下并」
   * 就会把第一行课程名当成 PDF 顶部标题丢掉(实测:课程名全没了,
   * 只剩下教师和教室,课程名变成了「张三」)。
   *
   * 正确做法:以「左列有标签」的行为锚点,其余行按 **y 最近**归入锚点;
   * 距离超过半个行距的(页面标题、页眉)直接丢掉。表头行单独成带。
   */
  const anchors = mapped
    .map((row, i) => ({ row, i }))
    .filter(({ row, i }) => {
      if (i === headerIdx) return true
      const label = (row.byCol.get(0) ?? '').trim()
      return !!label && label.length <= 14
    })

  const bands: { label: string; cols: Map<number, string>; y: number }[] = []

  if (!anchors.length) {
    // 没有行标签:一行一带,保持原样
    for (const row of mapped) {
      const cols2 = new Map<number, string>()
      for (const [k, v] of row.byCol) cols2.set(k, v)
      bands.push({ label: (row.byCol.get(0) ?? '').trim(), cols: cols2, y: row.y })
    }
  } else {
    const ys = anchors.map((a) => a.row.y)
    const ranges = ys.map((y, k) => {
      const gapAbove = k > 0 ? ys[k - 1] - y : undefined
      const gapBelow = k < ys.length - 1 ? y - ys[k + 1] : undefined
      const gap = Math.max(1, gapAbove ?? gapBelow ?? size * 3.2)
      // 半个行距 + 半个字号的容差:格子里的行都落在自己那一带里
      const half = gap / 2 + size * 0.5
      return { up: gapAbove !== undefined ? half : half, down: gapBelow !== undefined ? half : half, half }
    })

    const collected = anchors.map(() => new Map<number, string>())
    const unassigned: { y: number; cols: Map<number, string> }[] = []
    for (let r = 0; r < mapped.length; r++) {
      const row = mapped[r]
      // 找最近的锚点
      let best = -1
      let bestD = Infinity
      for (let k = 0; k < anchors.length; k++) {
        const d = Math.abs(ys[k] - row.y)
        if (d < bestD) {
          bestD = d
          best = k
        }
      }
      if (best < 0) continue
      if (bestD > ranges[best].half) {
        // 落在所有行带之外:可能是页面标题/页眉
        unassigned.push({ y: row.y, cols: row.byCol })
        continue
      }
      // 锚点自己的标签列不重复拼接
      for (const [k2, v] of row.byCol) {
        if (k2 === 0 && r === anchors[best].i) continue
        cols2Merge(collected[best], k2, v)
      }
    }

    /*
     * 表头上方那行「2025-2026学年第1学期课程表」要保留(在表格第 0 行),
     * 它离表头不到一个行距;再往上(页眉、页码)就丢掉。
     */
    const gapTop = ys.length > 1 ? ys[0] - ys[1] : size * 3.2
    const titles = unassigned
      .filter((u) => u.y > ys[0] && u.y - ys[0] <= Math.max(gapTop * 1.6, size * 4))
      .sort((a, b) => b.y - a.y)
    for (const t of titles) {
      // 标题一般横跨在最左列,把它当这一行的「标签」保留下来
      bands.push({ label: (t.cols.get(0) ?? '').trim(), cols: t.cols, y: t.y })
    }

    anchors.forEach((a, k) => {
      const label = (a.row.byCol.get(0) ?? '').trim()
      // 表头行(左列可能是空的)也要保留
      if (!label && a.i !== headerIdx) return
      const cols2 = collected[k]
      for (const [k2, v] of a.row.byCol) if (!cols2.has(k2)) cols2.set(k2, v)
      bands.push({ label, cols: cols2, y: a.row.y })
    })
  }

  // 5) 填成二维表
  const table: string[][] = []
  for (const b of bands) {
    const row: string[] = new Array(cols.length).fill('')
    row[0] = b.label
    for (const [k, v] of b.cols) {
      if (k === 0) continue
      if (k >= cols.length) continue
      row[k] = v
    }
    table.push(row)
  }

  const filledRows = table.filter((r) => r.some((c) => c.trim())).length
  const filledCols = cols.filter((_, i) => table.some((r) => (r[i] ?? '').trim())).length
  if (filledRows < 3 || filledCols < 2) return null
  return table
}

function cols2Merge(map: Map<number, string>, k: number, v: string) {
  const cur = map.get(k)
  map.set(k, cur ? `${cur}\n${v}` : v)
}

/** 纯文本兜底:按行聚,行内按 x 顺序拼接 */
export function textLinesFromPdfItems(items: any[]): string[] {
  const pts = collectPoints(items)
  if (!pts.length) return []
  const size = median(pts.map((p) => p.size)) || 10
  const rows = clusterRows(pts, Math.max(1.5, size * 0.55))
  return rows.map((r) => splitCells(r.pts, Math.max(4, size * 0.7)).map((c) => c.text).join(' '))
}

/** 一页 PDF 能提取出来的东西 */
export interface PdfExtract {
  /** 纯文本(给「没有表格线」的 PDF 兜底) */
  text: string
  /** 按坐标还原出的二维表(走和 Excel 一样的矩阵解析) */
  tables: string[][][]
  /**
   * 按**真实表格线**还原出的课程。
   * 带线的表格(pdfGrid 认得的那种)优先用这个 —— 格子窄、文字逐字折行的课表,
   * 只有按格子拼才能还原出完整的课程名。
   */
  gridCourses: ImportedCourse[]
}

/** 从 PDF 里提取文本 + 表格 + 按格子还原的课程 */
export async function extractPdf(file: File | Blob): Promise<PdfExtract> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(PDF_WORKER_URL, document.baseURI).href

  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  const pages: string[] = []
  const tables: string[][][] = []
  const gridCourses: ImportedCourse[] = []
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      const items = content.items as any[]
      pages.push(textLinesFromPdfItems(items).join('\n'))

      // 1) 先按表格线还原。成功了就别再走下面的坐标启发式 ——
      //    两条都跑会把同一门课解析两遍,还混进「美术 ,第」这种碎片。
      let gridOk = false
      try {
        const ops = await page.getOperatorList()
        const segs = segmentsFromOps(ops, pdfjs.OPS)
        const grid = coursesFromPageGrid(segs, items)
        if (grid?.length) {
          gridCourses.push(...grid)
          gridOk = true
        }
      } catch (err) {
        console.warn('[pdf] 表格线还原失败,退回坐标启发式', err)
      }

      // 2) 没有表格线的 PDF:按坐标还原成二维表,走和 Excel 一样的矩阵解析
      if (!gridOk) {
        const table = rowsFromPdfItems(items)
        if (table) tables.push(table)
      }
    }
  } finally {
    await doc.destroy()
  }
  return { text: pages.join('\n\n'), tables, gridCourses }
}

/** 兼容旧接口:只要文本(传 onTable 时会回调每页还原出的二维表) */
export async function extractPdfText(
  file: File | Blob,
  onTable?: (rows: string[][]) => void,
): Promise<string> {
  const res = await extractPdf(file)
  if (onTable) for (const t of res.tables) onTable(t)
  return res.text
}
