import { useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  ExternalLink,
  MapPin,
  AlertTriangle,
  BookOpen,
  Link2,
  CalendarRange,
  User,
  Star,
  Clock,
  Flag,
  Repeat,
  Zap,
  Pencil,
  Trash2,
} from 'lucide-react'
import type { Course, CourseEvent, Homework, Settings } from '../types'
import {
  courseInWeek,
  coursePeriods,
  courseTimeRange,
  currentWeek,
  detectTransitRisks,
  weekToMonday,
  WEEKDAY_CN,
} from '../lib/time'
import {
  EVENT_COLOR,
  eventBlockStyle,
  eventKindMeta,
  eventsInWeek,
  layoutEvents,
  shortDate,
  weekdayLabel,
} from '../lib/event'
import { Button, Badge, Empty, Star as StarIcon, Card } from './ui'
import { Select, Tooltip, Popover, Empty as AntEmpty, Checkbox, Tag, App as AntApp } from 'antd'
import { CourseDialog } from './CourseDialog'
import { EventDialog } from './EventDialog'
import { upsertCourse, deleteCourse, upsertEvent, deleteEvent } from '../lib/actions'
import { cn, COURSE_COLORS, hashColor, readableText } from '../lib/utils'

interface Props {
  courses: Course[]
  events: CourseEvent[]
  homework: Homework[]
  settings: Settings
  onToast: (text: string, type?: 'info' | 'success' | 'error') => void
}

const ROW_H = 86

export function ScheduleView({ courses, events, homework, settings, onToast }: Props) {
  const thisWeek = currentWeek(settings)
  const { message } = AntApp.useApp()
  const [week, setWeek] = useState(thisWeek)
  const [editing, setEditing] = useState<Course | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<CourseEvent | null>(null)
  const [eventDialogOpen, setEventDialogOpen] = useState(false)
  const [dragOver, setDragOver] = useState<{ weekday: number; period: number } | null>(null)
  const dragId = useRef<string | null>(null)

  /* ---------------- 顶部筛选(Ant Design 控件,皮肤沿用课程桌的米黄) ---------------- */
  const [courseFilter, setCourseFilter] = useState<string[]>([])
  const [teacherFilter, setTeacherFilter] = useState<string[]>([])
  const [onlyHomework, setOnlyHomework] = useState(false)
  const filtersActive = courseFilter.length > 0 || teacherFilter.length > 0 || onlyHomework
  const clearFilters = () => {
    setCourseFilter([])
    setTeacherFilter([])
    setOnlyHomework(false)
  }

  /** 卡片上的快捷删除:antd message 带「撤销」,比一句 toast 友好 */
  const quickDelete = async (c: Course) => {
    await deleteCourse(c.id)
    message.open({
      type: 'success',
      duration: 6,
      content: (
        <span className="inline-flex items-center gap-2">
          已删除「{c.name}」
          <button
            className="text-[12px] font-bold text-tangerine-600 hover:text-tangerine-700 underline underline-offset-2"
            onClick={async () => {
              await upsertCourse(c)
              message.destroy()
              onToast(`「${c.name}」已恢复`, 'success')
            }}
          >
            撤销
          </button>
        </span>
      ),
    })
  }

  const todayWeekday = new Date().getDay() === 0 ? 7 : new Date().getDay()
  // 只有正在看「本周」时才是「今天」;翻到第 3 周还把当天整列标成今天会误导
  const today = week === thisWeek ? todayWeekday : -1
  const monday = weekToMonday(week, settings.semesterStart)

  const visible = useMemo(() => {
    let list = courses.filter((c) => courseInWeek(c, week))
    if (courseFilter.length) list = list.filter((c) => courseFilter.includes(c.name))
    if (teacherFilter.length) list = list.filter((c) => c.teacher && teacherFilter.includes(c.teacher))
    if (onlyHomework) {
      const withHw = new Set(homework.filter((h) => !h.done).map((h) => h.courseId))
      list = list.filter((c) => withHw.has(c.id))
    }
    return list
  }, [courses, week, courseFilter, teacherFilter, onlyHomework, homework])

  /** 筛选下拉的候选项(来自全部课程,而不是当前周) */
  const courseOptions = useMemo(
    () => [...new Set(courses.map((c) => c.name))].sort().map((n) => ({ label: n, value: n })),
    [courses],
  )
  const teacherOptions = useMemo(
    () =>
      [...new Set(courses.map((c) => c.teacher).filter((t): t is string => !!t))]
        .sort()
        .map((t) => ({ label: t, value: t })),
    [courses],
  )

  /** 本周出现的行程(每周重复的每周都出现) */
  const occurrences = useMemo(() => eventsInWeek(events, week, settings), [events, week, settings])
  /** 同一时段有多个行程时并排摆放(经典日历分栏) */
  const positioned = useMemo(() => layoutEvents(occurrences), [occurrences])
  const eventsByDay = useMemo(() => {
    const map = new Map<number, typeof positioned>()
    for (const p of positioned) {
      const list = map.get(p.occ.weekday) ?? []
      list.push(p)
      map.set(p.occ.weekday, list)
    }
    return map
  }, [positioned])

  const risks = useMemo(() => detectTransitRisks(courses, settings, new Date(), 1), [courses, settings])

  const openNew = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = (c: Course) => {
    setEditing(c)
    setDialogOpen(true)
  }

  const openNewEvent = () => {
    setEditingEvent(null)
    setEventDialogOpen(true)
  }

  const openEditEvent = (ev: CourseEvent) => {
    setEditingEvent(ev)
    setEventDialogOpen(true)
  }

  const handleDrop = async (weekday: number, period: number) => {
    const id = dragId.current
    dragId.current = null
    setDragOver(null)
    if (!id) return
    const course = courses.find((c) => c.id === id)
    if (!course) return
    /*
     * 连堂课要按「跨度」夹紧:两节连排的课拖到最后一节时,
     * 第二节课会超出网格,被外层 overflow-hidden 裁掉一半,而且点不到。
     */
    const span = coursePeriods(course).length
    const target = Math.max(1, Math.min(period, maxPeriod - span + 1))
    if (course.weekday === weekday && course.period === target) return
    await upsertCourse({ ...course, weekday, period: target })
    onToast(`「${course.name}」已移动到星期${WEEKDAY_CN[weekday - 1]}第${target}节`, 'success')
  }

  const maxPeriod = Math.max(6, ...settings.periods.map((p) => p.index))

  return (
    <div className="space-y-5">
      {/* ============ 页头:克制的一块暖色,承载周次与操作 ============ */}
      <section
        className="relative overflow-hidden rounded-[20px] shadow-soft-lg"
        style={{ background: 'linear-gradient(135deg, #EE7C3C 0%, #E5763A 46%, #D4642A 100%)' }}
      >
        <div className="relative px-5 pt-5 pb-5 sm:px-7 sm:pt-6 sm:pb-6">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="min-w-0">
              <div className="text-[10.5px] font-bold tracking-[0.18em] text-white/65 uppercase">
                {settings.weekCount} 周 · 你的课程表
              </div>
              <h1 className="mt-2 flex items-baseline gap-2 text-[30px] sm:text-[34px] font-bold tracking-[-0.02em] text-white leading-none">
                第 {week} 周
                {week === thisWeek && (
                  <span className="text-[11px] font-bold tracking-normal text-white/70 bg-white/15 px-2 py-0.5 rounded-full">
                    本周
                  </span>
                )}
              </h1>
              <p className="mt-2 text-[12px] text-white/70 tabular-nums">
                {monday.getMonth() + 1}/{monday.getDate()} 起 · 本周 {visible.length} 门课
              </p>
            </div>

            {/* 操作区:所有控件统一 36px 高、同一圆角,严格对齐 */}
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
              <div className="flex items-center rounded-[10px] bg-white/[0.14] h-9 overflow-hidden">
                <Tooltip title="上一周" mouseEnterDelay={0.4}>
                  <button
                    onClick={() => setWeek((w) => Math.max(1, w - 1))}
                    className="w-8 h-9 text-white/90 hover:bg-white/15 grid place-items-center transition-colors"
                    aria-label="上一周"
                  >
                    <ChevronLeft size={16} />
                  </button>
                </Tooltip>
                <Tooltip title={week === thisWeek ? '现在就是本周' : '回到本周'} mouseEnterDelay={0.4}>
                  <button
                    onClick={() => setWeek(thisWeek)}
                    className="px-2.5 h-9 text-white text-[12.5px] font-bold hover:bg-white/15 transition-colors whitespace-nowrap"
                  >
                    本周
                  </button>
                </Tooltip>
                <Tooltip title="下一周" mouseEnterDelay={0.4}>
                  <button
                    onClick={() => setWeek((w) => Math.min(settings.weekCount, w + 1))}
                    className="w-8 h-9 text-white/90 hover:bg-white/15 grid place-items-center transition-colors"
                    aria-label="下一周"
                  >
                    <ChevronRight size={16} />
                  </button>
                </Tooltip>
              </div>

              <div className="hidden w-[108px] shrink-0 sm:block">
                <Select
                  value={week}
                  onChange={setWeek}
                  className="w-full"
                  size="middle"
                  popupMatchSelectWidth={132}
                options={Array.from({ length: settings.weekCount }, (_, i) => ({
                  label: `第 ${i + 1} 周`,
                  value: i + 1,
                }))}
                  aria-label="跳到某一周"
                />
              </div>

              <button
                onClick={openNew}
                className="inline-flex shrink-0 items-center gap-1.5 h-9 px-3.5 rounded-[10px] bg-white text-ink text-[12.5px] font-bold hover:bg-white/90 active:translate-y-[1px] transition-all shadow-soft-sm"
              >
                <Plus size={15} /> 加课
              </button>
              <button
                onClick={openNewEvent}
                title="添加行程:学生会会议、党会、讲座等"
                className="inline-flex shrink-0 items-center gap-1.5 h-9 px-3 rounded-[10px] border border-white/25 text-white text-[12.5px] font-bold hover:bg-white/12 active:translate-y-[1px] transition-all"
              >
                <Flag size={15} /> <span className="hidden sm:inline">加行程</span>
              </button>
            </div>
          </div>

          {/* 图例:细线 + 小方块,不用颜色本身说话 */}
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[10.5px] font-medium text-white/60">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-[3px] bg-white/85" />
              课程
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-[3px] border border-white/45"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(45deg, rgba(255,255,255,.55) 0 1.5px, transparent 1.5px 4px)',
                }}
              />
              行程
            </span>
          </div>
        </div>
      </section>

      {/* ============ 赶课提醒(移动端折叠成一行,不抢课表) ============ */}
      {risks.length > 0 && (
        <div className="rounded-[16px] border border-ink/[0.07] bg-white/70 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-tangerine-500 shrink-0" />
            <span className="text-[12.5px] font-bold text-ink whitespace-nowrap">本周赶课提醒</span>
            <Badge color="#E5763A">{risks.length} 处</Badge>
            {/* 移动端只给一句摘要,把版面让给课表 */}
            <span className="ml-auto text-[11.5px] text-ink-mute truncate lg:hidden">
              {risks[0].message.split(',')[0]}
            </span>
          </div>
          <div className="hidden lg:block space-y-0.5 mt-1.5">
            {risks.slice(0, 4).map((r, i) => (
              <div key={i} className="text-[12px] text-ink-soft">
                <span className="text-ink-mute mr-1">·</span>
                {r.message}
                {r.level === 'high' && (
                  <span className="ml-1.5 text-[11px] text-cherry-500 font-bold">建议提前出发</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ============ 筛选条(Ant Design Select / Checkbox / Tag) ============ */}
      <div className="flex flex-wrap items-center gap-2.5 rounded-[14px] border border-ink/[0.07] bg-white/75 px-3 py-2">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-ink-mute">筛选</span>

        <Select
          mode="multiple"
          allowClear
          maxTagCount={1}
          value={courseFilter}
          onChange={setCourseFilter}
          options={courseOptions}
          placeholder="按课程"
          className="min-w-[132px] max-w-[220px]"
          size="middle"
        />
        <Select
          mode="multiple"
          allowClear
          maxTagCount={1}
          value={teacherFilter}
          onChange={setTeacherFilter}
          options={teacherOptions}
          placeholder="按教师"
          className="min-w-[120px] max-w-[200px]"
          size="middle"
        />
        <Checkbox checked={onlyHomework} onChange={(e) => setOnlyHomework(e.target.checked)}>
          <span className="text-[12px] font-semibold">只看有作业</span>
        </Checkbox>

        {filtersActive && (
          <>
            <Tag color="orange" closable onClose={clearFilters} className="!m-0">
              筛选中 · {visible.length} 门
            </Tag>
            <button
              onClick={clearFilters}
              className="text-[11.5px] font-bold text-ink-mute hover:text-ink underline underline-offset-2"
            >
              重置
            </button>
          </>
        )}
      </div>

      {/* ============ 本周无课 / 筛选无结果 ============ */}
      {courses.length > 0 && visible.length === 0 && (
        <div className="rounded-[16px] border border-ink/[0.07] bg-white/70 py-2">
          <AntEmpty
            image={AntEmpty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span className="text-[12.5px] text-ink-mute">
                {filtersActive ? '当前筛选下没有课,换个条件试试' : `第 ${week} 周没有课`}
              </span>
            }
          >
            {filtersActive ? (
              <Button variant="secondary" size="sm" onClick={clearFilters}>
                清除筛选
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={openNew}>
                <Plus size={13} /> 加一门课
              </Button>
            )}
          </AntEmpty>
        </div>
      )}

      {/* ============ 课表网格(视觉主角) ============ */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            {/* 表头 */}
            <div className="flex border-b-2 border-ink/[0.08] bg-butter-100 sticky top-0 z-10">
              <div className="w-[64px] shrink-0 px-2 py-3 text-[11px] font-bold text-ink-mute flex items-center justify-center">
                节次
              </div>
              {WEEKDAY_CN.map((w, i) => {
                const isToday = i + 1 === today
                return (
                  <div
                    key={w}
                    className={cn(
                      'flex-1 min-w-[96px] py-3 text-center',
                      isToday ? 'bg-tangerine-500/[0.10]' : '',
                    )}
                  >
                    <span
                      className={cn(
                        'text-[14px] font-bold',
                        isToday ? 'text-tangerine-700' : 'text-ink',
                      )}
                    >
                      星期{w}
                    </span>
                    {isToday && (
                      <span className="block text-[10px] font-bold text-tangerine-600/80 mt-0.5">今天</span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* 网格主体 */}
            <div className="flex">
              {/* 时间轴 */}
              <div className="w-[64px] shrink-0 relative bg-butter-50 border-r-2 border-ink/[0.08]" style={{ height: maxPeriod * ROW_H }}>
                {settings.periods.map((p) => (
                  <div
                    key={p.index}
                    className="absolute inset-x-0 text-center pt-1.5"
                    style={{ top: (p.index - 1) * ROW_H, height: ROW_H }}
                  >
                    <div className="text-[11.5px] font-bold text-ink">{p.index}</div>
                    <div className="text-[10px] text-ink-mute leading-tight font-medium">{p.start}</div>
                  </div>
                ))}
              </div>

              {/* 每天一列 */}
              {WEEKDAY_CN.map((w, wi) => {
                const weekday = wi + 1
                const isToday = weekday === today
                return (
                  <div
                    key={w}
                    className={cn(
                      'flex-1 min-w-[96px] relative border-r-2 border-ink/[0.08] last:border-r-0',
                      isToday && 'bg-butter-100/50',
                    )}
                    style={{ height: maxPeriod * ROW_H }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      const rect = e.currentTarget.getBoundingClientRect()
                      const period = Math.max(
                        1,
                        Math.min(maxPeriod, Math.floor((e.clientY - rect.top) / ROW_H) + 1),
                      )
                      setDragOver({ weekday, period })
                    }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={(e) => {
                      e.preventDefault()
                      const rect = e.currentTarget.getBoundingClientRect()
                      const period = Math.max(
                        1,
                        Math.min(maxPeriod, Math.floor((e.clientY - rect.top) / ROW_H) + 1),
                      )
                      handleDrop(weekday, period)
                    }}
                  >
                    {/* 网格线 */}
                    {Array.from({ length: maxPeriod }, (_, i) => (
                      <div
                        key={i}
                        className="absolute inset-x-0 border-t-2 border-ink/[0.06]"
                        style={{ top: i * ROW_H }}
                      />
                    ))}

                    {/* 放置高亮 */}
                    {dragOver?.weekday === weekday && (
                      <div
                        className="absolute inset-x-1.5 border-2 border-dashed border-tangerine-500 bg-tangerine-100/60 rounded-2xl pointer-events-none z-[5]"
                        style={{ top: (dragOver.period - 1) * ROW_H + 3, height: ROW_H - 6 }}
                      />
                    )}

                    {/* 课程块:实心色块,视觉主角 */}
                    {visible
                      .filter((c) => c.weekday === weekday)
                      .map((c) => {
                        const periods = coursePeriods(c)
                        const startPeriod = periods[0]
                        const color = c.color ?? hashColor(c.name)
                        const fg = readableText(color)
                        const range = courseTimeRange(c, settings)
                        return (
                          <Popover
                            key={c.id}
                            trigger="hover"
                            mouseEnterDelay={0.45}
                            placement="right"
                            title={<span className="text-[12.5px] font-bold">{c.name}</span>}
                            content={
                              <div className="w-[172px] space-y-1 text-[11.5px]">
                                <div className="text-ink-soft">
                                  {WEEKDAY_CN[c.weekday - 1]} · 第 {startPeriod}
                                  {periods.length > 1 ? `-${startPeriod + periods.length - 1}` : ''} 节
                                  {range ? ` · ${range.label}` : ''}
                                </div>
                                {(c.teacher || c.location) && (
                                  <div className="text-ink-mute">
                                    {[c.teacher, c.location].filter(Boolean).join(' · ')}
                                  </div>
                                )}
                                <div className="text-ink-mute">
                                  第 {c.startWeek}-{c.endWeek} 周
                                </div>
                                <div className="flex items-center gap-1.5 pt-1.5">
                                  <Button size="sm" variant="secondary" onClick={() => openEdit(c)}>
                                    <Pencil size={12} /> 编辑
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => quickDelete(c)}>
                                    <Trash2 size={12} /> 删除
                                  </Button>
                                </div>
                                <div className="text-[10px] text-ink-mute/80 pt-1">拖动课块可以直接改时间</div>
                              </div>
                            }
                          >
                            <div
                              draggable
                            onDragStart={(e) => {
                              // Firefox / 部分 WebKit 必须写 dataTransfer,
                              // 否则这次拖拽会被直接取消(Chrome 恰好容忍)
                              e.dataTransfer.setData('text/plain', c.id)
                              e.dataTransfer.effectAllowed = 'move'
                              dragId.current = c.id
                            }}
                            onDragEnd={() => {
                              dragId.current = null
                              setDragOver(null)
                            }}
                            onClick={() => openEdit(c)}
                            className="absolute inset-x-1 rounded-2xl p-2 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-sticker-sm active:translate-y-0 overflow-hidden group"
                            style={{
                              top: (startPeriod - 1) * ROW_H + 3,
                              height: periods.length * ROW_H - 6,
                              background: color,
                              border: '1px solid rgba(255,255,255,.30)',
                              boxShadow: '0 1px 2px rgba(36,31,26,.05), 0 6px 16px -10px rgba(36,31,26,.20)',
                            }}
                          >
                            <div
                              className="text-[12.5px] font-bold leading-tight line-clamp-2"
                              style={{ color: fg }}
                            >
                              {c.name}
                            </div>
                            {/* 行 2:起止时间胶囊 + 官网图标(窄列也不挤) */}
                            <div className="mt-1 flex items-center gap-1">
                              {range && (
                                <div
                                  className="inline-flex items-center gap-0.5 px-1 py-[1px] rounded-full text-[9.5px] font-bold tabular-nums whitespace-nowrap shrink-0"
                                  style={{ background: `${fg}26`, color: fg }}
                                  title={`第${startPeriod}${periods.length > 1 ? `-${startPeriod + periods.length - 1}` : ''}节 ${range.label}`}
                                >
                                  <Clock size={8} strokeWidth={2.5} className="shrink-0" />
                                  {range.label}
                                </div>
                              )}
                              {c.website && (
                                <a
                                  href={c.website}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="ml-auto inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-[2px] rounded-full shrink-0"
                                  style={{ background: `${fg}22`, color: fg }}
                                  title={`打开「${c.name}」课程官网`}
                                >
                                  <Link2 size={10} />
                                  <span className="hidden sm:inline">官网</span>
                                </a>
                              )}
                            </div>
                            {/* 行 3:教室优先(一定不截断),老师放不下就省略 */}
                            {(c.location || c.teacher) && (
                              <div
                                className="text-[10px] font-medium mt-1 flex items-center gap-1 overflow-hidden"
                                style={{ color: fg }}
                              >
                                {c.location && (
                                  <span className="inline-flex items-center gap-0.5 shrink-0 font-semibold">
                                    <MapPin size={9} className="shrink-0" /> {c.location}
                                  </span>
                                )}
                                {c.location && c.teacher && (
                                  <span className="opacity-60 shrink-0 hidden sm:inline">·</span>
                                )}
                                {c.teacher && (
                                  <span className="inline-flex items-center gap-0.5 min-w-0 truncate opacity-70 hidden sm:inline-flex">
                                    <User size={9} className="shrink-0" /> {c.teacher}
                                  </span>
                                )}
                              </div>
                            )}
                            </div>
                          </Popover>
                        )
                      })}

                    {/* 行程块:斜纹纸片材质,叠在课程块之上(课程是主角,行程是配角) */}
                    {(eventsByDay.get(weekday) ?? []).map((p) => {
                      const o = p.occ
                      const ev = o.event
                      const meta = eventKindMeta(ev.kind)
                      const rowCount = o.slot.endPeriod - o.slot.startPeriod + 1
                      const narrow = p.lanes > 1
                      return (
                        <div
                          key={`${ev.id}-${o.date}`}
                          onClick={() => openEditEvent(ev)}
                          title={`${meta.label} · ${ev.title} ${ev.start}–${ev.end}`}
                          className="absolute rounded-2xl p-1.5 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-sticker-sm active:translate-y-0 overflow-hidden z-[6]"
                          style={{
                            top: (o.slot.startPeriod - 1) * ROW_H + 3,
                            height: rowCount * ROW_H - 6,
                            left: `calc(${(p.lane * 100) / p.lanes}% + 4px)`,
                            width: `calc(${100 / p.lanes}% - 8px)`,
                            ...eventBlockStyle(EVENT_COLOR),
                        boxShadow: '0 1px 2px rgba(36,31,26,.04), 0 6px 16px -10px rgba(36,31,26,.16)',
                          }}
                        >
                          <div
                            className={cn(
                              'font-bold leading-tight line-clamp-2 text-ink',
                              narrow ? 'text-[11px]' : 'text-[12.5px]',
                            )}
                            title={ev.title}
                          >
                            <span className="mr-1">{meta.icon}</span>
                            {ev.title}
                          </div>
                          <div
                            className={cn(
                              'mt-1 inline-flex items-center gap-0.5 rounded-full font-bold tabular-nums whitespace-nowrap shrink-0',
                              narrow ? 'text-[8.5px] px-1 py-[1px]' : 'text-[9.5px] px-1 py-[1px]',
                            )}
                            style={{ background: `${EVENT_COLOR}26`, color: EVENT_COLOR }}
                          >
                            {!narrow && <Clock size={8} strokeWidth={2.5} className="shrink-0" />}
                            {ev.start}–{ev.end}
                            {ev.weekly && <Repeat size={8} className="shrink-0" />}
                          </div>
                          {ev.location && !narrow && (
                            <div className="text-[10px] font-semibold mt-1 truncate flex items-center gap-0.5 text-ink-soft">
                              <MapPin size={9} className="shrink-0" /> {ev.location}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </Card>

      {/* ============ 本周行程(次要,但要看得见) ============ */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Flag size={16} className="text-ink-mute" />
          <h2 className="text-[15px] font-bold text-ink">本周行程</h2>
          <span className="text-xs text-ink-mute font-medium">{occurrences.length} 项</span>
          <Button size="sm" variant="secondary" onClick={openNewEvent} className="ml-auto">
            <Plus size={13} /> 加行程
          </Button>
        </div>
        {occurrences.length === 0 ? (
          <Card>
            <AntEmpty
              image={AntEmpty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span className="text-[12.5px] text-ink-mute">
                  本周没有行程 —— 学生会会议、老师开会、党会、讲座都可以记在这里,会自动同步到备忘
                </span>
              }
            >
              <Button variant="secondary" size="sm" onClick={openNewEvent}>
                <Plus size={13} /> 添加第一项行程
              </Button>
            </AntEmpty>
            <div className="mt-3 flex items-start gap-2 rounded-xl bg-butter-50 border-2 border-ink/[0.07] px-3 py-2.5">
              <Zap size={13} className="text-tangerine-500 shrink-0 mt-0.5" />
              <p className="text-[11.5px] text-ink-soft leading-relaxed">
                微信里收到「周三下午3点开党会」这类消息?复制整句话,粘进
                <span className="font-semibold text-ink">「添加行程」</span>
                顶部的速记框,点「识别」就自动填好日期、时间、地点和类型。
              </p>
            </div>
          </Card>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {occurrences.map((o) => {
              const ev = o.event
              const meta = eventKindMeta(ev.kind)
              return (
                <button
                  key={`${ev.id}-${o.date}`}
                  onClick={() => openEditEvent(ev)}
                  className="text-left rounded-2xl p-3 flex gap-3 items-start transition-all hover:-translate-y-0.5 hover:shadow-sticker-sm"
                  style={{
                    backgroundColor: 'rgba(255, 253, 245, 0.94)',
                    backgroundImage: `repeating-linear-gradient(45deg, ${EVENT_COLOR}33 0 2px, transparent 2px 9px)`,
                    border: `2px dashed ${EVENT_COLOR}`,
                  }}
                >
                  <div
                    className="w-11 shrink-0 rounded-xl grid place-items-center text-[11px] font-bold py-1.5"
                    style={{ background: `${EVENT_COLOR}1f`, color: EVENT_COLOR, border: `1.5px solid ${EVENT_COLOR}45` }}
                  >
                    {shortDate(o.date)}
                    <span className="text-[10px] font-bold">周{weekdayLabel(o.weekday)}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-bold text-ink truncate">
                      <span className="mr-1">{meta.icon}</span>
                      {ev.title}
                      {ev.weekly && <Repeat size={11} className="inline ml-1 text-ink-mute align-middle" />}
                    </div>
                    <div className="text-[11.5px] font-semibold text-ink-soft mt-0.5 tabular-nums">
                      {ev.start} – {ev.end}
                      {ev.location && <span className="text-ink-mute"> · {ev.location}</span>}
                    </div>
                    {ev.detail && (
                      <div className="text-[11.5px] text-ink-mute mt-1 line-clamp-2 leading-relaxed">{ev.detail}</div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ============ 本学期课程(次要) ============ */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <CalendarRange size={16} className="text-ink-mute" />
          <h2 className="text-[15px] font-bold text-ink">本学期课程</h2>
          <span className="text-xs text-ink-mute font-medium">{courses.length} 门</span>
        </div>
        {courses.length === 0 ? (
          <Card>
              <AntEmpty
                image={AntEmpty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span className="text-[12.5px] text-ink-mute">
                    还没有课程 —— 点「加课」手动添加,或到「导入」页上传教务系统导出的 Excel / PDF
                  </span>
                }
              >
                <Button variant="primary" size="sm" onClick={openNew}>
                  添加第一门课
                </Button>
              </AntEmpty>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="divide-y-2 divide-ink/[0.06]">
              {courses
                .slice()
                .sort((a, b) => a.weekday - b.weekday || a.period - b.period)
                .map((c) => {
                  const color = c.color ?? hashColor(c.name)
                  const fg = readableText(color)
                  const weeks = c.singleWeeks?.length
                    ? `第 ${c.singleWeeks[0]}${c.singleWeeks.length > 1 ? `-${c.singleWeeks[c.singleWeeks.length - 1]}` : ''} 周(${c.singleWeeks.length} 周)`
                    : `第 ${c.startWeek}-${c.endWeek} 周`
                  const range = courseTimeRange(c, settings)
                  return (
                    <button
                      key={c.id}
                      onClick={() => openEdit(c)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-butter-50 transition-colors"
                    >
                      <div
                        className="w-9 h-9 rounded-xl grid place-items-center shrink-0 text-[12px] font-bold"
                        style={{ background: color, color: fg }}
                      >
                        {c.period}
                      </div>
                      <div className="w-[52px] shrink-0 text-[11.5px] font-bold text-ink-soft">
                        星期{WEEKDAY_CN[c.weekday - 1]}
                        <div className="text-[10px] font-medium text-ink-mute">
                          {c.periods > 1 ? `${c.period}-${c.period + c.periods - 1} 节` : '单节'}
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-ink truncate">{c.name}</div>
                        <div className="text-[11px] text-ink-mute truncate font-medium">
                          {[c.teacher, c.location, weeks].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      {range && (
                        <span className="shrink-0 text-[11.5px] font-bold text-ink-soft tabular-nums bg-butter-100 px-2 py-1 rounded-full">
                          {range.label}
                        </span>
                      )}
                      {c.website && (
                        <a
                          href={c.website}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="shrink-0 p-2 text-ink-mute hover:text-tangerine-600 transition-colors"
                          title="打开课程官网"
                        >
                          <ExternalLink size={15} />
                        </a>
                      )}
                    </button>
                  )
                })}
            </div>
          </Card>
        )}
      </div>

      <CourseDialog
        open={dialogOpen}
        course={editing}
        allCourses={courses}
        settings={settings}
        onClose={() => setDialogOpen(false)}
        onSave={async (c) => {
          await upsertCourse(c)
          onToast('课程已保存', 'success')
        }}
        onDelete={async (id) => {
          await deleteCourse(id)
          onToast('课程已删除', 'success')
        }}
      />

      <EventDialog
        open={eventDialogOpen}
        event={editingEvent}
        settings={settings}
        onClose={() => setEventDialogOpen(false)}
        onSave={async (ev) => {
          await upsertEvent(ev)
          onToast('行程已保存,并同步到备忘', 'success')
        }}
        onDelete={async (id) => {
          await deleteEvent(id)
          onToast('行程已删除', 'success')
        }}
      />
    </div>
  )
}