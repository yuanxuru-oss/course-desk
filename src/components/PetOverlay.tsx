import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { X, MapPin, Clock } from 'lucide-react'
import type { Course, Homework, Settings } from '../types'
import {
  currentSession,
  nextSession,
  todaySessions,
  currentWeek,
  WEEKDAY_CN,
  formatHHMM,
} from '../lib/time'
import { cn, hashColor } from '../lib/utils'
import { Bunny } from './PetBunny'
import { usePetState } from './usePetState'

/** 3D 兔子单独打包,只有桌宠出现时才下载 */
const Pet3D = lazy(() => import('./Pet3D'))

interface Props {
  courses: Course[]
  homework: Homework[]
  settings: Settings
  visible: boolean
  onClose: () => void
}

const PET_W = 116
const PET_H = 142
const SPEED = 46 // 走路速度 px/s
const GRAVITY = 1900
const BOUNCE = 0.42

function shortSpan(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000))
  if (mins < 60) return `${mins} 分钟`
  const hours = Math.floor(mins / 60)
  const rest = mins % 60
  if (hours < 24) return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`
  return `${Math.floor(hours / 24)} 天`
}

function dueText(dueAt: number, now: number): string {
  const d = new Date(dueAt)
  const hh = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const diff = dueAt - now
  if (diff < 0) return '已过期'
  if (new Date(now).toDateString() === d.toDateString()) return `今天 ${hh}`
  if (new Date(now + 86_400_000).toDateString() === d.toDateString()) return `明天 ${hh}`
  if (diff < 7 * 86_400_000) return `${Math.ceil(diff / 86_400_000)} 天后`
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/**
 * 页面内的桌宠(不弹新窗口)。
 *
 * 底层是「状态机 + 物理循环」,和 vscode-pets / agent-pet-hub / dsh-desktop-pet 一个套路:
 *   - 状态:idle / walk / drag / fall / sleep,各自有最短保持时间,防止抖
 *   - 自己会走两步、发呆、睡着(参考它们的 wander / sleep interval)
 *   - 能拖走、能甩出去:松手给初速度,落到"地面"会弹一下
 *   - 跟应用事件联动:上新作业、开始上课 → 蹦一下并说话
 *   - 位置记在 localStorage,下次还在原地
 */
export function PetOverlay({ courses, homework, settings, visible, onClose }: Props) {
  const [now, setNow] = useState(new Date())
  const [open, setOpen] = useState(false)
  const [override, setOverride] = useState<{ text: string; hint?: string; until: number } | null>(null)
  const [facing, setFacing] = useState<1 | -1>(1)
  /** 3D 要等首屏稳定后再拉:先出 2D 小兔,空闲时再换成 3D(不拖慢打开速度) */
  const [use3d] = useState(() => localStorage.getItem('coursedesk:pet3d') !== '0')
  const [ready3d, setReady3d] = useState(false)

  useEffect(() => {
    if (!visible || !use3d) return
    const idle = (window as any).requestIdleCallback as typeof requestIdleCallback | undefined
    const t = idle
      ? idle(() => setReady3d(true), { timeout: 2500 })
      : window.setTimeout(() => setReady3d(true), 900)
    return () => {
      if (idle) (window as any).cancelIdleCallback?.(t as number)
      else window.clearTimeout(t as number)
    }
  }, [visible, use3d])

  const { state, stateRef, go, touch } = usePetState(visible)

  const wrapRef = useRef<HTMLDivElement>(null)
  const pos = useRef({ x: 0, y: 0, vx: 0, vy: 0, inited: false })
  const targetX = useRef(0)
  const pointer = useRef({ active: false, moved: 0, ox: 0, oy: 0, lastX: 0, lastT: 0 })

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20_000)
    return () => clearInterval(t)
  }, [])

  /* ---------------- 数据 ---------------- */
  const current = useMemo(() => currentSession(courses, settings, now), [courses, settings, now])
  const next = useMemo(() => nextSession(courses, settings, now), [courses, settings, now])
  const today = useMemo(() => todaySessions(courses, settings, now), [courses, settings, now])
  const week = currentWeek(settings, now)
  const pending = useMemo(
    () => homework.filter((h) => !h.done && h.dueAt).sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0)).slice(0, 3),
    [homework],
  )

  const line = useMemo(() => {
    if (override && Date.now() < override.until) return override
    if (current)
      return {
        text: `正在上《${current.course.name}》,还剩 ${shortSpan(current.end.getTime() - now.getTime())}`,
        hint: current.course.location,
      }
    if (next) {
      const wd = WEEKDAY_CN[(next.start.getDay() === 0 ? 7 : next.start.getDay()) - 1]
      const sameDay = next.start.toDateString() === now.toDateString()
      return {
        text: `还有 ${shortSpan(next.start.getTime() - now.getTime())} 就上《${next.course.name}》啦`,
        hint: `${sameDay ? '' : `周${wd} `}${formatHHMM(next.start)} · ${next.course.location ?? ''}`,
      }
    }
    if (courses.length === 0) return { text: '课表还空着,去「导入」拖个文件进来吧' }
    return { text: '今天没课,陪你发呆~' }
  }, [current, next, now, courses.length, override])

  const sleepy = !current && today.length === 0 || state === 'sleep'
  const excited = !!next && next.start.getTime() - now.getTime() < 15 * 60_000

  /* ---------------- 事件联动(上新课 / 上新作业) ---------------- */
  const lastCurrentId = useRef<string | null>(null)
  const lastPendingCount = useRef(-1)
  useEffect(() => {
    const id = current?.course.id ?? null
    if (lastCurrentId.current !== id) {
      if (id && lastCurrentId.current !== null) {
        setOverride({ text: `上课啦!《${current!.course.name}》`, hint: current!.course.location, until: Date.now() + 8000 })
      }
      lastCurrentId.current = id
    }
  }, [current])

  useEffect(() => {
    const n = pending.length
    if (lastPendingCount.current >= 0 && n > lastPendingCount.current) {
      setOverride({ text: `又有一份作业要交:《${pending[0].title}》`, until: Date.now() + 9000 })
    }
    lastPendingCount.current = n
  }, [pending])

  /* ---------------- 物理循环 ---------------- */
  useEffect(() => {
    if (!visible) return

    const floorY = () => window.innerHeight - PET_H - 8

    if (!pos.current.inited) {
      let saved: { x: number; y: number } | null = null
      try {
        saved = JSON.parse(localStorage.getItem('coursedesk:petPos') || 'null')
      } catch {
        saved = null
      }
      const x = saved?.x ?? window.innerWidth - PET_W - 104
      const y = saved?.y ?? floorY()
      pos.current = { x, y, vx: 0, vy: 0, inited: true }
      targetX.current = x
      apply()
    }

    function apply() {
      const el = wrapRef.current
      if (!el) return
      const { x, y } = pos.current
      el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
    }

    let raf = 0
    let last = performance.now()

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.05, (t - last) / 1000)
      last = t
      const p = pos.current
      const st = stateRef.current

      if (st === 'walk') {
        const dir = Math.sign(targetX.current - p.x) || 1
        setFacing(dir > 0 ? 1 : -1)
        p.x += dir * SPEED * dt
        if (Math.abs(targetX.current - p.x) < 4) go('idle')
      } else if (st === 'fall') {
        p.vy += GRAVITY * dt
        p.y += p.vy * dt
        const fy = floorY()
        if (p.y >= fy) {
          p.y = fy
          p.vy = -p.vy * BOUNCE
          if (Math.abs(p.vy) < 90) {
            p.vy = 0
            go('idle', true)
            try {
              localStorage.setItem('coursedesk:petPos', JSON.stringify({ x: p.x, y: p.y }))
            } catch {}
          }
        }
      }

      // 别让它走出屏幕
      const maxX = window.innerWidth - PET_W - 6
      p.x = Math.min(Math.max(6, p.x), maxX)
      apply()
    }
    raf = requestAnimationFrame(loop)

    const onResize = () => {
      pos.current.x = Math.min(pos.current.x, window.innerWidth - PET_W - 6)
      pos.current.y = Math.min(pos.current.y, floorY())
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
    }
  }, [visible, go, stateRef])

  /* ---------------- 拖动 / 甩出 ---------------- */
  const onPointerDown = (e: React.PointerEvent) => {
    touch()
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    pointer.current = { active: true, moved: 0, ox: e.clientX - rect.left, oy: e.clientY - rect.top, lastX: e.clientX, lastT: performance.now() }
    pos.current.vx = 0
    pos.current.vy = 0
    go('drag', true)
    el.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const p = pointer.current
    if (!p.active) return
    const el = e.currentTarget as HTMLElement
    const rect = el.parentElement!.getBoundingClientRect()
    p.moved += Math.abs(e.movementX) + Math.abs(e.movementY)
    const dt = Math.max(1, performance.now() - p.lastT)
    pos.current.vx = ((e.clientX - p.lastX) / dt) * 1000
    p.lastX = e.clientX
    p.lastT = performance.now()
    pos.current.x = Math.min(Math.max(0, e.clientX - rect.left - p.ox), window.innerWidth - PET_W - 6)
    pos.current.y = Math.min(Math.max(0, e.clientY - rect.top - p.oy), window.innerHeight - PET_H - 6)
    if (wrapRef.current) {
      wrapRef.current.style.transform = `translate3d(${Math.round(pos.current.x)}px, ${Math.round(pos.current.y)}px, 0)`
    }
    // 拖的时候看向移动方向
    if (Math.abs(e.movementX) > 1) setFacing(e.movementX > 0 ? 1 : -1)
  }

  const onPointerUp = () => {
    const p = pointer.current
    if (!p.active) return
    p.active = false
    if (p.moved > 8) {
      // 甩出去:把横向速度也带上
      pos.current.vy = 120
      go('fall', true)
    } else {
      // 只是点了一下
      setOpen((v) => !v)
      go('idle', true)
      try {
        localStorage.setItem('coursedesk:petPos', JSON.stringify({ x: pos.current.x, y: pos.current.y }))
      } catch {}
    }
  }

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-[48] pointer-events-none">
      {/* 锚点 = 兔子的左上角;气泡和面板都挂在它上方,不会把兔子挤出屏幕 */}
      <div ref={wrapRef} className="absolute left-0 top-0 will-change-transform" style={{ width: PET_W, height: PET_H }}>
        {/* 展开的今日信息 */}
        {open && (
          <div className="pointer-events-auto absolute bottom-full mb-1.5 right-0 w-[228px] rounded-2xl bg-[#fffdf5] border-[2.5px] border-ink shadow-sticker-lg p-3 animate-slide-up">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-[11px] font-extrabold tracking-[0.14em] text-ink-mute">今天</span>
              <span className="text-[11px] font-bold text-tangerine-600">第 {week} 周</span>
              <button onClick={onClose} title="收起桌宠" className="ml-auto text-ink-mute hover:text-ink">
                <X size={12} />
              </button>
            </div>

            {today.length === 0 ? (
              <div className="text-[12px] text-ink-mute font-medium">今天没有安排</div>
            ) : (
              <div className="space-y-1 max-h-[132px] overflow-y-auto">
                {today.map((s) => {
                  const live = now >= s.start && now <= s.end
                  const past = now > s.end
                  return (
                    <div key={`${s.course.id}-${s.period}`} className={cn('flex items-center gap-2', past && 'opacity-45')}>
                      <span className="w-[58px] shrink-0 text-[10.5px] font-bold text-ink-mute tabular-nums">
                        {formatHHMM(s.start)}
                      </span>
                      <span
                        className="w-1.5 h-3 rounded-full shrink-0"
                        style={{ background: s.course.color ?? hashColor(s.course.name) }}
                      />
                      <span className={cn('text-[12px] font-bold truncate', live && 'text-tangerine-700')}>
                        {s.course.name}
                        {live && <span className="ml-1 text-[9.5px]">上课中</span>}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            {pending.length > 0 && (
              <>
                <div className="mt-2.5 mb-1 text-[11px] font-extrabold tracking-[0.14em] text-ink-mute">待交作业</div>
                <div className="space-y-0.5">
                  {pending.map((h) => (
                    <div key={h.id} className="flex items-center gap-1.5">
                      <span className="text-[11.5px] font-semibold truncate">{h.title}</span>
                      <span className="ml-auto text-[10px] font-bold text-cherry-500 shrink-0">
                        {dueText(h.dueAt!, now.getTime())}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="mt-2 text-[10px] text-ink-mute leading-relaxed">
              拖我换位置 · 甩出去会落地 · 点我说话
            </div>
          </div>
        )}

        {/* 气泡:挂在兔子正上方,面板打开时让位 */}
        {!open && (
          <button
            onClick={() => {
              touch()
              setOpen(true)
            }}
            className="pointer-events-auto absolute bottom-full mb-1 right-0 w-[186px] text-left bg-white border-[2.5px] border-ink rounded-2xl px-2.5 py-1.5 shadow-sticker-sm"
            title="点我看今天的安排"
          >
            <div className="text-[11.5px] leading-snug font-extrabold text-ink line-clamp-2">{line.text}</div>
            {line.hint?.trim() && (
              <div className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-ink-mute">
                {current ? <MapPin size={9} /> : <Clock size={9} />}
                <span className="truncate">{line.hint}</span>
              </div>
            )}
          </button>
        )}

        {/* 兔子本体 */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className={cn(
            'pointer-events-auto absolute inset-0 cursor-grab active:cursor-grabbing transition-transform',
            state === 'drag' && 'scale-105',
          )}
          title="拖我走 · 点我展开"
        >
          <div className="w-full h-full grid place-items-end justify-center">
            {ready3d && use3d ? (
              <Suspense fallback={<Bunny sleepy={sleepy} size={96} />}>
                <Pet3D state={state} facing={facing} sleepy={sleepy} excited={excited} />
              </Suspense>
            ) : (
              <Bunny sleepy={sleepy} size={96} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
