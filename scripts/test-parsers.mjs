/**
 * 解析器自测:node --experimental-strip-types scripts/test-parsers.mjs
 * 覆盖 时间换算 / 自然语言 / 自由文本课表 / 知识库检索
 */
import {
  parseCourse,
  parseHomework,
  parseClock,
  parseTimeRange,
  cnToNumber,
  parseEvent,
  parseEventTime,
  parseEventLocation,
  inferEventKind,
  extractEventTitle,
  resolveEventDate,
} from '../src/lib/nl.ts'
import { parseFreeTextLine, parsePlainText } from '../src/lib/import.ts'
import { chunkText, bm25Scores, tokenize } from '../src/lib/knowledge.ts'
import {
  dateToWeek,
  weekToMonday,
  dateOfWeekday,
  sessionAt,
  sessionsInWeek,
  coursesConflict,
  findConflicts,
  courseTimeRange,
} from '../src/lib/time.ts'
import {
  generatePeriods,
  parsePeriodsText,
  formatPeriodsText,
  blocksFromPeriods,
  paceFromPeriods,
  segmentLabel,
} from '../src/lib/schedule.ts'
import {
  eventSlot,
  eventsInWeek,
  eventsOnDate,
  eventBlockStyle,
  eventToNoteContent,
  eventKindMeta,
  EVENT_COLOR,
} from '../src/lib/event.ts'
import { COURSE_COLORS } from '../src/lib/utils.ts'
import { AI_PRESETS } from '../src/lib/settings.ts'
import { explainAiError, listModels } from '../src/lib/ai.ts'
import { parseQuickCapture, looksLikeEvent } from '../src/lib/quickCapture.ts'

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
    console.log(`  ✗ ${label}\n      期望 ${e}\n      实际 ${a}`)
  }
}

function ok(label, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label} ${detail}`)
  }
}

console.log('\n=== 1. 中文数字与时间解析 ===')
eq('cnToNumber 十', cnToNumber('十'), 10)
eq('cnToNumber 十二', cnToNumber('十二'), 12)
eq('cnToNumber 三', cnToNumber('三'), 3)
eq('下午3点 → 900 分钟', parseClock('下午3点').minutes, 900)
eq('晚上7点半 → 1170 分钟', parseClock('晚上7点半').minutes, 1170)
eq('上午8点 → 480 分钟', parseClock('上午8点').minutes, 480)
eq('15:30 → 930 分钟', parseClock('15:30').minutes, 930)
eq('1-2节 → [1,2]', parseTimeRange('1-2节').periods, [1, 2])
eq('15:00-16:45 → 900..1005', [parseTimeRange('15:00-16:45').start, parseTimeRange('15:00-16:45').end], [900, 1005])

console.log('\n=== 2. 自然语言录入课程 ===')
{
  const c = parseCourse('周三下午3点高等数学 教三302')
  ok('能解析出课程', !!c)
  eq('课程名', c?.name, '高等数学')
  eq('星期', c?.weekday, 3)
  eq('教室', c?.location, '教三302')
  eq('开始时间', c?.startTime, '15:00')
}
{
  const c = parseCourse('周一1-2节大学英语 一教201')
  eq('连堂:节次', c?.period, 1)
  eq('连堂:节数', c?.periods, 2)
  eq('连堂:课程名', c?.name, '大学英语')
  eq('连堂:教室', c?.location, '一教201')
}
{
  const c = parseCourse('周五 15:00-16:45 线性代数 教二305')
  eq('时间段:开始', c?.startTime, '15:00')
  eq('时间段:结束', c?.endTime, '16:45')
  eq('时间段:课程名', c?.name, '线性代数')
}
{
  const c = parseCourse('周四3-4节体育 体育馆')
  eq('节次范围:节次', c?.period, 3)
  eq('节次范围:节数', c?.periods, 2)
  eq('节次范围:课程名', c?.name, '体育')
  eq('节次范围:地点', c?.location, '体育馆')
}
{
  const c = parseCourse('周二第5节大学物理(王老师) 实验楼201')
  eq('括号老师', c?.teacher, '王')
  ok('老师从名字里剥离', !c?.name.includes('王老师'), `name=${c?.name}`)
}

console.log('\n=== 3. 自然语言录入作业 ===')
{
  const h = parseHomework('每周五交高数周记')
  eq('作业标题', h?.title, '高数周记')
  eq('星期', h?.weekday, 5)
  eq('截止时间默认', h?.timeOfDay, '23:59')
}
{
  const h = parseHomework('下周一 18:00 前提交实验报告')
  ok('标题里去掉时间', !/\d{2}:\d{2}/.test(h?.title ?? ''), `title=${h?.title}`)
}

console.log('\n=== 4. 自由文本课表行(PDF/OCR 兜底) ===')
{
  const c = parseFreeTextLine('周一 1-2节 高等数学 张老师 教三302 (1-16周)')
  ok('能解析', !!c)
  eq('课程名', c?.name, '高等数学')
  eq('星期', c?.weekday, 1)
  eq('节次', c?.period, 1)
  eq('节数', c?.periods, 2)
  eq('周次起', c?.startWeek, 1)
  eq('周次止', c?.endWeek, 16)
}
{
  const c = parseFreeTextLine('周四 第3-4节 大学物理 物理楼 401')
  ok('带"第"字也能解析', !!c)
  eq('节次', c?.period, 3)
  eq('节数', c?.periods, 2)
}

console.log('\n=== 5. 多行课表文本 ===')
{
  const text = `学期课表
周一 1-2节 高等数学 张老师 教三302 1-16周
周二 3-4节 大学英语 李老师 一教201 1-16周
周三 5-6节 数据结构 王老师 实训楼 5-8周
周五 7-8节 体育 赵老师 体育馆 1-16周`
  const r = parsePlainText(text)
  eq('解析出 4 门课', r.courses.length, 4)
  eq('第一门', r.courses[0]?.name, '高等数学')
  eq('第四门地点', r.courses[3]?.location, '体育馆')
}

console.log('\n=== 6. 教学周次换算 ===')
{
  const sem = '2026-09-07' // 周一
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  eq('第1周的周一', ymd(weekToMonday(1, sem)), '2026-09-07')
  eq('第5周的周一', ymd(weekToMonday(5, sem)), '2026-10-05')
  eq('周一属于第1周', dateToWeek(new Date(2026, 8, 7), sem), 1)
  eq('周日属于第1周', dateToWeek(new Date(2026, 8, 13), sem), 1)
  eq('下周一属于第2周', dateToWeek(new Date(2026, 8, 14), sem), 2)
  eq('第3周周三日期', dateOfWeekday(3, 3, sem).getDate(), 23)
}

console.log('\n=== 7. 课程时段与冲突 ===')
{
  const settings = {
    id: 'app', semesterStart: '2026-09-07', weekCount: 20,
    periods: [
      { index: 1, start: '08:00', end: '08:45' },
      { index: 2, start: '08:55', end: '09:40' },
      { index: 3, start: '10:00', end: '10:45' },
      { index: 4, start: '10:55', end: '11:40' },
    ],
  }
  const a = {
    id: 'a', name: '高数', weekday: 1, period: 1, periods: 2,
    startWeek: 1, endWeek: 16, createdAt: 0, updatedAt: 0,
  }
  const b = {
    id: 'b', name: '物理', weekday: 1, period: 2, periods: 1,
    startWeek: 1, endWeek: 16, createdAt: 0, updatedAt: 0,
  }
  const c = {
    id: 'c', name: '英语', weekday: 2, period: 1, periods: 1,
    startWeek: 1, endWeek: 16, createdAt: 0, updatedAt: 0,
  }
  ok('节次重叠判为冲突', coursesConflict(a, b))
  ok('不同星期不冲突', !coursesConflict(a, c))
  eq('找出 1 个冲突', findConflicts(a, [a, b, c]).length, 1)

  const s = sessionAt(a, 1, settings)
  eq('课开始 8:00', s?.start.getHours(), 8)
  eq('课结束 9:40(连堂2节)', s?.end.getHours(), 9)
  eq('连堂结束分钟', s?.end.getMinutes(), 40)
  eq('本周共 2 门课', sessionsInWeek([a, b, c], 1, settings).length, 3)
}

console.log('\n=== 8. 知识库切片与检索 ===')
{
  const long = '傅里叶变换是信号处理的核心工具。'.repeat(30)
  const chunks = chunkText(long, { size: 300, overlap: 50 })
  ok('能切成多片', chunks.length > 1, `chunks=${chunks.length}`)
  ok('切片不超长', chunks.every((c) => c.length <= 400), 'too long')

  const docs = [
    { id: '1', docId: 'd1', title: '高数笔记', text: '洛必达法则用于求极限,注意条件', createdAt: 0 },
    { id: '2', docId: 'd2', title: '线代笔记', text: '特征值与特征向量决定对角化', createdAt: 0 },
    { id: '3', docId: 'd3', title: '物理笔记', text: '牛顿第二定律 F=ma,受力分析要画图', createdAt: 0 },
  ]
  const scores = bm25Scores('特征值怎么算', docs)
  const best = scores.indexOf(Math.max(...scores))
  eq('检索命中线代笔记', docs[best].title, '线代笔记')
  ok('中文能分出二元组', tokenize('特征值').includes('特征'), 'no bigram')
}

console.log('\n=== 9. 学校作息(按学校调整)===')
{
  // ---- 生成器 ----
  const blocks = [
    { id: 'morning', label: '上午', start: '08:00', count: 2 },
    { id: 'afternoon', label: '下午', start: '14:00', count: 2 },
    { id: 'evening', label: '晚上', start: '19:00', count: 1 },
  ]
  const gen = generatePeriods(blocks, { duration: 45, gap: 10 })
  eq('生成 5 节', gen.length, 5)
  eq('第一节 08:00 开始', gen[0].start, '08:00')
  eq('第一节 08:45 结束', gen[0].end, '08:45')
  eq('课间 10 分钟 → 第二节 08:55', gen[1].start, '08:55')
  eq('下午段从 14:00 重新开始', gen[2].start, '14:00')
  eq('晚上段从 19:00 开始', gen[4].start, '19:00')
  eq('节次编号连续', gen.map((p) => p.index), [1, 2, 3, 4, 5])

  const gen40 = generatePeriods([{ id: 'morning', label: '上午', start: '08:00', count: 1 }], {
    duration: 40,
    gap: 5,
  })
  eq('40 分钟制结束于 08:40', gen40[0].end, '08:40')

  // ---- 文本导入 ----
  const parsed = parsePeriodsText('1 08:00-08:45\n第2节 08:55 - 09:40\n08:00~08:45')
  eq('文本解析出 3 节', parsed?.length, 3)
  eq('带序号的行能解析', parsed?.[0].start, '08:00')
  eq('带空格的行能解析', parsed?.[1].end, '09:40')
  eq('波浪号能解析', parsed?.[2].end, '08:45')
  eq('序号自动重排', parsed?.map((p) => p.index), [1, 2, 3])
  eq('乱写的行会被拒绝', parsePeriodsText('这一行看不懂'), null)
  eq('结束早于开始会被拒绝', parsePeriodsText('1 09:00-08:00'), null)
  eq('空文本返回 null', parsePeriodsText('   '), null)

  // ---- 文本导出 ----
  const text = formatPeriodsText([
    { index: 1, start: '08:00', end: '08:45' },
    { index: 2, start: '08:55', end: '09:40' },
  ])
  ok('导出含节次与时间', text.includes('第1节 08:00-08:45') && text.includes('第2节 08:55-09:40'), text)
  eq('导出后能原样解析回来', parsePeriodsText(text)?.length, 2)

  // ---- 反推 ----
  const standard = [
    { index: 1, start: '08:00', end: '08:45' },
    { index: 2, start: '08:55', end: '09:40' },
    { index: 3, start: '10:00', end: '10:45' },
    { index: 4, start: '14:00', end: '14:45' },
    { index: 5, start: '19:00', end: '19:45' },
  ]
  const back = blocksFromPeriods(standard)
  eq('上午反推出 3 节', back[0].count, 3)
  eq('下午反推出 1 节', back[1].count, 1)
  eq('晚上反推出 1 节', back[2].count, 1)
  eq('上午起点反推正确', back[0].start, '08:00')
  const p = paceFromPeriods(standard)
  eq('每节时长反推为 45', p.duration, 45)
  eq('课间反推为 10', p.gap, 10)

  // ---- 时段标签 ----
  eq('08:00 是上午', segmentLabel('08:00'), '上午')
  eq('14:00 是下午', segmentLabel('14:00'), '下午')
  eq('19:30 是晚上', segmentLabel('19:30'), '晚上')

  // ---- 课程起止时间 ----
  const settings = {
    id: 'app', semesterStart: '2026-09-07', weekCount: 20,
    periods: standard,
  }
  const single = { id: 'x', name: '高数', weekday: 1, period: 1, periods: 1, startWeek: 1, endWeek: 16, createdAt: 0, updatedAt: 0 }
  const double = { ...single, id: 'y', periods: 2, period: 1 }
  eq('单节课起止时间', courseTimeRange(single, settings)?.label, '08:00–08:45')
  eq('连堂课跨两节取总时长', courseTimeRange(double, settings)?.label, '08:00–09:40')
  eq('找不到节次返回 null', courseTimeRange({ ...single, period: 99 }, settings), null)
}

console.log('\n=== 10. 行程(课程之外的校园活动)===')
{
  const settings = {
    id: 'app', semesterStart: '2026-09-07', weekCount: 20,
    periods: [
      { index: 1, start: '08:00', end: '08:45' },
      { index: 2, start: '08:55', end: '09:40' },
      { index: 3, start: '10:00', end: '10:45' },
      { index: 4, start: '10:55', end: '11:40' },
      { index: 9, start: '19:00', end: '19:45' },
      { index: 10, start: '19:55', end: '20:40' },
    ],
  }
  const base = {
    kind: 'meeting', location: '学活 301', detail: '带月度总结',
    createdAt: 0, updatedAt: 0,
  }
  // 2026-09-07 是周一 → 第 1 周
  const mon = { ...base, id: 'e1', title: '学生会例会', date: '2026-09-07', start: '19:00', end: '20:00' }
  const tue = { ...base, id: 'e2', title: '党会', date: '2026-09-08', start: '10:00', end: '11:40' }
  const nextWeek = { ...base, id: 'e3', title: '别的周', date: '2026-09-14', start: '19:00', end: '20:00' }
  const weekly = { ...base, id: 'e4', title: '每周例会', date: '2026-09-07', start: '19:00', end: '20:00', weekly: true }

  // ---- 时间映射到节次 ----
  const slot = eventSlot(mon, settings)
  eq('19:00 落在第 9 节', slot.startPeriod, 9)
  eq('20:00 落在第 10 节', slot.endPeriod, 10)
  eq('跨两节的行程占 2 行', slot.endPeriod - slot.startPeriod + 1, 2)
  const slot2 = eventSlot(tue, settings)
  eq('10:00 落在第 3 节', slot2.startPeriod, 3)
  eq('11:40 落在第 4 节', slot2.endPeriod, 4)

  // ---- 某一周出现的行程 ----
  const w1 = eventsInWeek([mon, tue, nextWeek, weekly], 1, settings)
  eq('第 1 周出现 3 项', w1.length, 3)
  eq('每周重复的行程每周都出现', w1.filter((o) => o.event.id === 'e4').length, 1)
  eq('别的周的不出现在第 1 周', w1.filter((o) => o.event.id === 'e3').length, 0)
  const w2 = eventsInWeek([mon, tue, nextWeek, weekly], 2, settings)
  eq('第 2 周只出现每周重复的 + 本周单次', w2.length, 2)
  eq('第 2 周不含第 1 周的单次行程', w2.filter((o) => o.event.id === 'e1').length, 0)

  // ---- 星期与日期 ----
  const o = w1.find((x) => x.event.id === 'e1')
  eq('周一落在星期 1', o.weekday, 1)
  eq('日期原样保留', o.date, '2026-09-07')
  const o2 = w1.find((x) => x.event.id === 'e2')
  eq('周二落在星期 2', o2.weekday, 2)

  // ---- 按日期取 ----
  eq('按日期取到周一的两项', eventsOnDate([mon, tue, nextWeek, weekly], '2026-09-07', settings).length, 2)
  eq('按日期取到周二的一项', eventsOnDate([mon, tue, nextWeek, weekly], '2026-09-08', settings).length, 1)
  eq('没有行程的日期返回空', eventsOnDate([mon, tue], '2026-09-10', settings).length, 0)

  // ---- 视觉:行程块不是实心色块 ----
  const style = eventBlockStyle(EVENT_COLOR)
  ok('行程块用虚线边框', style.border.includes('dashed'), style.border)
  ok('行程块有斜纹底纹', style.backgroundImage.includes('repeating-linear-gradient'), style.backgroundImage)
  ok('行程块不是实心色', !style.background || style.background !== EVENT_COLOR, String(style.background))
  ok('行程色不在课表色板里', !COURSE_COLORS.includes(EVENT_COLOR), EVENT_COLOR)

  // ---- 同步到备忘录的正文 ----
  const content = eventToNoteContent(mon)
  ok('备忘正文含标题', content.includes('学生会例会'), content)
  ok('备忘正文含时间', content.includes('19:00'), content)
  ok('备忘正文含地点', content.includes('学活 301'), content)
  ok('备忘正文含备注', content.includes('带月度总结'), content)
  ok('备忘正文标明是自动同步', content.includes('自动同步'), content)

  // ---- 类型 ----
  eq('会议类型的图标存在', eventKindMeta('meeting').label, '会议')
  eq('未知类型回落到其他', eventKindMeta('xxx').id, 'other')
}


console.log('\n=== 12. 微信消息 → 行程识别 ===')
{
  // 固定「现在」:2026-11-09 周一
  const now = new Date(2026, 10, 9, 10, 55)
  const periods = [
    { index: 1, start: '08:00', end: '08:45' },
    { index: 2, start: '08:55', end: '09:40' },
    { index: 3, start: '10:00', end: '10:45' },
    { index: 4, start: '10:55', end: '11:40' },
    { index: 5, start: '14:00', end: '14:45' },
    { index: 6, start: '14:55', end: '15:40' },
    { index: 7, start: '16:00', end: '16:45' },
    { index: 8, start: '19:00', end: '19:45' },
  ]
  const P = (t) => parseEvent(t, { now, periods })

  // ---- 最典型的场景 ----
  const a = P('周三下午3点开党会')
  ok('能读出行程', !!a)
  eq('标题去掉开头的「开」', a.title, '党会')
  eq('党会归到党团', a.kind, 'party')
  eq('周三落到最近的那个周三', a.date, '2026-11-11')
  eq('下午3点 = 15:00', a.start, '15:00')
  eq('没写结束时间按 1 小时', a.end, '16:00')

  // ---- 带地点 ----
  const b = P('周三下午3点开党会,在教三201')
  eq('读出地点', b.location, '教三201')
  eq('地点不该混进标题', b.title.includes('201'), false)

  // ---- 逗号分句:地点 / 备注 ----
  const c = P('明天晚上7点学生会例会,在学生活动中心301,记得带笔记本')
  eq('读出完整标题', c.title, '学生会例会')
  eq('学生会例会归到会议', c.kind, 'meeting')
  eq('明天 = 次日', c.date, '2026-11-10')
  eq('晚上7点 = 19:00', c.start, '19:00')
  eq('读出活动中心地点', c.location, '学生活动中心301')
  ok('后半句进备注', c.detail.includes('带笔记本'), c.detail)

  // ---- 没有逗号(微信常见):地点不能咬掉标题尾巴 ----
  const c2 = P('明天晚上7点 学生会例会在学生活动中心301')
  eq('无逗号时标题完整', c2.title, '学生会例会')
  eq('无逗号时地点正确', c2.location, '学生活动中心301')
  eq('无逗号时仍是会议', c2.kind, 'meeting')

  // ---- 半小时 ----
  const d = P('本周五下午2点半 社团纳新')
  eq('2点半 = 14:30', d.start, '14:30')
  eq('社团纳新归到社团', d.kind, 'club')
  eq('本周五落到最近的周五', d.date, '2026-11-13')

  // ---- 明确的时间段 ----
  const e = P('下周三 15:00-16:30 党课')
  eq('读出时间段', `${e.start}-${e.end}`, '15:00-16:30')
  eq('党课归到党团', e.kind, 'party')
  eq('「下周三」比本周三晚一周', e.date, '2026-11-18')

  // ---- 每周重复 ----
  const f = P('每周三下午3点开党会')
  eq('识别为每周重复', f.weekly, true)

  // ---- 节次(按学校作息换算) ----
  const g = P('周三第3-4节 班会')
  eq('节次换算成钟点', `${g.start}-${g.end}`, '10:00-11:40')
  eq('班会归到会议', g.kind, 'meeting')
  eq('标题不残留「第」', g.title, '班会')

  // ---- 带寒暄前缀 + 在地点有事项 ----
  const h = P('提醒一下,周三下午3点在教三201有党会,记得带笔记本')
  eq('前导寒暄不会吃掉日期', h.date, '2026-11-11')
  eq('「在…有…」也能读出标题', h.title, '党会')
  eq('地点照常读出', h.location, '教三201')

  // ---- 地点带方位 ----
  const i2 = P('周五晚上8点 宿舍楼下聚餐')
  eq('「宿舍楼下」整段是地点', i2.location, '宿舍楼下')
  eq('标题不残留「下」', i2.title, '聚餐')

  // ---- 具体月日 ----
  const j = P('12月3日下午3点 团建')
  eq('读出月日', j.date, '2026-12-03')
  eq('团建归到党团', j.kind, 'party')

  // ---- 讲座 ----
  const k = P('周六上午10点 讲座 大礼堂')
  eq('讲座归到讲座', k.kind, 'lecture')
  eq('「大礼堂」不截断成「礼堂」', k.location, '大礼堂')
  eq('标题不残留「大」', k.title, '讲座')

  // ---- 没写日期/时间 ----
  const l = P('有个会')
  ok('没日期时也能给出草稿', !!l)
  ok('没日期会给出提示', l.notes.some((n) => n.includes('日期')), l.notes.join('|'))

  // ---- 时间读取的细节 ----
  eq('15:00-16:30', `${parseEventTime('15:00-16:30').start}-${parseEventTime('15:00-16:30').end}`, '900-990')
  eq('晚上7点-8点半沿用上下午', `${parseEventTime('晚上7点-8点半').start}-${parseEventTime('晚上7点-8点半').end}`, '1140-1230')
  eq('下午3点到4点', `${parseEventTime('下午3点到4点').start}-${parseEventTime('下午3点到4点').end}`, '900-960')
  eq('上午9点到10点', `${parseEventTime('上午9点到10点').start}-${parseEventTime('上午9点到10点').end}`, '540-600')

  // ---- 地点 / 类型 / 日期 的独立函数 ----
  eq('地点:教三201', parseEventLocation('在教三201'), '教三201')
  eq('地点:学生活动中心301', parseEventLocation('学生活动中心301'), '学生活动中心301')
  eq('地点:标题里的「例会」不能被咬进地点', parseEventLocation('例会在学生活动中心301'), '学生活动中心301')
  eq('地点:介词「在」要被削掉', parseEventLocation('在学生活动中心301'), '学生活动中心301')
  eq('地点:第二活动中心', parseEventLocation('第二活动中心'), '第二活动中心')
  eq('地点:不该把普通词当地点', parseEventLocation('开党会'), undefined)
  eq('类型:党会', inferEventKind('开党会'), 'party')
  eq('类型:例会', inferEventKind('学生会例会'), 'meeting')
  eq('类型:认不出就归其他', inferEventKind('随便什么'), 'other')
  eq('标题:去掉动词', extractEventTitle('开党会'), '党会')
  eq('标题:不把「开会」削成「会」', extractEventTitle('开会'), '开会')
  eq('日期:今天', resolveEventDate('今天', now).date, '2026-11-09')
  eq('日期:后天', resolveEventDate('后天', now).date, '2026-11-11')
  eq('日期:周三', resolveEventDate('周三', now).date, '2026-11-11')
}


console.log('\n=== 13. 全局粘贴捕获(淘宝式) ===')
{
  const now = new Date(2026, 10, 9, 10, 55)
  const periods = [
    { index: 1, start: '08:00', end: '08:45' },
    { index: 3, start: '10:00', end: '10:45' },
    { index: 5, start: '14:00', end: '14:45' },
    { index: 8, start: '19:00', end: '19:45' },
  ]

  // ---- 哪些该认,哪些不该 ----
  ok('「周三下午3点开党会」该认', looksLikeEvent('周三下午3点开党会'))
  ok('「明天晚上7点学生会例会」该认', looksLikeEvent('明天晚上7点学生会例会'))
  ok('只有日期+活动词也该认', looksLikeEvent('周三开党会'))
  ok('普通文字不该认', !looksLikeEvent('这是一段普通的笔记文字,随便写点什么'))
  ok('只有日期没时间没活动词不该认', !looksLikeEvent('周三的课记得改到教三302'))
  ok('没日期不该认', !looksLikeEvent('下午3点开党会'))
  ok('超长文本不该认', !looksLikeEvent('很长的文字'.repeat(30) + '周三'))

  // ---- 读出来的东西 ----
  const a = parseQuickCapture('周三下午3点开党会,在教三201', { now, periods })
  ok('能读出活动消息', !!a)
  eq('标题是「党会」', a.parsed.title, '党会')
  eq('地点是教三201', a.parsed.location, '教三201')
  eq('日期是最近的那个周三', a.parsed.date, '2026-11-11')
  eq('时间是 15:00', a.parsed.start, '15:00')

  // ---- 不该打扰的情况 ----
  eq('普通文字返回 null', parseQuickCapture('这是一段普通的笔记文字', { now, periods }), null)
  eq('课程名不抢(交给导入页)', parseQuickCapture('周三下午3点高数教三302', { now, periods }), null)
  eq('带活动词的课程名仍然认', parseQuickCapture('周三下午3点英语角活动', { now, periods })?.parsed.title, '英语角活动')
  eq('空字符串返回 null', parseQuickCapture('', { now, periods }), null)
  eq('空白返回 null', parseQuickCapture('   \n  ', { now, periods }), null)

  // ---- 原始文本留着,方便回显 ----
  eq('保留原文', parseQuickCapture('  周三下午3点开党会  ', { now, periods })?.raw, '周三下午3点开党会')

  // ---- 口语里的「今晚 / 明晚」也算日期信号(之前会静默忽略) ----
  ok('「今晚7点开班会」该认', looksLikeEvent('今晚7点开班会'))
  ok('「明晚7点学生会例会」该认', looksLikeEvent('明晚7点学生会例会'))
  const tonight = parseQuickCapture('今晚7点开班会', { now, periods })
  eq('今晚 → 今天', tonight?.parsed.date, '2026-11-09')
  eq('今晚 7 点 → 19:00', tonight?.parsed.start, '19:00')
  const tomorrowNight = parseQuickCapture('明晚7点学生会例会', { now, periods })
  eq('明晚 → 明天', tomorrowNight?.parsed.date, '2026-11-10')

  // ---- 微信消息经常不止 80 字,不能因为长就丢掉 ----
  const longMsg =
    '通知一下,本周三下午3点在教学楼A301开党支部会议,请全体党员准时参加,记得带上笔记本和本月思想汇报材料,' +
    '如有特殊情况请提前向辅导员请假,另外请大家把上个月的会议记录一并带来,收到请在群里回复确认,谢谢大家配合'
  ok('较长的微信群通知也认得出', longMsg.length > 80 && looksLikeEvent(longMsg), String(longMsg.length))
  ok('  并且能解析出时间', !!parseQuickCapture(longMsg, { now, periods }))
}


console.log('\n=== 14. AI 服务商预设 ===')
{
  const ids = AI_PRESETS.map((p) => p.id)
  ok('预设数量不少于 10 个', AI_PRESETS.length >= 10, String(AI_PRESETS.length))
  eq('预设 id 不重复', new Set(ids).size, ids.length)

  // 每个预设都要把该填的填齐(「自定义」除外,它就是留空的)
  for (const p of AI_PRESETS.filter((x) => x.id !== 'custom')) {
    ok(`${p.label}: 有 baseUrl`, !!p.baseUrl)
    ok(`${p.label}: 有模型名`, !!p.model)
    ok(`${p.label}: 有申请 Key 链接`, !!p.keyUrl)
    ok(`${p.label}: 有说明文字`, p.note.length > 4)
    ok(`${p.label}: 地址是 https`, p.baseUrl.startsWith('https://'))
    ok(`${p.label}: 地址不带结尾斜杠`, !p.baseUrl.endsWith('/'))
    ok(`${p.label}: 地址带版本号`, /\/(v\d|api\/v\d)/.test(p.baseUrl), p.baseUrl)
    if (p.embedModel) {
      ok(`${p.label}: 向量模型有地址`, !!p.embedBaseUrl)
    }
  }

  // 豆包:模型名和向量模型名必须是真名,不能是占位符
  const doubao = AI_PRESETS.find((p) => p.id === 'doubao')
  eq('豆包地址是方舟 v3', doubao.baseUrl, 'https://ark.cn-beijing.volces.com/api/v3')
  eq('豆包模型名不是占位符', /ep-x|xxxx/i.test(doubao.model), false)
  ok('豆包模型名是真实模型 ID', doubao.model.startsWith('doubao-'), doubao.model)
  eq('豆包向量模型名正确', doubao.embedModel, 'doubao-embedding-text-240715')
  eq('豆包浏览器可直连', doubao.direct, true)

  // 直连不通的服务商要标出来(选了预设就会自动打开转发)
  for (const p of AI_PRESETS.filter((x) => !x.direct)) {
    ok(`${p.label}: 标注了需要转发`, p.direct === false)
  }

  // 已知直连不通的三家
  eq('智谱标为需转发', AI_PRESETS.find((p) => p.id === 'glm').direct, false)
  eq('OpenAI 官方标为需转发', AI_PRESETS.find((p) => p.id === 'openai').direct, false)
  eq('Groq 标为需转发', AI_PRESETS.find((p) => p.id === 'groq').direct, false)
  eq('火山方舟标为可直连', AI_PRESETS.find((p) => p.id === 'doubao').direct, true)
  eq('DeepSeek 标为可直连', AI_PRESETS.find((p) => p.id === 'deepseek').direct, true)
}

console.log('\n=== 15. AI 报错翻译(把天书变人话) ===')
{
  ok('接入点不存在', !!explainAiError('Endpoint not found'))
  ok('权限不足', !!explainAiError('Access Denied - Please ensure you have activated this model'))
  ok('模型不存在', !!explainAiError('model doubao-xxx does not exist'))
  ok('Key 格式错', !!explainAiError('The API key format is incorrect'))
  ok('额度不足', !!explainAiError('Insufficient balance'))
  ok('限流', !!explainAiError('Rate limit reached'))
  eq('看不懂的报错就不乱翻译', explainAiError('随便一句看不懂的'), undefined)
}

console.log('\n=== 16. 自动拉取模型列表 ===')
{
  const realFetch = globalThis.fetch
  const mock = (body, status = 200) => {
    globalThis.fetch = async () => new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
  const aiBase = {
    provider: 'openai',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    model: '',
    embedBaseUrl: '',
    embedApiKey: '',
    embedModel: '',
  }

  try {
    // OpenAI 兼容:data[].id
    mock({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] })
    const r1 = await listModels(aiBase)
    eq('拉取 OpenAI 兼容格式', r1.models, ['deepseek-chat', 'deepseek-reasoner'])
    ok('  返回了实际请求地址', r1.endpoint.endsWith('/models'), r1.endpoint)

    // 有的中转站直接返回数组
    mock([{ id: 'gpt-4o-mini' }, 'gpt-4o'])
    eq('也认纯数组 / 字符串', (await listModels(aiBase)).models, ['gpt-4o', 'gpt-4o-mini'])

    // Anthropic 风格 {data:[{id}]}
    mock({ data: [{ id: 'claude-3-5-sonnet-latest' }] })
    eq('拉取 Anthropic 格式', (await listModels({ ...aiBase, provider: 'anthropic' })).models, ['claude-3-5-sonnet-latest'])

    // 401:要把服务商的原始报错带出来
    mock({ error: { message: 'Invalid API key' } }, 401)
    let err401 = null
    try { await listModels(aiBase) } catch (e) { err401 = e }
    ok('401 会抛错', !!err401)
    ok('  错误里带上了服务商原话', /Invalid API key/.test(err401?.message ?? ''), String(err401?.message))

    // 没有模型字段
    mock({ data: [] })
    let emptyErr = null
    try { await listModels(aiBase) } catch (e) { emptyErr = e }
    ok('空列表会提示手填', /手填/.test(emptyErr?.hint ?? ''), String(emptyErr?.hint))

    // 跨域被拦:fetch 抛 TypeError
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
    let corsErr = null
    try { await listModels(aiBase) } catch (e) { corsErr = e }
    ok('跨域被拦会翻译成人话', /跨域/.test(corsErr?.hint ?? ''), String(corsErr?.hint))
    ok('  并且带上实际请求地址', /https:\/\/api\.example\.com\/v1\/models/.test(corsErr?.message ?? ''), String(corsErr?.message))

    // 没填地址 / Key 时的提示
    let noUrl = null
    try { await listModels({ ...aiBase, baseUrl: '' }) } catch (e) { noUrl = e }
    ok('没填地址会提示', /API 地址/.test(noUrl?.message ?? ''), String(noUrl?.message))

    // 中转站常见坑:地址没带 /v1 → 404,自动再试 /v1
    let calls = []
    globalThis.fetch = async (url) => {
      calls.push(String(url))
      if (calls.length === 1) {
        return new Response(JSON.stringify({ error: { message: 'Not Found' } }), { status: 404, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({ data: [{ id: 'relay-model' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const relay = await listModels({ ...aiBase, baseUrl: 'https://relay.example.com' })
    eq('地址缺 /v1 时会自动重试', relay.models, ['relay-model'])
    eq('  并给出建议地址', relay.suggestedBaseUrl, 'https://relay.example.com/v1')
    ok('  第二次请求打到了 /v1/models', calls[1].endsWith('/v1/models'), calls.join(' , '))

    // 2026-11:有的中转站 200 但返回空列表 → 要把原文带回去,方便排查
    mock({ object: 'list', data: [] })
    let emptyBody = null
    try { await listModels(aiBase) } catch (e) { emptyBody = e }
    ok('空列表也算失败', !!emptyBody)
    ok('  带回了服务商原始响应片段', /"data":\[\]/.test(emptyBody?.bodyPreview ?? ''), String(emptyBody?.bodyPreview))

    // 有的中转站返回 id→对象 的映射表
    mock({ 'gpt-4o-mini': { owned_by: 'openai' }, 'gpt-4o': { owned_by: 'openai' } })
    eq('映射表形状也能解析', (await listModels(aiBase)).models, ['gpt-4o', 'gpt-4o-mini'])
  } finally {
    globalThis.fetch = realFetch
  }
}

console.log(`\n────────────────────────────`)
console.log(`通过 ${pass} 项,失败 ${fail} 项`)
console.log(`────────────────────────────\n`)
process.exit(fail > 0 ? 1 : 0)