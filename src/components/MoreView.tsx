import { Upload, Settings as SettingsIcon, Sparkles, Database, Info, ChevronRight, Smartphone } from 'lucide-react'
import type { Course, Settings } from '../types'
import { Card, Eyebrow } from './ui'
import { canInstall, promptInstall, isStandalone, isIOS } from '../lib/pwa'
import { storageEstimate } from '../db'
import { formatBytes } from '../lib/utils'
import { BackupActions } from './BackupActions'
import { BUILD_ID } from '../lib/version'
import { useEffect, useState } from 'react'

interface Props {
  settings: Settings
  onNavigate: (r: 'import' | 'settings') => void
  onToast: (text: string, type?: 'info' | 'success' | 'error') => void
  petVisible: boolean
  onTogglePet: () => void
}

/** 移动端「更多」页:放桌面导航放不下的入口 */
export function MoreView({ settings, onNavigate, onToast, petVisible, onTogglePet }: Props) {
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)
  const [installable, setInstallable] = useState(canInstall())

  useEffect(() => {
    storageEstimate().then(setStorage)
  }, [])

  const items = [
    {
      key: 'import',
      icon: <Upload size={17} />,
      label: '导入课表',
      desc: 'Excel / PDF / 截图,或一句话录入',
      onClick: () => onNavigate('import'),
    },
    {
      key: 'settings',
      icon: <SettingsIcon size={17} />,
      label: '提醒与设置',
      desc: `课程提前 ${settings.courseLeadMinutes} 分钟 · 作业提前 ${settings.homeworkLeadMinutes} 分钟`,
      onClick: () => onNavigate('settings'),
    },
    {
      key: 'pet',
      icon: <Smartphone size={17} />,
      label: petVisible ? '桌宠:开' : '桌宠:关',
      desc: '住在页面右下角的小兔,拖得动、点一下看今日安排',
      onClick: onTogglePet,
    },
    {
      key: 'install',
      icon: <Sparkles size={17} />,
      label: isStandalone() ? '已安装到桌面' : '安装到桌面',
      desc: isStandalone()
        ? '正在以应用模式运行'
        : isIOS()
          ? 'Safari 分享 → 添加到主屏幕'
          : installable
            ? '一键安装为独立应用'
            : '浏览器菜单 → 安装应用',
      onClick: async () => {
        const r = await promptInstall()
        if (r === 'accepted') onToast('安装成功', 'success')
        else if (r === 'unavailable')
          onToast('当前浏览器暂不支持一键安装,可手动用浏览器菜单添加', 'info')
        setInstallable(canInstall())
      },
    },
  ]

  return (
    <div className="space-y-4 pb-24">
      <div>
        <div className="flex items-center gap-2 mb-2.5">
          <Eyebrow tone="butter">工具</Eyebrow>
        </div>
        <h1 className="page-title">更多</h1>
        <p className="page-sub">导入、设置、小组件与数据</p>
      </div>

      <Card className="overflow-hidden">
        <div className="divide-y-2 divide-ink/[0.06]">
          {items.map((it) => (
            <button
              key={it.key}
              onClick={it.onClick}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-butter-50 transition-colors"
            >
              <div className="w-9 h-9 rounded-xl bg-tangerine-50 text-tangerine-600 grid place-items-center shrink-0">
                {it.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink">{it.label}</div>
                <div className="text-[11.5px] text-ink-mute truncate">{it.desc}</div>
              </div>
              <ChevronRight size={16} className="text-ink-mute shrink-0" />
            </button>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-ink/[0.08] flex items-center gap-2">
          <Database size={15} className="text-ink-mute" />
          <h3 className="font-semibold text-ink text-[14px]">备份与迁移</h3>
        </div>
        <div className="p-4 space-y-3">
          {storage && (
            <p className="text-[12px] text-ink-mute">
              本地已用 {formatBytes(storage.usage)}
              {storage.quota > 0 ? ` / 可用约 ${formatBytes(storage.quota)}` : ''}
            </p>
          )}
          <BackupActions onToast={onToast} onImported={() => setTimeout(() => location.reload(), 1600)} />
          <p className="text-[11.5px] text-ink-mute leading-relaxed">
            换手机、换网址、清理浏览器缓存之前,先导出一次;新设备上下载这个 JSON 再导入即可。
          </p>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-ink/[0.08] flex items-center gap-2">
          <Info size={15} className="text-ink-mute" />
          <h3 className="font-semibold text-ink text-[14px]">关于</h3>
        </div>
        <div className="p-4 text-[12.5px] text-ink-soft leading-relaxed space-y-1">
          <p>课程桌 CourseDesk · 大学生电子桌面课程表</p>
          <p className="text-ink-mute">版本 {BUILD_ID} · PWA · 数据本地优先</p>
        </div>
      </Card>
    </div>
  )
}
