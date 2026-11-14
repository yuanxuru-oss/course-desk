/**
 * 桌宠 → 网页 的数据通道。
 *
 * 桌面版是独立进程,没法直接写浏览器的 IndexedDB。所以反过来:
 * 桌宠里确认后,用系统浏览器打开
 *   https://…/#/capture?d=<base64url(JSON)>
 * 网页一打开就读这个参数,写进自己的库,再把最新快照推回桌宠 —— 闭环。
 */
import type { CourseEvent, Homework } from '../types'

export interface CapturePayload {
  v: 1
  kind: 'event' | 'homework'
  title: string
  /** 事件用 */
  date?: string
  start?: string
  end?: string
  location?: string
  detail?: string
  /** 作业用 */
  dueAt?: number
  courseName?: string
}

export function encodeCapture(p: CapturePayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(p))
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeCapture(s: string): CapturePayload | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64)
    const bytes = new Uint8Array([...bin].map((c) => c.charCodeAt(0)))
    const json = new TextDecoder().decode(bytes)
    const p = JSON.parse(json) as CapturePayload
    if (!p || p.v !== 1 || !p.title || (p.kind !== 'event' && p.kind !== 'homework')) return null
    return p
  } catch {
    return null
  }
}

/** 从当前 hash 里取 capture 参数(如 #/capture?d=xxx) */
export function readCaptureFromHash(hash = window.location.hash): CapturePayload | null {
  const m = hash.match(/#\/?capture\?d=([^&]+)/)
  if (!m) return null
  return decodeCapture(m[1])
}

/** 把 capture 参数消费掉,避免刷新重复导入 */
export function clearCaptureHash() {
  if (window.location.hash.includes('capture')) {
    history.replaceState(null, '', window.location.pathname + '#/schedule')
  }
}

export function payloadToEvent(p: CapturePayload): Omit<CourseEvent, 'id' | 'createdAt' | 'updatedAt'> | null {
  if (p.kind !== 'event' || !p.date) return null
  return {
    title: p.title,
    kind: 'meeting',
    date: p.date,
    start: p.start ?? '',
    end: p.end ?? '',
    location: p.location,
    detail: p.detail,
    weekly: false,
  }
}

export function payloadToHomework(p: CapturePayload): Omit<Homework, 'id' | 'createdAt' | 'updatedAt'> | null {
  if (p.kind !== 'homework' || !p.dueAt) return null
  return {
    title: p.title,
    dueAt: p.dueAt,
    done: false,
    priority: 1,
    attachments: [],
  }
}
