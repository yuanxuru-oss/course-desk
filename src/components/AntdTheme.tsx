import type { ReactNode } from 'react'
import { ConfigProvider, App as AntApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'

/**
 * Ant Design 的主题桥接。
 *
 * 只把「交互控件」(下拉、浮层、空状态、弹窗、消息)换成 antd,
 * 但把它的默认蓝白换成课程桌的米黄 + 橘色,这样放进现有页面不突兀。
 */
export function AntdTheme({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#E5763A',
          colorInfo: '#E5763A',
          colorSuccess: '#4FA35E',
          colorWarning: '#E8B733',
          colorError: '#BC5F4E',
          colorText: '#241F1A',
          colorTextSecondary: '#5B5249',
          colorTextTertiary: '#9A8F84',
          colorBgContainer: '#FFFDF5',
          colorBgElevated: '#FFFDF5',
          colorBorder: 'rgba(36,31,26,0.14)',
          colorBorderSecondary: 'rgba(36,31,26,0.08)',
          borderRadius: 14,
          borderRadiusLG: 20,
          fontFamily:
            'Fredoka, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
          fontSize: 13,
          controlHeight: 34,
          boxShadowSecondary: '4px 4px 0 0 rgba(36,31,26,.10)',
        },
        components: {
          Select: {
            optionSelectedBg: '#FFE6D6',
            optionActiveBg: '#FFF4ED',
            selectorBg: '#FFFDF5',
          },
          Segmented: {
            itemSelectedBg: '#E5763A',
            itemSelectedColor: '#FFFFFF',
            trackBg: 'rgba(36,31,26,0.06)',
          },
          Popover: { colorBgElevated: '#FFFDF5' },
          Tooltip: { colorBgSpotlight: '#241F1A' },
          Checkbox: { colorPrimary: '#E5763A' },
          Empty: { colorTextDescription: '#9A8F84' },
          Modal: { contentBg: '#FFFDF5', headerBg: '#FFFDF5', titleFontSize: 16 },
          Message: { contentBg: '#FFFDF5' },
        },
      }}
    >
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  )
}
