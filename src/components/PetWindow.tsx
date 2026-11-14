import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import type { Course, Homework, Settings } from '../types'
import { currentSession, nextSession, currentWeek, formatHHMM, WEEKDAY_CN } from '../lib/time'
import { Bunny } from './PetBunny'
import { snapshotHeadline } from '../lib/petSync'
import { parseQuickCapture } from '../lib/quickCapture'
import type { PetSnapshot } from '../lib/petSync'

const Pet3D = lazy(() => import('./Pet3D'))

interface Props {
  courses: Course[]
  homework: Homework[]
  settings: Settings
}

declare global {
  interface Window {
    desktopPet?: {
      isDesktop: true
      onCursor(cb: (pos: { x: number; y: number; w: number; h: number }) => void): () => void
      getSnapshot(): Promise<import('../lib/petSync').PetSnapshot | null>
      onSnapshot(cb: (snap: import('../lib/petSync').PetSnapshot) => void): () => void
      setInteractive(on: boolean): void
      dragStart(offset: { x: number; y: number }): void
      dragEnd(): void
      dragMove?: () => void
      onDragCancel?: (cb: () => void) => () => void
      menu(): void
      quit(): void
      openApp(): void
      readClipboard(): Promise<string>
      openCapture(payload: {
        v: 1
        kind: 'event' | 'homework'
        title: string
        date?: string
        start?: string
        end?: string
        location?: string
        detail?: string
        dueAt?: number
      }): void
    }
  }
}

/**
 * 桌面外壳里跑的「纯桌宠」页面(#/pet)。
 *
 * 和网页里的 PetOverlay 的区别:
 *   - 背景透明、没有页面底色(Electron 窗口才是透明的)
 *   - 眼神跟着**系统全局鼠标**走(坐标由主进程 screen.getCursorScreenPoint 推过来)
 *   - 拖动时窗口跟着鼠标走;鼠标不在兔子身上时窗口鼠标穿透,不挡后面的操作
 */
export function PetWindow({ courses, homework, settings }: Props) {
  const bridge = typeof window !== 'undefined' ? window.desktopPet : undefined
  const [now, setNow] = useState(new Date())
  const [look, setLook] = useState({ x: 0, y: 0 })
  const [hover, setHover] = useState(false)
  const [hop, setHop] = useState(0)
  /* 点桌宠弹出的操作面板 */
  const [panel, setPanel] = useState<'none' | 'menu' | 'event'>('none')
  const [hint, setHint] = useState('')
  const todayStr = () => {
    const d = new Date()
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  }
  const [ev, setEv] = useState({ title: '', date: todayStr(), start: '', end: '', location: '' })
  const dragInfo = useRef({ active: false, moved: 0, ox: 0, oy: 0 })

  /** 没有 WebGL(远程桌面 / 老显卡 / 关了硬件加速)就退回 2D,别让窗口变成一片空白 */
  const webglOK = useMemo(() => {
    try {
      const c = document.createElement('canvas')
      return !!(c.getContext('webgl2') || c.getContext('webgl'))
    } catch {
      return false
    }
  }, [])

  /* 透明背景:外壳里要让窗口后面的桌面透出来 */
  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const prev = { html: html.style.background, body: body.style.background }
    html.style.background = 'transparent'
    body.style.background = 'transparent'
    body.style.overflow = 'hidden'
    return () => {
      html.style.background = prev.html
      body.style.background = prev.body
      body.style.overflow = ''
    }
  }, [])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20_000)
    return () => clearInterval(t)
  }, [])


  /* 全局鼠标 → 眼睛朝向(-1 ~ 1) */
  useEffect(() => {
    if (!bridge) {
      // 浏览器里调试时退化成页面内跟随
      const onMove = (e: PointerEvent) => {
        setLook({
          x: (e.clientX / window.innerWidth - 0.5) * 2,
          y: (e.clientY / window.innerHeight - 0.5) * 2,
        })
      }
      window.addEventListener('pointermove', onMove)
      return () => window.removeEventListener('pointermove', onMove)
    }
    return bridge.onCursor((pos) => {
      const cx = pos.w / 2
      const cy = pos.h * 0.45
      const nx = Math.max(-1, Math.min(1, (pos.x - cx) / (pos.w * 0.6)))
      const ny = Math.max(-1, Math.min(1, (pos.y - cy) / (pos.h * 0.6)))
      setLook({ x: nx, y: ny })
    })
  }, [bridge])

  /* 鼠标进兔子 → 窗口接收事件;离开 → 穿透 */
  useEffect(() => {
    bridge?.setInteractive(hover)
    return () => bridge?.setInteractive(false)
  }, [bridge, hover])

  /* 网页推过来的快照优先:桌面版自己的库是空的,数据得靠这个通道 */
  const [snap, setSnap] = useState<PetSnapshot | null>(null)
  useEffect(() => {
    if (!bridge?.getSnapshot) return
    let alive = true
    bridge.getSnapshot().then((s) => {
      if (alive && s) setSnap(s)
    })
    const off = bridge.onSnapshot?.((s) => setSnap(s))
    return () => {
      alive = false
      off?.()
    }
  }, [bridge])

  const current = useMemo(() => currentSession(courses, settings, now), [courses, settings, now])
  const next = useMemo(() => nextSession(courses, settings, now), [courses, settings, now])
  const week = currentWeek(settings, now)

  const line = useMemo(() => {
    // 有快照就用快照(它含课程 + 行程),这才是和网页同步的那份数据
    if (snap) return snapshotHeadline(snap).text
    if (current) return `正在上《${current.course.name}》`
    if (next) {
      const wd = WEEKDAY_CN[(next.start.getDay() === 0 ? 7 : next.start.getDay()) - 1]
      const sameDay = next.start.toDateString() === now.toDateString()
      return `${sameDay ? '' : `周${wd} `}${formatHHMM(next.start)}《${next.course.name}》`
    }
    return courses.length ? '今天没课~' : '还没有课表'
  }, [snap, current, next, now, courses.length])

  const sleepy = snap ? snap.today.length === 0 && snap.events.length === 0 : !current && !next

  /*
   * 拖动窗口:偏移量 = 鼠标在窗口内的位置,主进程据此跟随。
   *
   * 关键点:鼠标一离开窗口,窗口就切回"穿透",pointerup 收不到 ——
   * 拖动状态会永远挂着,表现为「桌宠粘着鼠标甩不掉」。
   * 所以除了 pointerup,还在 window 上挂 pointerup / pointercancel / blur 兜底,
   * 主进程那边另有 900ms 看门狗兜第二层。
   */
  const endDrag = () => {
    if (!dragInfo.current.active) return
    const wasDrag = dragInfo.current.moved > 4
    dragInfo.current.active = false
    if (wasDrag) bridge?.dragEnd()
    else {
      setHop((h) => h + 1)
      setPanel((p) => (p === 'none' ? 'menu' : 'none'))
      setHint('')
    }
  }

  /* ---------- 面板里的动作 ---------- */
  const sendEvent = () => {
    if (!ev.title.trim()) {
      setHint('先写个标题')
      return
    }
    bridge?.openCapture?.({
      v: 1,
      kind: 'event',
      title: ev.title.trim(),
      date: ev.date,
      start: ev.start,
      end: ev.end,
      location: ev.location.trim(),
    })
    setHint('已交给课程桌,网页里会出现这一条')
    setPanel('none')
  }

  const doPaste = async () => {
    const text = (await bridge?.readClipboard?.()) ?? ''
    if (!text.trim()) {
      setHint('剪贴板是空的')
      return
    }
    const cap = parseQuickCapture(text, { now: new Date() })
    if (!cap) {
      setHint('这段文字里没认出「日期 + 时间」')
      return
    }
    setEv({
      title: cap.parsed.title,
      date: cap.parsed.date,
      start: cap.parsed.start,
      end: cap.parsed.end,
      location: cap.parsed.location ?? '',
    })
    setHint('识别好了,确认一下再保存')
    setPanel('event')
  }
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return
    dragInfo.current = { active: true, moved: 0, ox: e.clientX, oy: e.clientY }
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragInfo.current.active) return
    dragInfo.current.moved += Math.abs(e.movementX) + Math.abs(e.movementY)
    if (dragInfo.current.moved > 4 && bridge) {
      bridge.dragStart({ x: dragInfo.current.ox, y: dragInfo.current.oy })
      bridge.dragMove?.()
    }
  }

  useEffect(() => {
    const stop = () => {
      if (dragInfo.current.active) {
        dragInfo.current.active = false
        if (dragInfo.current.moved > 4) bridge?.dragEnd()
      }
    }
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    window.addEventListener('blur', stop)
    const offCancel = bridge?.onDragCancel?.(() => {
      dragInfo.current.active = false
    })
    return () => {
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      window.removeEventListener('blur', stop)
      offCancel?.()
    }
  }, [bridge])

  return (
    <div className="w-screen h-screen flex flex-col items-center justify-center select-none bg-transparent overflow-hidden">
      {/* ============ 点一下弹出的操作面板 ============ */}
      {panel !== 'none' && (
        <div className="pointer-events-auto absolute top-1.5 left-1.5 right-1.5 z-10 rounded-[14px] bg-[#fffdf5] border-2 border-ink/70 shadow-lg p-2.5 text-ink">
          {panel === 'menu' && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-bold tracking-[0.14em] text-ink-mute uppercase">桌宠 · 快速添加</div>
              <button
                onClick={() => {
                  setHint('')
                  setPanel('event')
                }}
                className="w-full h-8 rounded-lg bg-tangerine-500 text-white text-[12px] font-bold hover:bg-tangerine-600"
              >
                + 添加行程
              </button>
              <button
                onClick={doPaste}
                className="w-full h-8 rounded-lg bg-white border border-ink/15 text-[12px] font-bold text-ink-soft hover:bg-ink/[0.04]"
              >
                粘贴识别(从剪贴板)
              </button>
              <button
                onClick={() => bridge?.openApp()}
                className="w-full h-8 rounded-lg bg-white border border-ink/15 text-[12px] font-medium text-ink-soft hover:bg-ink/[0.04]"
              >
                打开课程桌
              </button>
            </div>
          )}

          {panel === 'event' && (
            <div className="space-y-1.5">
              <input
                autoFocus
                value={ev.title}
                onChange={(e) => setEv({ ...ev, title: e.target.value })}
                placeholder="标题:学生会例会"
                className="w-full h-7 rounded-md border border-ink/15 px-2 text-[11.5px] outline-none focus:border-tangerine-400"
              />
              <input
                type="date"
                value={ev.date}
                onChange={(e) => setEv({ ...ev, date: e.target.value })}
                className="w-full min-w-0 h-7 rounded-md border border-ink/15 px-1.5 text-[11px] outline-none focus:border-tangerine-400"
              />
              <div className="flex gap-1.5">
                <input
                  value={ev.start}
                  onChange={(e) => setEv({ ...ev, start: e.target.value })}
                  placeholder="19:00"
                  className="w-0 flex-1 min-w-0 h-7 rounded-md border border-ink/15 px-1.5 text-[11px] outline-none focus:border-tangerine-400"
                />
                <input
                  value={ev.end}
                  onChange={(e) => setEv({ ...ev, end: e.target.value })}
                  placeholder="20:00"
                  className="w-0 flex-1 min-w-0 h-7 rounded-md border border-ink/15 px-1.5 text-[11px] outline-none focus:border-tangerine-400"
                />
              </div>
              <input
                value={ev.location}
                onChange={(e) => setEv({ ...ev, location: e.target.value })}
                placeholder="地点(可留空)"
                className="w-full h-7 rounded-md border border-ink/15 px-2 text-[11.5px] outline-none focus:border-tangerine-400"
              />
              <div className="flex gap-1.5 pt-0.5">
                <button
                  onClick={() => setPanel('menu')}
                  className="flex-1 h-8 rounded-lg bg-white border border-ink/15 text-[12px] font-medium text-ink-soft"
                >
                  返回
                </button>
                <button
                  onClick={sendEvent}
                  className="flex-[2] h-8 rounded-lg bg-tangerine-500 text-white text-[12px] font-bold hover:bg-tangerine-600"
                >
                  保存到课程桌
                </button>
              </div>
            </div>
          )}

          {hint && <div className="mt-1.5 text-[10.5px] text-tangerine-700 leading-snug">{hint}</div>}
        </div>
      )}

      <div className="pointer-events-auto bubble mb-1 max-w-[190px] px-2.5 py-1 rounded-2xl text-[11px] font-bold text-ink bg-white/85 border-2 border-ink/70 shadow-sm text-center">
        {line}
      </div>

      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onContextMenu={(e) => {
          e.preventDefault()
          bridge?.menu()
        }}
        onDoubleClick={() => bridge?.openApp()}
        className="w-[190px] h-[210px] grid place-items-end justify-center cursor-grab active:cursor-grabbing"
        title="拖我走 · 双击打开课程桌 · 右键菜单"
      >
        <Suspense fallback={<Bunny sleepy={sleepy} size={150} />}>
          {webglOK ? (
            <Pet3D state="idle" facing={look.x >= 0 ? 1 : -1} sleepy={sleepy} look={look} hopPulse={hop} />
          ) : (
            <Bunny sleepy={sleepy} size={150} />
          )}
        </Suspense>
      </div>

      <div className="mt-1 text-[9.5px] font-bold text-ink/45 tracking-wide">第 {snap?.week ?? week} 周</div>
    </div>
  )
}
