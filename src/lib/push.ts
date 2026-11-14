/**
 * Web Push:浏览器订阅 + 与自建推送服务通信
 * 需要 VAPID 公钥与推送服务地址;未配置时自动降级为本地通知。
 */

export interface PushStatus {
  supported: boolean
  permission: NotificationPermission | 'unsupported'
  subscribed: boolean
  serverReachable: boolean
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** 订阅推送 */
export async function subscribePush(vapidPublicKey: string): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return null
  const reg = await navigator.serviceWorker.ready
  const existing = await reg.pushManager.getSubscription()
  if (existing) return existing
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  })
}

/** 把订阅注册到推送服务 */
export async function registerSubscription(serverUrl: string, sub: PushSubscription): Promise<boolean> {
  try {
    const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/push/subscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sub.toJSON()),
    })
    return res.ok
  } catch (err) {
    console.warn('[push] 注册订阅失败', err)
    return false
  }
}

/** 让推送服务立刻发一条消息 */
export async function sendWebpush(
  serverUrl: string,
  payload: { title: string; body: string; tag?: string },
): Promise<boolean> {
  try {
    const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/push/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    /*
     * 只看 res.ok 会误判:服务端「没配 VAPID」「没有订阅」时
     * 返回的是 HTTP 200 + {ok:false}。那样这条提醒会被标记成已投递,
     * 之后永远不再重试,用户一条都收不到。
     */
    const data = await res.json().catch(() => null)
    return data && typeof data.ok === 'boolean' ? data.ok : res.ok
  } catch (err) {
    console.warn('[push] 发送失败', err)
    return false
  }
}

/** 探测推送服务是否可用 */
export async function pingServer(serverUrl: string): Promise<boolean> {
  if (!serverUrl) return false
  try {
    const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/health`, {
      method: 'GET',
      headers: { 'accept': 'application/json' },
    })
    if (!res.ok) return false
    const data = await res.json()
    return !!data?.ok
  } catch {
    return false
  }
}

/** 从已保存的订阅里读取当前订阅状态 */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  try {
    const reg = await navigator.serviceWorker.ready
    return await reg.pushManager.getSubscription()
  } catch {
    return null
  }
}
