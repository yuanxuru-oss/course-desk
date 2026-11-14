import { useEffect, useRef, useState } from 'react'
import { Download, Upload, Loader2, ShieldCheck, FolderDown } from 'lucide-react'
import { Button } from './ui'
import {
  downloadBackup,
  importBackupFile,
  summaryText,
  readLastExport,
  downloadHint,
  type LastExport,
} from '../lib/backup'

interface Props {
  onToast: (text: string, type?: 'info' | 'success' | 'error') => void
  /** 紧凑模式:只放按钮(手机上用) */
  compact?: boolean
  /** 导入后需要刷新页面数据视图 */
  onImported?: () => void
}

const fmtTime = (t: number) => {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 导出 / 导入备份的按钮组。
 *
 * 单独抽出来,是因为它要出现在两个地方:设置页顶部(桌面)和「更多」页(手机)。
 * 之前只有设置页最底部有,很多人根本找不到。
 */
export function BackupActions({ onToast, compact = false, onImported }: Props) {
  const [busy, setBusy] = useState<'' | 'export' | 'import'>('')
  const [last, setLast] = useState<LastExport | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => setLast(readLastExport()), [])

  const doExport = async () => {
    setBusy('export')
    try {
      const name = await downloadBackup()
      setLast(readLastExport())
      // 明确告诉用户文件去哪了 —— 浏览器默认不会弹提示,很多人以为没导出成功
      onToast(`已导出 ${name} → 保存在${downloadHint()}`, 'success')
    } catch (err: any) {
      onToast(`导出失败:${err?.message ?? err}`, 'error')
    } finally {
      setBusy('')
    }
  }

  const doImport = async (file: File) => {
    setBusy('import')
    try {
      const summary = await importBackupFile(file)
      onToast(summaryText(summary), 'success')
      onImported?.()
    } catch (err: any) {
      onToast(`导入失败:${err?.message ?? err}`, 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) doImport(f)
          e.target.value = ''
        }}
      />

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={doExport} disabled={busy !== ''}>
          {busy === 'export' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} 导出备份
        </Button>
        <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy !== ''}>
          {busy === 'import' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} 导入备份
        </Button>
      </div>

      {last && (
        <div className="flex items-start gap-1.5 text-[11.5px] text-ink-mute leading-snug">
          <FolderDown size={12} className="shrink-0 mt-0.5" />
          <span>
            上次导出 <b className="text-ink-soft">{fmtTime(last.at)}</b> ·{' '}
            <span className="font-mono break-all">{last.name}</span>
            <br />
            文件在{downloadHint()},用「导入备份」从同一个地方选回来。
          </span>
        </div>
      )}

      <details className="text-[11.5px] text-ink-mute">
        <summary className="cursor-pointer select-none">点了没反应?找不到文件?</summary>
        <div className="mt-1.5 space-y-1 leading-relaxed">
          <p>· 浏览器下载默认<b>不弹提示</b>,文件直接进下载文件夹。</p>
          <p>· 按 <kbd className="px-1 rounded bg-white border border-ink/15">Ctrl</kbd>+<kbd className="px-1 rounded bg-white border border-ink/15">J</kbd>(Mac 是 <kbd className="px-1 rounded bg-white border border-ink/15">⌘</kbd>+<kbd className="px-1 rounded bg-white border border-ink/15">⇧</kbd>+<kbd className="px-1 rounded bg-white border border-ink/15">J</kbd>)打开下载记录,能直接看到文件。</p>
          <p>· 如果被拦截了,地址栏右侧会出现一个下载小图标,点它选「允许下载」再导一次。</p>
          <p>· 手机浏览器有时会把文件存进「文件」App,而不是相册。</p>
        </div>
      </details>

      {!compact && (
        <div className="rounded-xl bg-butter-100/70 p-3 text-[12px] text-ink-soft leading-relaxed">
          <div className="flex items-center gap-1.5 font-medium text-ink mb-1">
            <ShieldCheck size={13} className="text-tangerine-600" />
            什么时候一定要导出一次
          </div>
          换手机 / 换电脑 / 换网址 / 清理浏览器缓存,数据都不会跟着走。
          导出的 JSON 里<b>只有课表、作业、备忘和图片</b>,存在你自己的设备上,不上传任何服务器;
          导入时会<b>合并</b>到你现有的数据上,不会覆盖。
        </div>
      )}
    </div>
  )
}
