import { create } from 'zustand'
import { db } from './db'
import { defaultSettings } from './lib/settings'
import type { Settings } from './types'
import type { ToastItem } from './components/ui'
import { migrateColor } from './lib/utils'

interface AppState {
  settings: Settings
  ready: boolean
  toasts: ToastItem[]
  init: () => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  toast: (text: string, type?: ToastItem['type']) => void
  dismissToast: (id: string) => void
}

/**
 * 配色迁移:老版本用的蓝紫色系 / 高饱和原色不在当前色板里,
 * 映射到最接近的新颜色,保证课表整体色调统一、不会「跳色」。
 */
async function migrateCourseColors() {
  const courses = await db.courses.toArray()
  for (const c of courses) {
    const next = migrateColor(c.color, c.name)
    if (next !== c.color) await db.courses.update(c.id, { color: next })
  }
}

/**
 * 老版本存的设置可能缺字段(比如某个版本才加的 ai.proxy / channels.push)。
 * 只做 `{...default, ...stored}` 这种浅合并,嵌套对象会整体被旧值覆盖,
 * 新加的键永远是 undefined —— 轻则功能不生效,重则
 * `settings.channels.local` 直接 undefined 报错。
 * 所以对已知的嵌套对象做第二层合并。
 */
function mergeSettings(stored: Partial<Settings> | undefined): Settings {
  const base = defaultSettings()
  if (!stored) return base
  return {
    ...base,
    ...stored,
    ai: { ...base.ai, ...(stored.ai ?? {}) },
    channels: { ...base.channels, ...(stored.channels ?? {}) },
  }
}

export const useApp = create<AppState>((set, get) => ({
  settings: defaultSettings(),
  ready: false,
  toasts: [],

  init: async () => {
    /*
     * 读库失败也必须把 ready 置为 true。
     * 之前这里没有兜底:隐私模式 / IndexedDB 被禁用 / 配额错误时
     * init 直接 reject,ready 永远是 false,应用永久停在「正在启动课程桌…」。
     */
    let settings = defaultSettings()
    try {
      const stored = await db.settings.get('app')
      settings = mergeSettings(stored)
      if (!stored) await db.settings.put(settings)
      else if (JSON.stringify(stored) !== JSON.stringify(settings)) await db.settings.put(settings)
    } catch (err) {
      console.warn('[store] 读取设置失败,使用默认设置', err)
    } finally {
      set({ settings, ready: true })
    }
    try {
      await migrateCourseColors()
    } catch (err) {
      console.warn('[migrate] 配色迁移失败', err)
    }
  },

  saveSettings: async (patch) => {
    const prev = get().settings
    const next = { ...prev, ...patch, updatedAt: Date.now() }
    set({ settings: next })
    try {
      await db.settings.put(next)
    } catch (err) {
      // 写库失败必须回滚,否则界面显示「已保存」、刷新后又变回去
      set({ settings: prev })
      throw err
    }
  },

  toast: (text, type = 'info') => {
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    set((s) => ({ toasts: [...s.toasts, { id, text, type }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, type === 'error' ? 5200 : 3000)
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
