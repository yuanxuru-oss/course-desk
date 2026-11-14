/**
 * 备份 / 恢复
 *
 * 数据只存在本机浏览器里,而浏览器数据会随「清缓存 / 换设备 / 换网址」消失,
 * 所以导出备份必须是随手能点到的功能 —— 之前它藏在设置页最底部,很难发现。
 */
import { exportAll, importAll } from './actions'
import { downloadBlob } from './utils'

export function backupFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `课程桌备份-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`
}

/** 上一次导出的记录(存在本机,方便用户回头找文件) */
export interface LastExport {
  name: string
  at: number
}

const LAST_KEY = 'coursedesk:lastExport'

export function readLastExport(): LastExport | null {
  try {
    const raw = localStorage.getItem(LAST_KEY)
    if (!raw) return null
    const v = JSON.parse(raw)
    if (v && typeof v.name === 'string' && typeof v.at === 'number') return v
    return null
  } catch {
    return null
  }
}

function writeLastExport(v: LastExport) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(v))
  } catch {
    /* 隐私模式下写不了就算了 */
  }
}

/** 备份文件的下载提示:不同系统一句人话 */
export function downloadHint(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (/iPhone|iPad|iPod/i.test(ua)) return '「文件」App →「下载」里'
  if (/Android/i.test(ua)) return '手机的「文件 / 下载」里'
  if (/Mac/i.test(ua)) return '「下载」文件夹(访达 → 下载)里'
  return '浏览器的「下载」文件夹里(Windows 一般是 C:\\Users\\你\\Downloads)'
}

/** 打包全部数据并触发下载 */
export async function downloadBackup(): Promise<string> {
  const bundle = await exportAll()
  const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' })
  const name = backupFileName()
  downloadBlob(blob, name)
  writeLastExport({ name, at: Date.now() })
  return name
}

export interface BackupSummary {
  courses: number
  events: number
  homework: number
  notes: number
  images: number
}

/** 读取备份文件并合并进当前数据(同 id 覆盖,不删除现有内容) */
export async function importBackupFile(file: File): Promise<BackupSummary> {
  const text = await file.text()
  let bundle: any
  try {
    bundle = JSON.parse(text)
  } catch {
    throw new Error('这不是课程桌的备份文件(JSON 格式不对)')
  }
  if (!bundle || typeof bundle !== 'object' || !Array.isArray(bundle.courses)) {
    throw new Error('这不是课程桌的备份文件(缺少 courses 字段)')
  }
  await importAll(bundle, 'merge')
  return {
    courses: bundle.courses?.length ?? 0,
    events: bundle.events?.length ?? 0,
    homework: bundle.homework?.length ?? 0,
    notes: bundle.notes?.length ?? 0,
    images: bundle.images?.length ?? 0,
  }
}

export function summaryText(s: BackupSummary): string {
  const parts = [
    s.courses && `${s.courses} 门课`,
    s.events && `${s.events} 项行程`,
    s.homework && `${s.homework} 条作业`,
    s.notes && `${s.notes} 篇备忘`,
    s.images && `${s.images} 张图片`,
  ].filter(Boolean)
  return parts.length ? `已导入 ${parts.join('、')}` : '备份里没有可导入的数据'
}
