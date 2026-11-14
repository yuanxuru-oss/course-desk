import { useEffect, useMemo, useState } from 'react'
import {
  MapPin,
  User,
  ChevronRight,
  CheckCircle2,
  Circle,
  Plus,
  Zap,
  BookOpen,
  Sparkles,
  Star,
  Clock,
  Flag,
} from 'lucide-react'
import type { Course, CourseEvent, Homework, Settings } from '../types'
import {
  currentSession,
  nextSession,
  todaySessions,
  WEEKDAY_CN,
  countdown,
  dateToWeek,
  formatHHMM,
} from '../lib/time'
import { Button, Badge, Empty, Segmented, Card, SoftCard, Star as StarIcon } from './ui'
import { toggleHomework } from '../lib/actions'
import { cn, hashColor, readableText } from '../lib/utils'
import { EVENT_COLOR, eventKindMeta, eventsOnDate } from '../lib/event'

interface Props {
  courses: Course[]
  events: CourseEvent[]
  homework: Homework[]
  settings: Settings
  onNavigate: (r: 'today' | 'schedule' | 'homework' | 'notes' | 'ai' | 'import' | 'settings') => void
  onToast: (text: string, type?: 'info' | 'success' | 'error') => void
}

export function TodayView({ courses, events, homework, settings, onNavigate, onToast }: Props) {
  /*
   * 「正在上课 / 还剩 N 分钟」必须随时间走。
   * 原来每次渲染都 new Date(),但没有任何东西触发重新渲染,
   * 停在今日页时文案会一直冻结在打开页面的那一刻。
   */
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])
  const [filter, setFilter] = useState<'todo' | 'done'>('todo')

  const current = useMemo(() => currentSession(courses, settings, now), [courses, settings, now])
  const next = useMemo(() => nextSession(courses, settings, now), [courses, settings, now])
  const today = useMemo(() => todaySessions(courses, settings, now), [courses, settings, now])
  const todayEvents = useMemo(() => {
    const p = (n: number) => String(n).padStart(2, '0')
    const d = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
    return eventsOnDate(events, d, settings)
  }, [events, settings, now])

  const todayHomework = useMemo(() => {
    const endOfToday = new Date(now)
    endOfToday.setHours(23, 59, 59, 999)
    return homework
      .filter((h) => !h.done && h.dueAt && h.dueAt <= endOfToday.getTime())
      .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
  }, [homework, now])

  const overdue = useMemo(() => {
    const startOfToday = new Date(now)
    startOfToday.setHours(0, 0, 0, 0)
    return homework.filter((h) => !h.done && h.dueAt && h.dueAt < startOfToday.getTime())
  }, [homework, now])

  const courseName = (id?: string) => courses.find((c) => c.id === id)?.name
  const hour = now.getHours()
  const greeting = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'

  const hero = current ?? next
  const heroColor = hero ? hero.course.color ?? hashColor(hero.course.name) : '#E5763A'
  const heroFg = readableText(heroColor)

  return (
    <div className="space-y-5">
      {/* 问候 */}
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-tight text-ink leading-none">{greeting}</h1>
          <p className="text-[13px] text-ink-soft font-medium mt-2">
            {now.getMonth() + 1} 月 {now.getDate()} 日 · 星期{WEEKDAY_CN[(now.getDay() === 0 ? 7 : now.getDay()) - 1]} · 第{' '}
            {Math.max(1, dateToWeek(now, settings.semesterStart))} 教学周
          </p>
        </div>
        <div className="hidden sm:flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => onNavigate('import')}>
            <Zap size={14} /> 导入课表
          </Button>
          <Button size="sm" variant="primary" onClick={() => onNavigate('notes')}>
            <Plus size={14} /> 记一笔
          </Button>
        </div>
      </header>

      {/* 当前 / 下一节课 */}
      {hero ? (
        <section
          className="relative overflow-hidden rounded-[32px] p-5 sm:p-6 shadow-sticker-lg"
          style={{ background: heroColor, border: `2px solid ${heroColor}` }}
        >
          <StarIcon size={26} color="#F8DF7C" className="absolute top-5 right-16 animate-twinkle" />
          <div className="absolute -right-10 -bottom-14 w-40 h-40 rounded-full bg-white/[0.12]" />

          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="text-[11px] font-extrabold px-2.5 py-1 rounded-full"
                  style={{ background: `${heroFg}1f`, color: heroFg }}
                >
                  {current ? '正在上课' : '下一节课'}
                </span>
                <span className="text-[11.5px] font-semibold" style={{ color: `${heroFg}cc` }}>
                  {hero.date.getMonth() + 1}/{hero.date.getDate()} 星期{WEEKDAY_CN[hero.course.weekday - 1]} · 第{hero.period}
                  {hero.periods > 1 ? `-${hero.period + hero.periods - 1}` : ''}节
                </span>
              </div>
              <h2 className="text-[24px] sm:text-[28px] font-extrabold tracking-tight truncate" style={{ color: heroFg }}>
                {hero.course.name}
              </h2>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5 text-[13px] font-medium" style={{ color: `${heroFg}d0` }}>
                {hero.course.teacher && (
                  <span className="inline-flex items-center gap-1.5">
                    <User size={13} /> {hero.course.teacher}
                  </span>
                )}
                {hero.course.location && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin size={13} /> {hero.course.location}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 font-bold">
                  <Clock size={13} /> {formatHHMM(hero.start)} – {formatHHMM(hero.end)}
                </span>
              </div>
              {!current && (
                <div className="mt-3 inline-block text-[12.5px] font-extrabold px-3 py-1 rounded-full" style={{ background: `${heroFg}1f`, color: heroFg }}>
                  {countdown(hero.start.getTime(), now.getTime())}后开始
                </div>
              )}
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="shrink-0 !bg-white/90 !text-ink !border-transparent"
              onClick={() => onNavigate('schedule')}
            >
              课表 <ChevronRight size={14} />
            </Button>
          </div>
        </section>
      ) : (
        <Card className="p-5">
          <Empty
            icon={<BookOpen size={30} className="text-tangerine-300" />}
            title="今天没有课"
            description="还没有导入课表。去「导入」页上传教务系统导出的 Excel,或者手动加一门课。"
            action={
              <Button variant="primary" size="sm" onClick={() => onNavigate('import')}>
                去导入课表
              </Button>
            }
          />
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* 今日课程 */}
        <SoftCard className="overflow-hidden bg-white">
          <div className="px-4 py-3 border-b-2 border-ink/[0.08] flex items-center justify-between">
            <h3 className="font-extrabold text-ink text-[15px]">今日课程</h3>
            <span className="text-[11px] font-bold text-ink-mute bg-butter-100 px-2 py-0.5 rounded-full">
              {today.length} 节
            </span>
          </div>
          {today.length === 0 ? (
            <Empty title="今天没有排课" description="享受一个没有课的下午吧" />
          ) : (
            <div className="divide-y-2 divide-ink/[0.06]">
              {today.map((s) => {
                const isNow = now >= s.start && now <= s.end
                const isPast = now > s.end
                const color = s.course.color ?? hashColor(s.course.name)
                return (
                  <div key={`${s.course.id}-${s.period}`} className="flex items-center gap-3 px-4 py-3">
                    <div className="w-[62px] shrink-0 text-center">
                      <div className={cn('text-[12.5px] font-extrabold tabular-nums', isNow ? 'text-tangerine-600' : 'text-ink')}>
                        {formatHHMM(s.start)}
                      </div>
                      <div className="text-[10.5px] text-ink-mute font-semibold tabular-nums">– {formatHHMM(s.end)}</div>
                      <div className="text-[10px] text-ink-mute font-medium mt-0.5">第{s.period}节</div>
                    </div>
                    <div
                      className="w-2 h-9 rounded-full shrink-0"
                      style={{ background: color, opacity: isPast ? 0.3 : 1 }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className={cn('text-sm font-bold truncate', isPast ? 'text-ink-mute' : 'text-ink')}>
                        {s.course.name}
                      </div>
                      <div className="text-[11px] text-ink-mute font-medium truncate">
                        {[s.course.location, s.course.teacher].filter(Boolean).join(' · ') || '暂无教室信息'}
                      </div>
                    </div>
                    {isNow && <Badge color="#4FA35E">进行中</Badge>}
                  </div>
                )
              })}
            </div>
          )}
        </SoftCard>

        {/* 作业 */}
        <SoftCard className="overflow-hidden bg-white">
          <div className="px-4 py-3 border-b-2 border-ink/[0.08] flex items-center justify-between gap-2">
            <h3 className="font-extrabold text-ink text-[15px]">待交作业</h3>
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'todo', label: `待办 ${todayHomework.length + overdue.length}` },
                { value: 'done', label: '已完成' },
              ]}
            />
          </div>

          {filter === 'todo' ? (
            (todayHomework.length + overdue.length) === 0 ? (
              <Empty title="今天没有待交作业" description="作业都搞定了,轻松一下" />
            ) : (
              <div className="divide-y-2 divide-ink/[0.06]">
                {overdue.map((h) => (
                  <HomeworkRow key={h.id} hw={h} courseName={courseName(h.courseId)} overdue onToast={onToast} />
                ))}
                {todayHomework.map((h) => (
                  <HomeworkRow key={h.id} hw={h} courseName={courseName(h.courseId)} onToast={onToast} />
                ))}
              </div>
            )
          ) : (
            <div className="divide-y-2 divide-ink/[0.06]">
              {homework.filter((h) => h.done).length === 0 ? (
                <Empty title="还没有完成的作业" />
              ) : (
                homework
                  .filter((h) => h.done)
                  .slice(0, 20)
                  .map((h) => (
                    <HomeworkRow key={h.id} hw={h} courseName={courseName(h.courseId)} onToast={onToast} />
                  ))
              )}
            </div>
          )}
        </SoftCard>
      </div>

      {/* 今日行程 —— 课程之外的安排,斜纹纸片材质 */}
      {todayEvents.length > 0 && (
        <SoftCard className="overflow-hidden bg-white">
          <div className="px-4 py-3 border-b-2 border-ink/[0.08] flex items-center justify-between">
            <h3 className="font-extrabold text-ink text-[15px] inline-flex items-center gap-1.5">
              <Flag size={14} style={{ color: EVENT_COLOR }} /> 今日行程
            </h3>
            <span
              className="text-[11px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: `${EVENT_COLOR}1f`, color: EVENT_COLOR }}
            >
              {todayEvents.length} 项
            </span>
          </div>
          <div className="divide-y-2 divide-ink/[0.06]">
            {todayEvents.map((o) => {
              const meta = eventKindMeta(o.event.kind)
              return (
                <div key={`${o.event.id}-${o.date}`} className="px-4 py-3 flex items-center gap-3">
                  <div className="w-[62px] shrink-0 text-center">
                    <div className="text-[12.5px] font-extrabold tabular-nums text-ink">{o.event.start}</div>
                    <div className="text-[10.5px] text-ink-mute font-semibold tabular-nums">– {o.event.end}</div>
                  </div>
                  <div
                    className="w-2 h-9 rounded-full shrink-0"
                    style={{ backgroundImage: `repeating-linear-gradient(45deg, ${EVENT_COLOR} 0 2px, transparent 2px 5px)` }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold truncate text-ink">
                      <span className="mr-1">{meta.icon}</span>
                      {o.event.title}
                    </div>
                    <div className="text-[11px] text-ink-mute font-medium truncate">
                      {[o.event.location, meta.label].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </SoftCard>
      )}

      {/* 快捷入口 —— 明确是配角 */}
      <div>
        <div className="text-[11px] font-bold tracking-[0.14em] text-ink-mute uppercase mb-2.5">学习伙伴</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: '一句话加课', icon: <Zap size={16} />, desc: '自然语言录入', go: 'import' as const, tint: '#E5763A' },
            { label: '添加作业', icon: <CheckCircle2 size={16} />, desc: '每周固定也能设', go: 'homework' as const, tint: '#4FA35E' },
            { label: '写备忘录', icon: <Star size={16} />, desc: '文字 + 图片', go: 'notes' as const, tint: '#7B92DC' },
            { label: '问 AI', icon: <Sparkles size={16} />, desc: '用自己的资料', go: 'ai' as const, tint: '#A97C5B' },
          ].map((q) => (
            <button
              key={q.label}
              onClick={() => onNavigate(q.go)}
              className="bg-white rounded-[22px] border-2 border-ink/[0.08] p-4 text-left hover:-translate-y-0.5 hover:shadow-sticker-sm transition-all group"
            >
              <div
                className="w-9 h-9 rounded-xl grid place-items-center mb-2.5 transition-transform group-hover:scale-110"
                style={{ background: `${q.tint}1f`, color: q.tint }}
              >
                {q.icon}
              </div>
              <div className="text-[13.5px] font-bold text-ink">{q.label}</div>
              <div className="text-[11px] text-ink-mute font-medium mt-0.5">{q.desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function HomeworkRow({
  hw,
  courseName,
  overdue,
  onToast,
}: {
  hw: Homework
  courseName?: string
  overdue?: boolean
  onToast: (t: string, type?: 'info' | 'success' | 'error') => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <button
        onClick={async () => {
          setBusy(true)
          await toggleHomework(hw.id)
          setBusy(false)
          onToast(hw.done ? '已恢复为待办' : '已标记完成 👍', 'success')
        }}
        disabled={busy}
        className="shrink-0 text-ink-mute/40 hover:text-grass-500 transition-colors"
        aria-label={hw.done ? '标记为未完成' : '标记为已完成'}
      >
        {hw.done ? <CheckCircle2 size={20} className="text-grass-500" /> : <Circle size={20} />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={cn('text-sm font-semibold truncate', hw.done ? 'text-ink-mute line-through' : 'text-ink')}>
          {hw.title}
        </div>
        <div className="text-[11px] text-ink-mute font-medium truncate">
          {courseName && <span>{courseName} · </span>}
          {hw.dueAt && (
            <span className={cn(overdue && 'text-cherry-500 font-bold')}>
              {overdue ? '已逾期 · ' : ''}
              {new Date(hw.dueAt).getMonth() + 1}/{new Date(hw.dueAt).getDate()} 截止
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
