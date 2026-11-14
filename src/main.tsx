import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { AntdTheme } from './components/AntdTheme'
import './index.css'

/*
 * 字体尽早开始下载:虽然 CSS 里的 @font-face 会在首次用到时拉取,
 * 但首屏数字仍可能先闪一下回退字体。这里主动 load 一次,配合 index.html 的 preload。
 */
if (typeof document !== 'undefined' && document.fonts) {
  document.fonts.load('600 16px Inter').catch(() => {})
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AntdTheme>
      <App />
    </AntdTheme>
  </React.StrictMode>,
)
