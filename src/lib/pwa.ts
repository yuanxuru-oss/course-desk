/** PWA 安装引导 */

let deferredPrompt: any = null
const listeners = new Set<() => void>()

/**
 * Service Worker 更新自愈。
 *
 * 背景:本地部署包是「解压覆盖」更新的,用户换包后,浏览器里的旧 SW
 * 还在用**旧的 index.html** 和旧的资源文件名。而新包已经把那些文件删了 →
 * 页面看起来正常,但 PDF 导入之类的功能会报
 * 「Failed to fetch dynamically imported module」(资源 404)。
 *
 * 这里做两件事:
 *   1. 主动 reg.update() 让浏览器去检查有没有新 SW
 *   2. 新 SW 接管时(controllerchange)自动刷新一次,让页面用上新的资源
 *
 * 刷新次数用一个 sessionStorage 标记兜住,同一个标签页最多刷一次,
 * 不会变成刷新死循环。
 */
const SW_RELOAD_FLAG = 'course-desk:sw-reloaded'

export function initSwSelfHeal() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const hadController = !!navigator.serviceWorker.controller

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // 首次安装时也会触发 controllerchange,那次不用刷
    if (!hadController) return
    if (sessionStorage.getItem(SW_RELOAD_FLAG)) return
    sessionStorage.setItem(SW_RELOAD_FLAG, '1')
    location.reload()
  })

  // 页面加载完一会儿再查一次更新(首屏不跟更新抢带宽)
  window.addEventListener('load', () => {
    setTimeout(() => {
      navigator.serviceWorker.getRegistration().then((reg) => reg?.update()).catch(() => {})
    }, 1500)
  })
}

export function initPwa() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e
    listeners.forEach((fn) => fn())
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    listeners.forEach((fn) => fn())
  })
}

export function onInstallChange(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function canInstall(): boolean {
  return !!deferredPrompt
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredPrompt) return 'unavailable'
  deferredPrompt.prompt()
  const choice = await deferredPrompt.userChoice
  deferredPrompt = null
  listeners.forEach((fn) => fn())
  return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed'
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  )
}

export function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}
