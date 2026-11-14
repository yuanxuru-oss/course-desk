import { useEffect, useRef, useState } from 'react'

export type PetState = 'idle' | 'walk' | 'drag' | 'fall' | 'sleep'

/**
 * 桌宠状态机。
 *
 * 参考 vscode-pets 的 state sequence 和 agent-pet-hub 的 PetStateMachine:
 *   - 每个状态有「最短保持时间」,避免抖动(agent-pet-hub 用 500ms)
 *   - 自主行为:隔一会儿自己走两步,再发呆;长时间没人理就睡
 *   - 任何交互都会把状态唤醒
 */
export function usePetState(active: boolean) {
  const [state, setState] = useState<PetState>('idle')
  const stateRef = useRef<PetState>('idle')
  const holdUntil = useRef(0)
  const lastTouch = useRef(Date.now())

  const MIN_HOLD = 420

  const go = (next: PetState, force = false) => {
    if (!force && Date.now() < holdUntil.current) return
    if (stateRef.current === next) return
    stateRef.current = next
    holdUntil.current = Date.now() + MIN_HOLD
    setState(next)
  }

  const touch = () => {
    lastTouch.current = Date.now()
    if (stateRef.current === 'sleep') go('idle', true)
  }

  useEffect(() => {
    if (!active) return

    // 自主游走:每 6~13 秒走一次,走 1 秒左右
    const walkTimer = window.setInterval(() => {
      if (stateRef.current !== 'idle') return
      if (Date.now() - lastTouch.current > 45_000) return
      go('walk')
      window.setTimeout(() => {
        if (stateRef.current === 'walk') go('idle')
      }, 900 + Math.random() * 900)
    }, 6000 + Math.random() * 7000)

    // 发呆太久 → 睡
    const sleepTimer = window.setInterval(() => {
      if (stateRef.current === 'idle' && Date.now() - lastTouch.current > 60_000) go('sleep')
    }, 5000)

    return () => {
      window.clearInterval(walkTimer)
      window.clearInterval(sleepTimer)
    }
  }, [active])

  return { state, stateRef, go, touch }
}
