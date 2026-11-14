/**
 * PDF 课表还原自测:node --experimental-strip-types scripts/test-pdf.mjs
 *
 * 不去造真 PDF,而是直接构造 pdf.js 的 textContent.items
 * (每个文字项 = { str, transform:[a,b,c,d,x,y], width, height })——
 * 还原逻辑吃的就是这个,真 PDF 解出来也是这个形状。
 *
 * 覆盖:
 *   1. 标准「节次 × 星期」网格,格子里换行写课程名/教师/教室
 *   2. 行首写的是 08:00-08:45 而不是「第1节」
 *   3. 居中排版的格子(同一列每行起始 x 都不一样)
 *   4. 转置表(行 = 星期,列 = 节次)
 *   5. 不是表格的 PDF(纯文本列表)→ 必须返回 null,退回按行解析
 */
import { rowsFromPdfItems, textLinesFromPdfItems } from '../src/lib/pdfTable.ts'
import { parseTable, detectMatrixLayout } from '../src/lib/import.ts'

let pass = 0
let fail = 0

function eq(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label}`)
    console.log(`      实际: ${a}`)
    console.log(`      期望: ${e}`)
  }
}

function ok(label, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label} ${extra}`)
  }
}

/* -------- 构造 pdf.js 文字项 -------- */

const SIZE = 10

/** 以「中心 x」放一段文字(教务 PDF 的格子大多是居中的) */
function textAt(str, centerX, y, { align = 'center', size = SIZE } = {}) {
  const width = str.length * size * 0.95
  const x = align === 'center' ? centerX - width / 2 : centerX
  return {
    str,
    transform: [size, 0, 0, size, x, y],
    width,
    height: size,
    fontName: 'SimSun',
    hasEOL: false,
  }
}

/** 一个格子里三行:课程名 / 教师 / 教室 */
function cellLines(name, teacher, place, centerX, y) {
  return [
    textAt(name, centerX, y),
    textAt(teacher, centerX, y - 12),
    textAt(place, centerX, y - 24),
  ]
}

const WEEKDAYS = ['星期一', '星期二', '星期三', '星期四', '星期五']

function gridItems({ timeLabels = false, jitter = false } = {}) {
  const items = []
  // 标题行(很多教务 PDF 都有,只有一格,会把列边界带歪)
  items.push(textAt('2025-2026学年第1学期课程表', 300, 760))
  // 表头
  items.push(textAt(timeLabels ? '时间' : '节次', 60, 720))
  WEEKDAYS.forEach((w, i) => items.push(textAt(w, 150 + i * 80, 720)))

  const periods = timeLabels
    ? ['08:00-08:45', '08:55-09:40', '10:00-10:45', '10:55-11:40']
    : ['第一节', '第二节', '第三节', '第四节']

  // 每行一门课,放在第 i+1 列
  const rows = [
    { name: '高等数学', teacher: '张三', place: '教三302' },
    { name: '大学英语', teacher: '李四', place: '外语楼201' },
    { name: '体育', teacher: '王五', place: '操场' },
    { name: '数据结构', teacher: '赵六', place: '理学楼A301' },
  ]

  periods.forEach((label, r) => {
    const y = 680 - r * 70
    items.push(textAt(label, 60, y, { size: 9 }))
    const info = rows[r]
    // 第 r 行只在第 r 列有课(其余留白)
    const centerX = 150 + r * 80 + (jitter ? (r % 2 === 0 ? -6 : 7) : 0)
    items.push(...cellLines(info.name, info.teacher, info.place, centerX, y))
  })
  return items
}

console.log('\n=== 1. 标准「节次 × 星期」网格 ===')
{
  const table = rowsFromPdfItems(gridItems())
  ok('还原出了表格', !!table)
  if (table) {
    const h = table.findIndex((r) => r[0] === '节次')
    ok('找得到表头行', h >= 0)
    eq('表头行是星期', table[h]?.slice(0, 3), ['节次', '星期一', '星期二'])
    eq('行首是节次标签', table[h + 1]?.[0], '第一节')
    eq('单元格里三行原样保留', table[h + 1]?.[1], '高等数学\n张三\n教三302')
    eq('第二行是第二门课', table[h + 2]?.[2], '大学英语\n李四\n外语楼201')

    const res = parseTable(table, 'PDF')
    eq('解析出 4 门课', res.courses.length, 4)
    const c = res.courses[0]
    eq('课程名', c.name, '高等数学')
    eq('教师', c.teacher, '张三')
    eq('教室', c.location, '教三302')
    eq('星期', c.weekday, 1)
    eq('节次', c.period, 1)
    eq('第三门课在星期三', res.courses[2].weekday, 3)
  }
}

console.log('\n=== 2. 行首是时间(08:00-08:45)而不是「第1节」 ===')
{
  const table = rowsFromPdfItems(gridItems({ timeLabels: true }))
  ok('还原出了表格', !!table)
  if (table) {
    const layout = detectMatrixLayout(table)
    ok('被识别为矩阵表', !!layout)
    const res = parseTable(table, 'PDF')
    eq('解析出 4 门课', res.courses.length, 4)
    eq('第 1 行按行序推成第 1 节', res.courses[0].period, 1)
    eq('第 3 行按行序推成第 3 节', res.courses[2].period, 3)
    eq('课程名仍然正确', res.courses[2].name, '体育')
  }
}

console.log('\n=== 3. 居中排版(同一列每行起始 x 都不同)===')
{
  const table = rowsFromPdfItems(gridItems({ jitter: true }))
  ok('还原出了表格', !!table)
  if (table) {
    const res = parseTable(table, 'PDF')
    eq('解析出 4 门课', res.courses.length, 4)
    eq('高等数学落在星期一', res.courses[0].weekday, 1)
    eq('大学英语落在星期二', res.courses[1].weekday, 2)
    eq('数据结构落在星期四', res.courses[3].weekday, 4)
    eq('教室没有被串列', res.courses[1].location, '外语楼201')
  }
}

console.log('\n=== 4. 转置表(行 = 星期,列 = 节次)===')
{
  const items = []
  items.push(textAt('课程表', 300, 760))
  items.push(textAt('节次', 80, 720))
  ;['第一节', '第二节', '第三节', '第四节', '第五节'].forEach((p, i) =>
    items.push(textAt(p, 180 + i * 90, 720)),
  )
  const plan = [
    ['高等数学', '张三', '教三302'],
    ['大学英语', '李四', '外语楼201'],
    ['体育', '王五', '操场'],
    ['数据结构', '赵六', '理学楼A301'],
    ['操作系统', '孙七', '信息楼101'],
  ]
  WEEKDAYS.forEach((w, r) => {
    const y = 680 - r * 70
    items.push(textAt(w, 80, y))
    items.push(...cellLines(plan[r][0], plan[r][1], plan[r][2], 180 + r * 90, y))
  })

  const table = rowsFromPdfItems(items)
  ok('还原出了表格', !!table)
  if (table) {
    const res = parseTable(table, 'PDF')
    eq('解析出 5 门课', res.courses.length, 5)
    eq('第一门是星期一第一节', [res.courses[0].weekday, res.courses[0].period], [1, 1])
    eq('第五门是星期五第五节', [res.courses[4].weekday, res.courses[4].period], [5, 5])
    eq('教师没串行', res.courses[4].teacher, '孙七')
  }
}

console.log('\n=== 5. 不是表格的 PDF(纯文本列表)===')
{
  const items = []
  ;['高等数学 星期一 第1-2节 张三 教三302', '大学英语 星期二 第3-4节 李四 外语楼201'].forEach(
    (line, i) => items.push(textAt(line, 40, 700 - i * 14, { align: 'left' })),
  )
  eq('不硬凑成表格', rowsFromPdfItems(items), null)
  const lines = textLinesFromPdfItems(items)
  ok('按行取到了文本', lines.length === 2 && lines[0].includes('高等数学'))
}

console.log(`\n────────────────────────────`)
console.log(`通过 ${pass} 项,失败 ${fail} 项`)
console.log(`────────────────────────────\n`)
process.exit(fail > 0 ? 1 : 0)
