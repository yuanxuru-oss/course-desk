/**
 * 版本信息
 *
 * BUILD_ID 由 vite.config.ts 在构建时注入(格式 2026.11.09-1952),
 * 每构建一次就变一次 —— 用来判断「我现在打开的是不是最新版」。
 *
 * 为什么需要它:在线版每次部署都会换一个新域名,
 * 而浏览器把数据存在「域名」下面(IndexedDB 按 origin 隔离)。
 * 于是:
 *   · 旧网址是当天那版的静态快照,不会跟着更新,也不该再用
 *   · 换网址 = 换了个「抽屉」,数据互相看不见
 * 所以设置页里直接把版本号和当前网址摊开给用户看。
 */

/** 由 vite `define` 注入;开发态(没注入)显示 dev */
export const BUILD_ID: string =
  typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'

export const APP_NAME = '课程桌 CourseDesk'

/** 今天的日期(本地时区),用于「今天」这类展示 */
export function todayStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`
}
