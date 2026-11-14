import { useEffect, useState } from 'react'
import { Copy, Check, Download, Monitor, Power } from 'lucide-react'
import { Modal as AntModal } from 'antd'
import { Button } from './ui'

interface Props {
  open: boolean
  onClose: () => void
  onToast: (text: string, type?: 'info' | 'success' | 'error') => void
}

const RELEASE_URL = 'https://github.com/yuanxuru-oss/course-desk/releases/latest'
const KEY = 'coursedesk:desktopPetWanted'

/** 调起桌面桌宠:靠自定义协议 coursedesk://,浏览器会先问一次 */
function callProtocol(action: 'open' | 'hide' | 'toggle') {
  try {
    window.location.href = `coursedesk://${action}`
    return true
  } catch {
    return false
  }
}

/**
 * 桌宠开关。
 *
 * 网页不能直接启动本地程序,所以走自定义协议:
 * 点「打开」→ 浏览器询问 → 系统调起桌宠 exe → 桌面上出现小兔。
 * 桌面版第一次运行时会把 coursedesk:// 注册到注册表(不需要管理员)。
 */
export function PetGuide({ open, onClose, onToast }: Props) {
  const [wanted, setWanted] = useState(() => localStorage.getItem(KEY) === '1')
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    localStorage.setItem(KEY, wanted ? '1' : '0')
  }, [wanted])

  const toggle = (next: boolean) => {
    setWanted(next)
    setPending(true)
    // 打开时让 App 立刻推一次快照(否则要等下次数据变化才同步)
    if (next) window.dispatchEvent(new CustomEvent('coursedesk:pet-wanted'))
    const ok = callProtocol(next ? 'open' : 'hide')
    if (!ok) {
      onToast('这台设备还没安装桌宠,先下载一个吧', 'info')
      setPending(false)
      return
    }
    // 浏览器不会告诉我们协议是否被处理;给个兜底提示
    setTimeout(() => {
      setPending(false)
      onToast(
        next ? '已请求打开桌面桌宠 —— 没反应的话,说明还没安装(下面有下载)' : '已请求隐藏桌面桌宠',
        'info',
      )
    }, 1600)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText('desktop\\start-pet.vbs')
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
          <div className="flex items-center gap-1.5">
            <Monitor size={14} className="text-tangerine-600" />
            <span className="text-[13px] font-bold text-ink">桌面桌宠</span>
            <span className="ml-auto text-[10.5px] font-bold text-tangerine-600 bg-tangerine-500/12 px-2 py-0.5 rounded-full">
              独立小窗
            </span>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-soft">
            一只浮在桌面上的兔子,<b>浏览器最小化或关掉也还在</b>,眼神跟着整个屏幕的鼠标转。
            打开下面这个开关,就会调起桌面版(第一次浏览器会问一句「是否打开」)。
          </p>

          <button
            onClick={() => toggle(!wanted)}
            disabled={pending}
            className={
              'mt-3 w-full flex items-center justify-center gap-2 h-10 rounded-[10px] text-[13px] font-bold transition-colors ' +
              (wanted
                ? 'bg-ink/[0.06] text-ink-soft hover:bg-ink/[0.09]'
                : 'bg-tangerine-500 text-white hover:bg-tangerine-600')
            }
          >
            <Power size={15} />
            {pending ? '正在唤起…' : wanted ? '已打开 · 点此隐藏' : '打开桌面桌宠'}
          </button>

          <p className="mt-2 text-[11px] text-ink-mute leading-relaxed">
            没反应?通常是还没安装 —— 点下面的下载,解压后先双击一次「启动桌宠.cmd」完成注册,之后这个开关就能用了。
          </p>

          <a
            href={RELEASE_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-2 flex items-center justify-center gap-1.5 h-9 rounded-[10px] border border-tangerine-500/30 text-tangerine-700 text-[12.5px] font-bold hover:bg-tangerine-500/8 transition-colors"
          >
            <Download size={14} /> 下载桌宠(Windows x64)
          </a>
        </div>

        <div className="rounded-[14px] border border-ink/[0.07] bg-white/70 p-3.5">
          <div className="text-[12px] font-bold text-ink">从源码运行(开发者)</div>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-white border border-ink/10 px-2.5 py-1.5 text-[11.5px] font-mono text-ink-soft">
              desktop\start-pet.vbs
            </code>
            <Button size="sm" variant="secondary" onClick={copy}>
              {copied ? <Check size={13} /> : <Copy size={13} />} 复制
            </Button>
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
