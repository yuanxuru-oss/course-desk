import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  CalendarDays,
  ClipboardList,
  NotebookPen,
  Sparkles,
  Upload,
  Settings as SettingsIcon,
  Sun,
  LayoutGrid,
  MoreHorizontal,
  Star,
} from 'lucide-react'
import { db } from './db'
import { useApp } from './store'
import { ToastHost, Star as StarIcon } from './components/ui'
import { TodayView } from './components/TodayView'
import { ScheduleView } from './components/ScheduleView'
import { HomeworkView } from './components/HomeworkView'
import { NotesView } from './components/NotesView'
import { AiView } from './components/AiView'
import { ImportView } from './components/ImportView'
import { SettingsView } from './components/SettingsView'
import { MoreView } from './components/MoreView'

import { QuickCapture } from './components/QuickCapture'
import { PetGuide } from './components/PetGuide'
import { PetWindow } from './components/PetWindow'
import { runTick, materializeTemplates } from './lib/reminderEngine'
import { cleanupDuplicateCourses } from './lib/actions'
import { currentWeek, semesterRange } from './lib/time'
import { initPwa, initSwSelfHeal } from './lib/pwa'
import { EditableBrand, EditableAvatar } from './components/EditableBrand'

type Route =
  | 'today'
  | 'schedule'
  | 'homework'
  | 'notes'
  | 'ai'
  | 'import'
  | 'settings'
  | 'more'
  | 'pet'

interface NavItem {
  key: Route
  label: string
  icon: typeof Sun
  desc: string
}

/** 一级:课程表本体 —— 主角 */
const PRIMARY: NavItem[] = [
  { key: 'schedule', label: '课表', icon: LayoutGrid, desc: '完整周课表' },
  { key: 'today', label: '今日', icon: Sun, desc: '今天要上的课' },
]

/** 二级:围绕课表的日常伙伴 —— 配角 */
const SECONDARY: NavItem[] = [
  { key: 'homework', label: '作业', icon: ClipboardList, desc: '每周课堂作业' },
  { key: 'notes', label: '备忘', icon: NotebookPen, desc: '文字与图片笔记' },
  { key: 'ai', label: 'AI', icon: Sparkles, desc: '知识库问答' },
]

/** 工具 */
const TOOLS: NavItem[] = [
  { key: 'import', label: '导入', icon: Upload, desc: '导入教务课表' },
  { key: 'settings', label: '设置', icon: SettingsIcon, desc: '提醒与数据' },
]

const ALL = [...PRIMARY, ...SECONDARY, ...TOOLS]

/**
 * lucide 各图标在 24×24 栅格里的图形左边界并不一致(实测 31.5~33px),
 * 摆成一列时边缘会有 1.5px 的毛边。这里按实测值把墨迹统一到同一条线。
 */
const NAV_ICON_NUDGE: Record<string, number> = {
  schedule: -0.75,
  homework: -1.5,
  import: -0.75,
  settings: -0.75,
}

function readRoute(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0]
  const found = ALL.find((n) => n.key === raw)
  if (found) return found.key
  if (raw === 'more') return 'more'
  // 桌面外壳里只需要一只兔子:整页透明,由 Electron 窗口决定外形
  if (raw === 'pet') return 'pet'
  return 'schedule' // 主角默认落地
}

export function App() {
  const { settings, ready, init, toasts, dismissToast, toast } = useApp()
  const [route, setRoute] = useState<Route>(readRoute)
  /** 桌宠:住在页面里的悬浮小兔,开/关记在本地 */
  /** 桌宠只保留桌面版(Electron 外壳):网页里不再画兔子 */
  const [petGuideOpen, setPetGuideOpen] = useState(false)



  useEffect(() => {
    init()
    initPwa()
    initSwSelfHeal()
  }, [init])

  useEffect(() => {
    const onHash = () => setRoute(readRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const navigate = useCallback((r: Route) => {
    window.location.hash = `#/${r}`
    setRoute(r)
  }, [])

  /* ---- 启动时清理历史重复课程 ---- */
  /*
   * 早期版本每门课是随机 id,同一份课表导入两次就会并存两条一模一样的数据。
   * 这里在启动时按「内容签名」合并一次:只保留最早那条,
   * 挂在上面的作业/模板/备忘改到保留的那条,不会丢关联。
   * 只在启动跑一次,平时新增走 importCourses 的判重,不会重复触发。
   */
  const dedupeRan = useRef(false)
  useEffect(() => {
    if (!ready || dedupeRan.current) return
    dedupeRan.current = true
    cleanupDuplicateCourses()
      .then((n) => {
        if (n > 0) toast(`已整理 ${n} 门重复或分段课程`, 'info')
      })
      .catch((err) => console.warn('[dedupe]', err))
  }, [ready, toast])

  /* ---- 数据 ---- */
  const courses = useLiveQuery(() => db.courses.toArray(), [], []) ?? []
  const events = useLiveQuery(() => db.events.toArray(), [], []) ?? []
  const homework = useLiveQuery(() => db.homework.toArray(), [], []) ?? []
  const templates = useLiveQuery(() => db.templates.toArray(), [], []) ?? []

  /* ---- 每周作业模板自动滚动 ---- */
  const matLock = useRef(false)
  useEffect(() => {
    if (!ready || !templates.length) return
    if (matLock.current) return
    matLock.current = true
    ;(async () => {
      try {
        const existing = await db.homework.toArray()
        const created = materializeTemplates(templates, existing, settings)
        if (created.length) await db.homework.bulkPut(created)
      } catch (err) {
        console.warn('[template]', err)
      } finally {
        matLock.current = false
      }
    })()
  }, [ready, templates, settings])

  /* ---- 提醒调度循环 ---- */
  useEffect(() => {
    if (!ready) return
    const tick = async () => {
      try {
        await runTick(courses, homework, templates, settings, new Date(), 7, events)
      } catch (err) {
        console.warn('[tick]', err)
      }
    }
    tick()
    const timer = setInterval(tick, 30_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [ready, courses, homework, templates, settings, events])

  const week = useMemo(() => currentWeek(settings), [settings])
  const current = ALL.find((n) => n.key === route)
  const isPrimary = PRIMARY.some((n) => n.key === route)

  if (!ready) {
    return (
      <div className="min-h-full flex items-center justify-center text-ink-mute text-sm">
        正在启动课程桌…
      </div>
    )
  }

  /* 桌面外壳里的纯桌宠页:整页透明,只画一只兔子 */
  if (route === 'pet') {
    return <PetWindow courses={courses} homework={homework} settings={settings} />
  }

  return (
    <div className="app-shell">
      {/* 侧边导航(桌面) */}
      <aside className="sidebar px-4 pt-4 pb-4 lg:pt-8 sticky top-0 h-screen overflow-y-auto">
        {/* Logo —— 顶部与右侧主内容的第一块(橙色横幅)严格齐平 */}
        <EditableBrand />

        {/* 一级导航:课表 / 今日 */}
        <nav className="flex flex-col gap-1.5">
          {PRIMARY.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.key}
                onClick={() => navigate(item.key)}
                className={`nav-primary ${route === item.key ? 'active' : ''}`}
              >
                <span className="nav-icon">
                  <Icon size={18} style={{ transform: `translateX(${NAV_ICON_NUDGE[item.key] ?? 0}px)` }} />
                </span>
                {item.label}
                {item.key === 'schedule' && (
                  <StarIcon size={12} color={route === item.key ? '#F8DF7C' : '#F4CE4E'} className="ml-auto" />
                )}
              </button>
            )
          })}
        </nav>

        {/* 二级导航:学习伙伴 */}
        <div className="nav-group-label">学习伙伴</div>
        <nav className="flex flex-col gap-0.5">
          {SECONDARY.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.key}
                onClick={() => navigate(item.key)}
                className={`nav-item ${route === item.key ? 'active' : ''}`}
              >
                <span className="nav-icon">
                  <Icon size={18} style={{ transform: `translateX(${NAV_ICON_NUDGE[item.key] ?? 0}px)` }} />
                </span>
                {item.label}
              </button>
            )
          })}
        </nav>

        {/* 工具 */}
        <div className="nav-group-label">工具</div>
        <nav className="flex flex-col gap-0.5">
          {TOOLS.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.key}
                onClick={() => navigate(item.key)}
                className={`nav-item ${route === item.key ? 'active' : ''}`}
              >
                <span className="nav-icon">
                  <Icon size={18} style={{ transform: `translateX(${NAV_ICON_NUDGE[item.key] ?? 0}px)` }} />
                </span>
                {item.label}
              </button>
            )
          })}
        </nav>

        <div className="mt-5 pt-4 border-t-2 border-[#241f1a]/10">
          <button
            onClick={() => setPetGuideOpen(true)}
            title="桌宠是一个独立的桌面小窗,浏览器关掉也在"
            className="w-full flex items-center gap-3 pl-3.5 pr-3 h-9 rounded-xl text-[13px] font-semibold text-ink-soft hover:bg-white/70 transition-colors"
          >
            <span className="nav-icon">
              <StarIcon size={18} color="#F4CE4E" className="-translate-x-[0.25px]" />
            </span>
            桌宠
            <span className="ml-auto text-[10.5px] font-bold text-ink-mute">
              桌面版
            </span>
          </button>
        </div>
      </aside>

      {/* 主区域 */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="lg:hidden sticky top-0 z-30 bg-[#fdf6e4]/95 backdrop-blur border-b-2 border-[#241f1a]/[0.08] px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <EditableAvatar size="sm" />
            <div>
              <div className="font-bold text-ink text-sm leading-tight">{current?.label ?? '课程桌'}</div>
              <div className="text-[10px] text-ink-mute font-medium">第 {week} 周</div>
            </div>
          </div>
          <div className="text-[11px] text-ink-mute font-medium">{settings.schoolName || semesterRange(settings)}</div>
        </header>

        <main className="flex-1 min-w-0 pb-28 lg:pb-10">
          <div className={`mx-auto px-4 lg:px-8 py-5 lg:py-8 ${isPrimary ? 'max-w-6xl' : 'max-w-4xl'}`}>
            {route === 'today' && (
              <TodayView
                courses={courses}
                events={events}
                homework={homework}
                settings={settings}
                onNavigate={navigate}
                onToast={toast}
              />
            )}
            {route === 'schedule' && (
              <ScheduleView
                courses={courses}
                events={events}
                homework={homework}
                settings={settings}
                onToast={toast}
              />
            )}
            {route === 'homework' && (
              <HomeworkView
                courses={courses}
                homework={homework}
                templates={templates}
                settings={settings}
                onToast={toast}
              />
            )}
            {route === 'notes' && <NotesView courses={courses} settings={settings} onToast={toast} />}
            {route === 'ai' && <AiView courses={courses} settings={settings} onToast={toast} />}
            {route === 'import' && (
              <ImportView settings={settings} onToast={toast} onDone={() => navigate('schedule')} />
            )}
            {route === 'settings' && <SettingsView settings={settings} onToast={toast} />}
            {route === 'more' && <MoreView settings={settings} onNavigate={navigate} onToast={toast} />}
          </div>
        </main>
      </div>

      {/* 底部导航(移动)—— 课表做成实心主角块 */}
      <nav className="bottom-nav">
        <div className="flex items-stretch gap-1 px-2 py-1.5">
          <button
            onClick={() => navigate('schedule')}
            className="primary flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-2xl bg-tangerine-500 text-white shadow-sticker-sm active:translate-y-[1px] active:shadow-none transition-all"
          >
            <LayoutGrid size={19} />
            <span className="text-[10px] font-bold">课表</span>
          </button>
          {ALL.filter((n) => n.key !== 'schedule')
            .slice(0, 4)
            .map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.key}
                  onClick={() => navigate(item.key)}
                  className={`bottom-nav-item flex-1 ${route === item.key ? 'active' : ''}`}
                >
                  <Icon size={18} />
                  {item.label}
                </button>
              )
            })}
          <button
            onClick={() => navigate('more')}
            className={`bottom-nav-item flex-1 ${route === 'more' ? 'active' : ''}`}
          >
            <MoreHorizontal size={18} />
            更多
          </button>
        </div>
      </nav>

      <ToastHost items={toasts} onDismiss={dismissToast} />

      <PetGuide open={petGuideOpen} onClose={() => setPetGuideOpen(false)} onToast={toast} />


      {/* 全局速记:在哪儿按 Ctrl+V 都能自动识别成行程 */}
      <QuickCapture settings={settings} onToast={toast} />
    </div>
  )
}
