import clsx, { type ClassValue } from 'clsx'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

/**
 * Bruna family 色系 —— 降饱和后的课表色板。
 *
 * 上一版偏「高饱和原色」,一屏七八个色块并排时很扎眼(尤其那块正红)。
 * 现在统一把明度压低、饱和度收 15~20%,仍保留海报贴纸的气质,
 * 但长时间盯着看不累。品牌橙单独保留一点点亮度,作为唯一的视觉锚点。
 */
export const COURSE_COLORS = [
  '#E5763A', // 陶橘(品牌橙的柔和版)
  '#7B92DC', // 蓝紫
  '#4FA35E', // 苔绿
  '#F4CE4E', // 奶黄
  '#469EC4', // 雾蓝
  '#BC5F4E', // 陶土红(替代原来的正红)
  '#3FA08A', // 松青
  '#A97C5B', // 可可棕
] as const

/** 浅底版本(色块背景) */
export const COURSE_COLORS_SOFT = [
  '#FBE9DA',
  '#E6EAF9',
  '#DCEEE0',
  '#FEF7D4',
  '#DCEBF3',
  '#F3E0DA',
  '#D8EDE8',
  '#F0E5D8',
] as const

/** 深底版本(色块文字) */
export const COURSE_COLORS_TEXT = [
  '#A9541F',
  '#3D4A83',
  '#2C6B38',
  '#8A6116',
  '#276283',
  '#8E4234',
  '#236B59',
  '#6B4A31',
] as const

/**
 * 旧色板 → 新色板的迁移表。
 * 升级后老数据里的颜色不会「跳色」,而是平滑落到最接近的新颜色。
 */
export const LEGACY_COLOR_MAP: Record<string, string> = {
  // 上一版 Bruna 调色板
  '#F26722': '#E5763A',
  '#2FBE55': '#4FA35E',
  '#4FAFD6': '#469EC4',
  '#E8422F': '#BC5F4E',
  // 更早的灰蓝版调色板
  '#F97316': '#E5763A',
  '#EF4444': '#BC5F4E',
  '#DC2626': '#BC5F4E',
  '#3B82F6': '#469EC4',
  '#0EA5E9': '#469EC4',
  '#06B6D4': '#3FA08A',
  '#10B981': '#4FA35E',
  '#22C55E': '#4FA35E',
  '#6366F1': '#7B92DC',
  '#8B5CF6': '#7B92DC',
  '#F59E0B': '#F4CE4E',
  '#14B8A6': '#3FA08A',
}

/** 把任意旧颜色映射到当前色板;不在表内就按课程名哈希一个 */
export function migrateColor(color: string | undefined, name: string): string {
  if (!color) return hashColor(name)
  const key = color.trim().toUpperCase()
  if ((COURSE_COLORS as readonly string[]).includes(key)) return key
  return LEGACY_COLOR_MAP[key] ?? hashColor(name)
}

/** 在深色/浅色底上取可读文字色 */
export function readableText(hex: string): string {
  const c = hex.replace('#', '')
  const r = parseInt(c.slice(0, 2), 16)
  const g = parseInt(c.slice(2, 4), 16)
  const b = parseInt(c.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.62 ? '#241F1A' : '#FFFFFF'
}

/** 稳定的颜色哈希:同一门课永远同一个颜色 */
export function hashColor(text: string): string {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return COURSE_COLORS[h % COURSE_COLORS.length]
}

/** 颜色对应的浅底/文字色 */
export function colorStyle(color: string, mode: 'soft' | 'solid' = 'soft') {
  if (mode === 'solid') {
    return { background: color, color: readableText(color), borderColor: color }
  }
  return {
    background: `${color}1f`,
    color,
    border: `2px solid ${color}40`,
  }
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 备份里含图片时文件可能好几 MB,1 秒就回收会让慢一点的环境下载中断
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function debounce<T extends (...args: any[]) => void>(fn: T, ms = 300) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

export function truncate(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n)}…` : text
}
