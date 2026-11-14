import { useState } from 'react'
import { Copy, Check, Download, Monitor } from 'lucide-react'
import { Modal as AntModal } from 'antd'
import { Button } from './ui'

interface Props {
  open: boolean
  onClose: () => void
  onToast: (text: string, type?: 'info' | 'success' | 'error') => void
}

const RELEASE_URL = 'https://github.com/yuanxuru-oss/course-desk/releases/latest'

/** 桌宠说明:只有桌面版了,这里告诉用户怎么拿到/启动它 */
export function PetGuide({ open, onClose, onToast }: Props) {
  const [copied, setCopied] = useState(false)
  const devPath = 'desktop\\start-pet.vbs'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(devPath)
      setCopied(true)
      onToast('路径已复制', 'success')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      onToast('复制失败,手动选中那行路径吧', 'info')
    }
  }

  return (
    <AntModal open={open} onCancel={onClose} footer={null} width={500} centered title="桌宠">
      <div className="space-y-4 pt-1">
        <div className="rounded-[14px] border border-ink/[0.07] bg-tangerine-50/60 p-3.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Monitor size={14} className="text-tangerine-600" />
            <span className="text-[13px] font-bold text-ink">桌面版</span>
            <span className="ml-auto text-[10.5px] font-bold text-tangerine-600 bg-tangerine-500/12 px-2 py-0.5 rounded-full">
              独立小窗
            </span>
          </div>
          <p className="text-[12px] leading-relaxed text-ink-soft">
            一只浮在桌面上的兔子,<b>浏览器最小化或关掉也还在</b>。眼神跟着整个屏幕的鼠标转,
            能拖、能穿透(不挡你点别的窗口)。网页里不再显示第二只。
          </p>

          <a
            href={RELEASE_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-2.5 flex items-center justify-center gap-1.5 h-9 rounded-[10px] bg-tangerine-500 text-white text-[13px] font-bold hover:bg-tangerine-600 transition-colors"
          >
            <Download size={15} /> 下载桌宠 exe
          </a>
          <p className="mt-1.5 text-[11px] text-ink-mute leading-relaxed">
            下载后双击即可运行,无需安装。想开机自动出现,右键托盘图标勾选「开机自动启动」。
          </p>
        </div>

        <div className="rounded-[14px] border border-ink/[0.07] bg-white/70 p-3.5">
          <div className="text-[12px] font-bold text-ink">从源码运行(开发者)</div>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-white border border-ink/10 px-2.5 py-1.5 text-[11.5px] font-mono text-ink-soft">
              {devPath}
            </code>
            <Button size="sm" variant="secondary" onClick={copy}>
              {copied ? <Check size={13} /> : <Copy size={13} />} 复制
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-ink-mute leading-relaxed">
            在仓库的 <b className="text-ink-soft">desktop</b> 文件夹里双击它。
          </p>
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
