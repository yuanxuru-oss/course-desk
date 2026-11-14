import { useEffect, useState } from 'react'
import { AlertTriangle, Trash2, KeyRound, Loader2, ShieldAlert } from 'lucide-react'
import { Button, Modal } from './ui'
import { db } from '../db'
import { wipeAll } from '../lib/actions'
import { useApp } from '../store'
import { defaultSettings } from '../lib/settings'
import { formatBytes } from '../lib/utils'

interface Props {
  onToast: (text: string, type?: 'info' | 'success' | 'error') => void
}

interface Counts {
  courses: number
  events: number
  homework: number
  notes: number
  images: number
  bytes: number
}

/**
 * 危险操作区:清空数据 / 清除 AI Key。
 *
 * 为什么单独做一块:
 *   1. 原来的「清空数据」是个不起眼的小字按钮,而且要删什么完全没说
 *   2. 用户常常只想清一部分(比如只清 AI Key,不舍得清课表)
 * 所以这里先摊开"会删哪些、各有多少条",再让用户勾选要不要连 Key 一起清。
 */
export function DangerZone({ onToast }: Props) {
  const [open, setOpen] = useState(false)
  const [counts, setCounts] = useState<Counts | null>(null)
  const [busy, setBusy] = useState(false)
  const [alsoAi, setAlsoAi] = useState(true)
  const [alsoChannels, setAlsoChannels] = useState(false)

  const refresh = async () => {
    const [courses, events, homework, notes, blobs] = await Promise.all([
      db.courses.count(),
      db.events.count(),
      db.homework.count(),
      db.notes.count(),
      db.blobs.toArray(),
    ])
    const bytes = blobs.reduce((n, b) => n + (b.size ?? 0), 0)
    setCounts({ courses, events, homework, notes, images: blobs.length, bytes })
  }

  useEffect(() => {
    if (open) refresh()
  }, [open])

  const wipe = async () => {
    setBusy(true)
    try {
      await wipeAll()
      // 顺手把敏感配置清掉(可选)
      const patch: any = {}
      if (alsoAi) patch.ai = defaultSettings().ai
      if (alsoChannels) {
        patch.channels = { local: true, webpush: false, wechat: false }
        patch.wechatKey = ''
        patch.wechatProxy = ''
        patch.pushServerUrl = ''
        patch.vapidPublicKey = ''
      }
      if (Object.keys(patch).length) await useApp.getState().saveSettings(patch)
      onToast('已清空本机数据', 'success')
      setOpen(false)
      setTimeout(() => location.reload(), 700)
    } catch (err: any) {
      onToast(`清空失败:${err?.message ?? err}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  /** 只清 AI 配置(Key / 地址 / 模型),不动课表 */
  const clearAiOnly = async () => {
    if (!confirm('只清除 AI 配置(API Key、地址、模型名)?课表和作业不会动。')) return
    try {
      await useApp.getState().saveSettings({ ai: defaultSettings().ai })
      onToast('AI 配置已清除', 'success')
    } catch (err: any) {
      onToast(`清除失败:${err?.message ?? err}`, 'error')
    }
  }

  const summary = counts
    ? [
        counts.courses && `${counts.courses} 门课`,
        counts.events && `${counts.events} 项行程`,
        counts.homework && `${counts.homework} 条作业`,
        counts.notes && `${counts.notes} 篇备忘`,
        counts.images && `${counts.images} 张图片(约 ${formatBytes(counts.bytes)})`,
      ]
        .filter(Boolean)
        .join('、') || '暂时没有数据'
    : '正在统计…'

  return (
    <>
      <div className="rounded-xl border-2 border-cherry-500/25 bg-cherry-500/[0.04] p-3.5 space-y-2.5">
        <div className="flex items-center gap-1.5">
          <ShieldAlert size={14} className="text-cherry-500" />
          <span className="text-[12.5px] font-bold text-cherry-500">危险操作</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="danger"
            onClick={() => setOpen(true)}
          >
            <Trash2 size={14} /> 清空数据
          </Button>
          <Button size="sm" variant="ghost" className="text-cherry-500 hover:bg-cherry-500/10" onClick={clearAiOnly}>
            <KeyRound size={14} /> 只清除 AI Key
          </Button>
        </div>

        <p className="text-[11.5px] text-ink-mute leading-relaxed">
          清空会删掉这台设备上的课表、作业、备忘、行程、图片和 AI 配置。
          <b className="text-ink-soft">删掉之后找不回来</b>,建议先「导出备份」。
        </p>
      </div>

      <Modal open={open} onClose={() => !busy && setOpen(false)} title="清空本机数据" footer={null}>
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-xl bg-cherry-500/8 border border-cherry-500/25 p-3">
            <AlertTriangle size={15} className="text-cherry-500 shrink-0 mt-0.5" />
            <div className="text-[12.5px] text-ink-soft leading-relaxed">
              <div className="font-medium text-ink mb-0.5">即将删除</div>
              <div>{summary}</div>
              <div className="text-ink-mute mt-1">这些数据只存在这台设备的浏览器里,删掉后无法恢复。</div>
            </div>
          </div>

          <label className="flex items-start gap-2 rounded-xl border border-ink/10 p-3 cursor-pointer hover:bg-butter-50">
            <input
              type="checkbox"
              checked={alsoAi}
              onChange={(e) => setAlsoAi(e.target.checked)}
              className="mt-0.5 accent-tangerine-500"
            />
            <span className="text-[12.5px] text-ink-soft leading-relaxed">
              <b className="text-ink">同时清除 AI 配置</b>(API Key、接口地址、模型名)
              <br />
              <span className="text-ink-mute">不清的话,换个课表还能接着用同一个 Key。</span>
            </span>
          </label>

          <label className="flex items-start gap-2 rounded-xl border border-ink/10 p-3 cursor-pointer hover:bg-butter-50">
            <input
              type="checkbox"
              checked={alsoChannels}
              onChange={(e) => setAlsoChannels(e.target.checked)}
              className="mt-0.5 accent-tangerine-500"
            />
            <span className="text-[12.5px] text-ink-soft leading-relaxed">
              <b className="text-ink">同时清除提醒通道配置</b>(微信 Key、推送服务地址)
              <br />
              <span className="text-ink-mute">这些里面也存着第三方的密钥。</span>
            </span>
          </label>

          <div className="flex items-center gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              取消
            </Button>
            <Button variant="danger" className="ml-auto" onClick={wipe} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} 确认清空
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
