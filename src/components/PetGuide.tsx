import { useState } from 'react'
import { Copy, Check, Monitor, Globe } from 'lucide-react'
import { Modal as AntModal } from 'antd'
import { Button, Toggle } from './ui'

interface Props {
  open: boolean
  onClose: () => void
  petVisible: boolean
  onToggleWebPet: () => void
  onToast: (text: string, type?: 'info' | 'success' | 'error') => void
}

/** 桌宠怎么用:桌面版(推荐) vs 网页内(备用),一条路径说清楚 */
export function PetGuide({ open, onClose, petVisible, onToggleWebPet, onToast }: Props) {
  const [copied, setCopied] = useState(false)
  const path = 'desktop\\start-pet.vbs'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(path)
      setCopied(true)
      onToast('路径已复制', 'success')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      onToast('复制失败,手动选中那行路径吧', 'info')
    }
  }

  return (
    <AntModal
      open={open}
      onCancel={onClose}
      footer={null}
      width={520}
      centered
      title="桌宠"
    >
      <div className="space-y-4 pt-1">
        <div className="rounded-[14px] border border-ink/[0.07] bg-tangerine-50/60 p-3.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Monitor size={14} className="text-tangerine-600" />
            <span className="text-[13px] font-bold text-ink">桌面版(推荐)</span>
            <span className="ml-auto text-[10.5px] font-bold text-tangerine-600 bg-tangerine-500/12 px-2 py-0.5 rounded-full">
              独立小窗
            </span>
          </div>
          <p className="text-[12px] leading-relaxed text-ink-soft">
            一只浮在桌面上的兔子,<b>浏览器最小化或关掉也还在</b>。眼神跟着整个屏幕的鼠标转,
            能拖、能穿透(不挡你点别的窗口)。
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-white border border-ink/10 px-2.5 py-1.5 text-[11.5px] font-mono text-ink-soft">
              {path}
            </code>
            <Button size="sm" variant="secondary" onClick={copy}>
              {copied ? <Check size={13} /> : <Copy size={13} />} 复制
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-ink-mute leading-relaxed">
            在仓库的 <b className="text-ink-soft">desktop</b> 文件夹里双击它即可。
            想开机自动出现,双击同目录的 <b className="text-ink-soft">autostart-on.cmd</b>。
          </p>
        </div>

        <div className="rounded-[14px] border border-ink/[0.07] bg-white/70 p-3.5">
          <div className="flex items-center gap-1.5">
            <Globe size={14} className="text-ink-mute" />
            <span className="text-[13px] font-bold text-ink">网页内那只</span>
            <span className="ml-auto text-[10.5px] font-medium text-ink-mute">备用</span>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-soft">
            只在当前页面右下角活动,页面一关就没了。有桌面版的话建议关掉,免得桌面上出现两只。
          </p>
          <div className="mt-1">
            <Toggle checked={petVisible} onChange={onToggleWebPet} label="在网页里也显示一只" />
          </div>
        </div>

        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>
            知道了
          </Button>
        </div>
      </div>
    </AntModal>
  )
}
