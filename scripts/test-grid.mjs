/**
 * 「带表格线的 PDF」还原自测:node --experimental-strip-types scripts/test-grid.mjs
 *
 * 不去造真 PDF,直接构造 PDF 里的两种原料:
 *   · segments —— 表格边框线(横线/竖线)
 *   · items    —— 文字项,每个带坐标和宽高
 * 和真 PDF 解出来是同一个形状,所以能测到真正的逻辑:
 *   · 格子窄、文字逐字折行 → 必须按格子拼回完整句子
 *   · 合并单元格(中间没画线)→ 一节课占多节
 *   · 一格多课 → 节次按顺序分开
 *   · 同名多组「教师,教室,周次」→ 各自占满整格
 *   · 展板式的「上午/下午/晚上」列、表头标题行 → 不能干扰
 */
import { coursesFromPageGrid } from '../src/lib/pdfGrid.ts'

let pass = 0
let fail = 0
const eq = (label, a, b) => {
  const x = JSON.stringify(a)
  const y = JSON.stringify(b)
  if (x === y) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label}\n      实际: ${x}\n      期望: ${y}`)
  }
}
const ok = (label, cond, extra = '') => {
  if (cond) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label} ${extra}`)
  }
}

/* ---------------- 构造原料 ---------------- */

const COLS = [50, 80, 140, 240, 340, 440, 540] // 50-80 上下午列,80-140 节次列,后面 4 天
const ROWS = [150, 240, 330, 420, 480] // 自下而上
const HEADER_Y = 500

const segs = []
const hline = (x0, x1, y) => segs.push({ x0, y0: y, x1, y1: y })
const vline = (x, y0, y1) => segs.push({ x0: x, y0, x1: x, y1 })

// 竖线(整张表)
for (const x of COLS) vline(x, ROWS[0], HEADER_Y - 20)
// 表头顶线
hline(COLS[0], COLS[COLS.length - 1], HEADER_Y - 20)
// 每列的横线:用「哪些行有分隔线」表达合并单元格
// 星期一:4 个独立格 → 每条行线都有
// 星期二:第一节+第二节合并 → 缺 330 那条线
// 星期三:第三节+第四节合并 → 缺 240 那条线
// 星期四:第三节+第四节合并 → 缺 240 那条线
const borders = {
  2: [420, 330, 240, 150], // 星期一列索引 2
  3: [330, 240, 150],
  4: [420, 330, 150],
  5: [420, 330, 150],
}
for (const [ci, ys] of Object.entries(borders)) {
  const col = Number(ci)
  for (const y of ys) hline(COLS[col], COLS[col + 1], y)
}
// 节次列:每节一行(真实表格里这一列不会合并)
for (const y of [420, 330, 240, 150]) hline(COLS[1], COLS[2], y)
// 上下边框
for (const col of [2, 3, 4, 5]) {
  hline(COLS[col], COLS[col + 1], ROWS[0])
  hline(COLS[col], COLS[col + 1], HEADER_Y - 20)
}

const items = []
const text = (s, x, y, w = s.length * 8) => items.push({ str: s, transform: [9, 0, 0, 9, x, y], width: w, height: 9 })

// 表头
text('时间', 95, HEADER_Y - 10)
;['星期一', '星期二', '星期三', '星期四'].forEach((d, i) => text(d, COLS[i + 2] + 15, HEADER_Y - 10))
// 节次列
;[['第一节', 450], ['第二节', 375], ['第三节', 285], ['第四节', 195]].forEach(([s, y]) => text(s, 90, y))
// 上下午列(干扰项)
text('上午', 60, 440)
text('下午', 60, 250)

// 星期一 第一节:线性代数(被逐字折成三行)
text('《线性代数》,王', 145, 455)
text('五,外语楼201,第14-16', 145, 443)
text('周', 145, 431)

// 星期二 第一节+第二节(合并):一门课占两节
text('《高等数学》,张三,', 245, 400)
text('外语楼201,第7-8周', 245, 388)

// 星期三 第三节+第四节(合并):两门课挤在一格
text('《高等数学》,李四,教三302,', 345, 300)
text('第11-12周 《线性代数》,王五,', 345, 288)
text('外语楼201,第14-15周', 345, 276)

// 星期四 第三节+第四节(合并):同名课,三组不同的教师/周次
text('《高等数学》,张三,', 445, 300)
text('教三302,第7-8周 ,李四,', 445, 290)
text('教三302,第10-12周 ,张三,', 445, 280)
text('教三302,第9周', 445, 270)

console.log('\n=== 带表格线的课表 → 按格子还原 ===')
const courses = coursesFromPageGrid(segs, items)
ok('还原出了课程', !!courses, String(courses))

if (courses) {
  const find = (name, extra = () => true) => courses.find((c) => c.name === name && extra(c))

  const itx = find('线性代数', (c) => c.weekday === 1)
  ok('折行的课程名拼回完整「线性代数」', !!itx, JSON.stringify(courses.map((c) => c.name)))
  eq('  星期', itx?.weekday, 1)
  eq('  节次', itx?.period, 1)
  eq('  节数', itx?.periods, 1)
  eq('  教师(被拆成「王/五」也拼回来)', itx?.teacher, '王五')
  eq('  教室', itx?.location, '外语楼201')
  eq('  周次', [itx?.startWeek, itx?.endWeek], [14, 16])

  const merged = find('高等数学', (c) => c.weekday === 2)
  eq('合并单元格 → 一门课占两节', [merged?.period, merged?.periods], [1, 2])
  eq('  周次', [merged?.startWeek, merged?.endWeek], [7, 8])

  const wed = courses.filter((c) => c.weekday === 3)
  eq('一格两门课 → 拆成两门', wed.length, 2)
  eq('  第一门占前半段', [wed[0]?.name, wed[0]?.period, wed[0]?.periods], ['高等数学', 3, 1])
  eq('  第二门接在后面', [wed[1]?.name, wed[1]?.period, wed[1]?.periods], ['线性代数', 4, 1])

  const thu = courses.filter((c) => c.weekday === 4)
  eq('同名多组 → 三条记录', thu.length, 3)
  eq('  第一条周次', [thu[0]?.startWeek, thu[0]?.endWeek], [7, 8])
  eq('  第二条周次', [thu[1]?.startWeek, thu[1]?.endWeek], [10, 12])
  eq('  第二条教师', thu[1]?.teacher, '李四')
  eq('  第三条周次', [thu[2]?.startWeek, thu[2]?.endWeek], [9, 9])
  eq('  每条都占满整格', thu.map((c) => [c.period, c.periods]), [[3, 2], [3, 2], [3, 2]])

  eq('总课程数', courses.length, 7)
}

console.log('\n=== 没有表格线 → 必须返回 null(让调用方退回旧方案)===')
eq('空线段', coursesFromPageGrid([], items), null)

console.log(`\n────────────────────────────`)
console.log(`通过 ${pass} 项,失败 ${fail} 项`)
console.log(`────────────────────────────\n`)
process.exit(fail > 0 ? 1 : 0)
