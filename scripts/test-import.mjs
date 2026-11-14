/**
 * 用真实的 Excel 文件验证导入解析:
 *   A. 长表型教务导出
 *   B. 星期 × 节次矩阵型课表
 *   C. 矩阵型 + 单双周 + 多行单元格
 * 运行:node --experimental-strip-types scripts/test-import.mjs
 */
import * as XLSX from 'xlsx'
import { parseExcel, dedupeCourses, parseTable, courseSignature, toCourses, mergeAdjacentWeekSegments } from '../src/lib/import.ts'

let pass = 0
let fail = 0
function ok(label, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label} ${detail}`)
  }
}

function makeFile(rows, sheetName = 'Sheet1') {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

console.log('\n=== A. 长表型教务导出 ===')
{
  const rows = [
    ['序号', '课程名称', '教师姓名', '上课地点', '星期', '节次', '周次'],
    [1, '高等数学', '张伟', '教三302', '周一', '1-2节', '1-16周'],
    [2, '大学英语', '李娜', '一教201', '周一', '3-4节', '1-16周'],
    [3, '数据结构', '王强', '实训楼5-302', '周三', '5-6节', '3-16周'],
    [4, '体育(篮球)', '刘洋', '体育馆', '周五', '7-8节', '1-16周'],
  ]
  const res = await parseExcel(makeFile(rows))
  ok(`解析出 4 门课(实得 ${res.courses.length})`, res.courses.length === 4, JSON.stringify(res.warnings))
  const m = res.courses[0]
  ok('课程名', m?.name === '高等数学', m?.name)
  ok('教师', m?.teacher === '张伟', m?.teacher)
  ok('教室', m?.location === '教三302', m?.location)
  ok('星期=1', m?.weekday === 1, String(m?.weekday))
  ok('节次=1', m?.period === 1, String(m?.period))
  ok('连堂 2 节', m?.periods === 2, String(m?.periods))
  ok('周次 1-16', m?.startWeek === 1 && m?.endWeek === 16, `${m?.startWeek}-${m?.endWeek}`)
  const d = res.courses[2]
  ok('第3门 周三', d?.weekday === 3, String(d?.weekday))
  ok('第3门 起始周 3', d?.startWeek === 3, String(d?.startWeek))
  ok('第3门 地点含实训楼', (d?.location ?? '').includes('实训楼'), d?.location)
  ok('第4门 长表保留原课程名', res.courses[3]?.name === '体育(篮球)', res.courses[3]?.name)
}

console.log('\n=== B. 矩阵型课表(行=节次,列=星期) ===')
{
  const rows = [
    ['', '星期一', '星期二', '星期三', '星期四', '星期五'],
    ['第1节', '高等数学\n(张老师)\n@教三302', '', '线性代数\n(赵老师)\n@教二305', '', '大学语文\n@文科楼305'],
    ['第2节', '', '', '', '概率论\n@教三305', ''],
    ['第3节', '大学英语\n(李老师)\n@一教201', '马克思主义基本原理\n@文科楼210', '', '操作系统\n@实训楼305', ''],
    ['第4节', '', '', '体育\n@体育馆', '', ''],
  ]
  const res = await parseExcel(makeFile(rows))
  ok(`解析出 8 门课(实得 ${res.courses.length})`, res.courses.length === 8, JSON.stringify(res.warnings))
  const names = res.courses.map((c) => c.name)
  ok('含高等数学', names.includes('高等数学'), names.join(','))
  ok('含操作系统', names.includes('操作系统'), names.join(','))
  const gao = res.courses.find((c) => c.name === '高等数学')
  ok('矩阵:星期一', gao?.weekday === 1, String(gao?.weekday))
  ok('矩阵:第1节', gao?.period === 1, String(gao?.period))
  ok('矩阵:教师', gao?.teacher === '张', gao?.teacher)
  ok('矩阵:教室', gao?.location === '教三302', gao?.location)
  const yuwen = res.courses.find((c) => c.name === '大学语文')
  ok('矩阵:星期五', yuwen?.weekday === 5, String(yuwen?.weekday))
}

console.log('\n=== C. 矩阵 + 单双周标记 ===')
{
  const rows = [
    ['', '周一', '周三'],
    ['第1节', '体育(单周)\n@体育馆', '体育(双周)\n@体育馆'],
    ['第2节', '', ''],
  ]
  const res = await parseExcel(makeFile(rows))
  ok(`解析出 2 门课(实得 ${res.courses.length})`, res.courses.length === 2, JSON.stringify(res.warnings))
  const odd = res.courses.find((c) => c.name === '体育' && c.weekday === 1)
  const even = res.courses.find((c) => c.name === '体育' && c.weekday === 3)
  ok('单周课程只排奇数周', (odd?.singleWeeks ?? []).every((w) => w % 2 === 1), JSON.stringify(odd?.singleWeeks))
  ok('双周课程只排偶数周', (even?.singleWeeks ?? []).every((w) => w % 2 === 0), JSON.stringify(even?.singleWeeks))
}

console.log('\n=== D. 兜底:完全陌生的表头 ===')
{
  const rows = [
    ['课程', '任课老师', '地点', '上课时间', '开课周次'],
    ['离散数学', '陈老师', '教三401', '周二3-4节', '2-14周'],
  ]
  const res = await parseExcel(makeFile(rows))
  ok(`仍能解析出课程(实得 ${res.courses.length})`, res.courses.length >= 1, JSON.stringify(res.warnings))
  const d = res.courses[0]
  ok('课程名', d?.name === '离散数学', d?.name)
  ok('教师', d?.teacher === '陈老师', d?.teacher)
  ok('星期=2', d?.weekday === 2, String(d?.weekday))
  ok('周次 2-14', d?.startWeek === 2 && d?.endWeek === 14, `${d?.startWeek}-${d?.endWeek}`)
}

console.log('\n=== D2. 真实教务导出的各种排版 ===')
{
  // D2-1 标准矩阵:行=节次,列=星期,节次标签是中文「第一节」
  {
    const f = makeFile([
      ['', '星期一', '星期二', '星期三', '星期四', '星期五'],
      ['第一节', '高等数学\n张三\n教三302', '大学英语\n李四\n外语楼201', '', '体育\n王五\n操场', ''],
      ['第二节', '高等数学\n张三\n教三302', '', '线性代数\n赵六\n教二401', '', ''],
    ])
    const r = await parseExcel(f)
    ok('中文节次标签「第一节」的矩阵能解析', r.courses.length === 5, `${r.courses.length} 门`)
    const m = r.courses.find((c) => c.name === '高等数学')
    ok('  课程名对', m?.name === '高等数学', m?.name)
    ok('  教师(裸姓名)对', m?.teacher === '张三', m?.teacher)
    ok('  教室对', m?.location === '教三302', m?.location)
    ok('  星期对', m?.weekday === 1, String(m?.weekday))
    ok('  节次对', m?.period === 1, String(m?.period))
  }

  // D2-2 表头上面有学校标题行(教务导出最常见的样式)
  {
    const f = makeFile([
      ['某某大学2025-2026学年第1学期课程表', '', '', '', '', ''],
      ['', '星期一', '星期二', '星期三', '星期四', '星期五'],
      ['第一节', '高等数学\n张三\n教三302', '大学英语\n李四\n外语楼201', '', '体育\n王五\n操场', ''],
    ])
    const r = await parseExcel(f)
    ok('带标题行的矩阵能解析', r.courses.length === 3, `${r.courses.length} 门`)
    const m = r.courses.find((c) => c.name === '高等数学')
    ok('  节次没被标题行带偏', m?.period === 1, String(m?.period))
    ok('  教师对', m?.teacher === '张三', m?.teacher)
  }

  // D2-3 转置矩阵:行=星期,列=节次
  {
    const f = makeFile([
      ['', '第一节', '第二节', '第三节'],
      ['星期一', '高等数学\n张三\n教三302', '高等数学\n张三\n教三302', ''],
      ['星期二', '大学英语\n李四\n外语楼201', '', ''],
    ])
    const r = await parseExcel(f)
    ok('转置矩阵(行=星期)能解析', r.courses.length === 3, `${r.courses.length} 门`)
    const m = r.courses.find((c) => c.name === '高等数学')
    ok('  星期对', m?.weekday === 1, String(m?.weekday))
    ok('  节次对', m?.period === 1, String(m?.period))
    ok('  教师对', m?.teacher === '张三', m?.teacher)
  }

  // D2-4 节次写成「1-2节」
  {
    const f = makeFile([
      ['', '星期一', '星期二'],
      ['1-2节', '高等数学\n张三\n教三302', ''],
      ['3-4节', '', '大学英语\n李四\n外语楼201'],
    ])
    const r = await parseExcel(f)
    ok('节次写成「1-2节」能解析', r.courses.length === 2, `${r.courses.length} 门`)
    const m = r.courses.find((c) => c.name === '高等数学')
    ok('  起始节次对', m?.period === 1, String(m?.period))
    ok('  连排节数对', m?.periods === 2, String(m?.periods))
  }

  // D2-5 表头用「周一」而不是「星期一」
  {
    const f = makeFile([
      ['', '周一', '周二', '周三'],
      ['第一节', '高等数学\n张三\n教三302', '', ''],
      ['第二节', '', '大学英语\n李四\n外语楼201', ''],
    ])
    const r = await parseExcel(f)
    ok('表头写「周一」也能解析', r.courses.length === 2, `${r.courses.length} 门`)
    ok('  星期对', r.courses[0]?.weekday === 1, String(r.courses[0]?.weekday))
  }

  // D2-6 单元格里带周次与单双周
  {
    const f = makeFile([
      ['', '星期一', '星期二'],
      ['第一节', '高等数学\n张三\n教三302\n1-16周', ''],
      ['第二节', '', '大学英语\n李四\n外语楼201\n1-16周(单)'],
    ])
    const r = await parseExcel(f)
    ok('单元格带周次能解析', r.courses.length === 2, `${r.courses.length} 门`)
    const m = r.courses.find((c) => c.name === '高等数学')
    ok('  周次对', m?.startWeek === 1 && m?.endWeek === 16, `${m?.startWeek}-${m?.endWeek}`)
    const s = r.courses.find((c) => c.name === '大学英语')
    ok('  单周被认出来', (s?.singleWeeks?.length ?? 0) === 8, String(s?.singleWeeks?.length))
  }
}

console.log('\n=== D3. 更多教务排版变体 ===')
{
  // D3-1 课程名里带周次
  {
    const r = await parseExcel(makeFile([
      ['', '星期一', '星期二'],
      ['第一节', '高等数学(1-16周)\n张三\n教三302', ''],
      ['第二节', '', '大学英语(3-16周)\n李四\n外语楼201'],
    ]))
    ok('课程名带周次能解析', r.courses.length === 2, `${r.courses.length} 门`)
    const m = r.courses.find((c) => c.name === '高等数学')
    ok('  周次从课程名里读出来', m?.startWeek === 1 && m?.endWeek === 16, `${m?.startWeek}-${m?.endWeek}`)
    const e = r.courses.find((c) => c.name === '大学英语')
    ok('  「外语楼201」认成教室', e?.location === '外语楼201', e?.location)
  }

  // D3-2 一整行挤在一格(空格分隔)
  {
    const r = await parseExcel(makeFile([
      ['', '星期一', '星期二'],
      ['第一节', '高等数学 张三 教三302 1-16周', ''],
      ['第二节', '', '大学英语 李四 外语楼201'],
    ]))
    ok('单行单元格能解析', r.courses.length === 2, `${r.courses.length} 门`)
    const m = r.courses.find((c) => c.teacher === '张三')
    ok('  裸教师名没被算进课程名', m?.name === '高等数学', m?.name)
    ok('  教室对', m?.location === '教三302', m?.location)
  }

  // D3-3 节次列是纯数字
  {
    const r = await parseExcel(makeFile([
      ['', '星期一', '星期二', '星期三'],
      ['1', '高等数学\n张三\n教三302', '', ''],
      ['2', '', '大学英语\n李四\n外语楼201', ''],
      ['3', '', '', '体育\n王五\n操场'],
    ]))
    ok('节次列纯数字能解析', r.courses.length === 3, `${r.courses.length} 门`)
    ok('  节次对', r.courses[0]?.period === 1, String(r.courses[0]?.period))
  }

  // D3-4 表头首格写「节次」(矩阵表头,别被当成长表)
  {
    const r = await parseExcel(makeFile([
      ['节次', '星期一', '星期二'],
      ['第一节', '高等数学\n张三\n教三302', ''],
      ['第二节', '', '大学英语\n李四\n外语楼201'],
    ]))
    ok('表头首格写「节次」仍按矩阵解析', r.courses.length === 2, `${r.courses.length} 门`)
    ok('  教师对', r.courses[0]?.teacher === '张三', r.courses[0]?.teacher)
  }
}

console.log('\n=== D4. PDF 网格还原 ===')
{
  // D4-1 按 x 坐标把文字项还原成二维表
  const { rowsFromPdfItems } = await import('../src/lib/notify.ts')
  const mk = (x, y, str) => ({ transform: [0, 0, 1, 1, x, y], str })
  const items = [
    mk(50, 800, '2025-2026学年第1学期课程表'),
    mk(50, 760, '节次'), mk(150, 760, '星期一'), mk(250, 760, '星期二'),
    mk(350, 760, '星期三'), mk(450, 760, '星期四'), mk(550, 760, '星期五'),
    mk(50, 730, '第一节'), mk(150, 730, '高等数学 张三 教三302'),
    mk(250, 730, '大学英语 李四 外语楼201'), mk(450, 730, '体育 王五 操场'),
    mk(50, 702, '第二节'), mk(150, 702, '高等数学 张三 教三302'),
    mk(350, 702, '线性代数 赵六 教二401'),
    mk(50, 674, '第三节'), mk(250, 674, '大学英语 李四 外语楼201'),
    mk(550, 674, '中国近代史 孙七 文学院204'),
  ]
  const table = rowsFromPdfItems(items)
  ok('PDF 能还原出表格', !!table)
  ok('  还原出 6 列', table?.[0].length === 6, String(table?.[0].length))
  ok('  标题行在最上面', table?.[0][0]?.includes('课程表'), table?.[0][0])
  ok('  表头行认出星期', table?.[1]?.[1] === '星期一', table?.[1]?.[1])
  ok('  第一节认出课程', table?.[2]?.[1] === '高等数学 张三 教三302', table?.[2]?.[1])

  // D4-2 还原出来的表能直接走矩阵解析
  if (table) {
    const r = parseTable(table, 'PDF')
    ok('还原出来的表能解析出课程', r.courses.length === 7, `${r.courses.length} 门`)
    const m = r.courses.find((c) => c.name === '高等数学')
    ok('  课程名对', m?.name === '高等数学', m?.name)
    ok('  教师对', m?.teacher === '张三', m?.teacher)
    ok('  教室对', m?.location === '教三302', m?.location)
    ok('  星期对', m?.weekday === 1, String(m?.weekday))
    ok('  节次对', m?.period === 1, String(m?.period))
  }

  // D4-3 不是表格的 PDF 应该返回 null(而不是硬还原)
  const notTable = rowsFromPdfItems([
    mk(10, 700, '随便一段文字'), mk(10, 680, '又是一段'), mk(10, 660, '还是一段'),
    mk(10, 640, '第四段'), mk(10, 620, '第五段'), mk(10, 600, '第六段'),
  ])
  ok('纯文字段落不还原成表格', notTable === null, JSON.stringify(notTable)?.slice(0, 40))
}

console.log('\n=== E. 去重 ===')
{
  const list = [
    { name: '高数', weekday: 1, period: 1, periods: 2, startWeek: 1, endWeek: 16 },
    { name: '高数', weekday: 1, period: 1, periods: 2, startWeek: 1, endWeek: 16 },
    { name: '英语', weekday: 2, period: 1, periods: 2, startWeek: 1, endWeek: 16 },
  ]
  ok('重复项被合并', dedupeCourses(list).length === 2, String(dedupeCourses(list).length))

  // 同名同时间但不同周次 = 两段安排,不能合并
  const weeks = [
    { name: '高等数学', weekday: 4, period: 1, periods: 4, startWeek: 7, endWeek: 8 },
    { name: '高等数学', weekday: 4, period: 1, periods: 4, startWeek: 9, endWeek: 9 },
  ]
  ok('同名不同周次不会被合并', dedupeCourses(weeks).length === 2, String(dedupeCourses(weeks).length))

  // 内容签名:决定「是不是同一门课」
  const a = { name: ' 高数 ', weekday: 1, period: 1, periods: 2, startWeek: 1, endWeek: 16, teacher: '张三', location: '教三302' }
  const b = { name: '高数', weekday: 1, period: 1, periods: 2, startWeek: 1, endWeek: 16, teacher: '张三', location: '教三302' }
  ok('签名忽略首尾空格', courseSignature(a) === courseSignature(b))
  ok('换了老师 → 签名不同', courseSignature(a) !== courseSignature({ ...b, teacher: '李四' }))
  ok('换了周次 → 签名不同', courseSignature(a) !== courseSignature({ ...b, startWeek: 2 }))

  // 确定性 id:同一份课表导入两次必须得到同样的 id,不然就会插两条
  const once = toCourses([a])
  const twice = toCourses([b])
  ok('同一门课两次导入得到同一个 id', once[0].id === twice[0].id, `${once[0].id} vs ${twice[0].id}`)
  ok('不同课程 id 不同', toCourses([{ ...a, name: '英语' }])[0].id !== once[0].id)
}

console.log('\n=== F. 同一门课的周次分段合并 ===')
{
  const base = { name: '高等数学', weekday: 4, period: 1, periods: 4, location: '教三302' }

  // 相邻周次、同一老师 → 合成一条
  const same = mergeAdjacentWeekSegments([
    { ...base, teacher: '张三', startWeek: 7, endWeek: 8 },
    { ...base, teacher: '张三', startWeek: 9, endWeek: 9 },
  ])
  ok('相邻周次合并成一条', same.length === 1, JSON.stringify(same))
  ok('  合并后的周次是 7-9', same[0]?.startWeek === 7 && same[0]?.endWeek === 9, JSON.stringify(same[0]))

  // 相邻周次、换了老师 → 也合成一条,变化写备注
  const withNote = mergeAdjacentWeekSegments([
    { ...base, teacher: '张三', startWeek: 7, endWeek: 8 },
    { ...base, teacher: '张三', startWeek: 9, endWeek: 9 },
    { ...base, teacher: '李四', startWeek: 10, endWeek: 12 },
  ])
  ok('三段合成一条', withNote.length === 1, JSON.stringify(withNote))
  ok('  周次覆盖 7-12', withNote[0]?.startWeek === 7 && withNote[0]?.endWeek === 12, JSON.stringify(withNote[0]))
  ok('  保留最早的老师', withNote[0]?.teacher === '张三', String(withNote[0]?.teacher))
  ok('  换老师写进备注', /第10-12周由李四授课/.test(withNote[0]?.remark ?? ''), String(withNote[0]?.remark))

  // 中间断周 → 不合并
  const gap = mergeAdjacentWeekSegments([
    { ...base, teacher: '张三', startWeek: 7, endWeek: 8 },
    { ...base, teacher: '张三', startWeek: 10, endWeek: 11 },
  ])
  ok('断周不合并', gap.length === 2, JSON.stringify(gap))

  // 不同星期 / 不同教室 / 单双周 → 都不合并
  ok(
    '不同星期不合并',
    mergeAdjacentWeekSegments([
      { ...base, weekday: 4, startWeek: 7, endWeek: 8 },
      { ...base, weekday: 5, startWeek: 9, endWeek: 9 },
    ]).length === 2,
  )
  ok(
    '不同教室不合并',
    mergeAdjacentWeekSegments([
      { ...base, location: '教三302', startWeek: 7, endWeek: 8 },
      { ...base, location: '外语楼201', startWeek: 9, endWeek: 9 },
    ]).length === 2,
  )
  ok(
    '带单双周的不合并',
    mergeAdjacentWeekSegments([
      { ...base, startWeek: 1, endWeek: 16, singleWeeks: [1, 3, 5] },
      { ...base, startWeek: 2, endWeek: 16, singleWeeks: [2, 4, 6] },
    ]).length === 2,
  )
}

console.log(`\n────────────────────────────`)
console.log(`通过 ${pass} 项,失败 ${fail} 项`)
console.log(`────────────────────────────\n`)
process.exit(fail > 0 ? 1 : 0)
