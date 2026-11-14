import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { AntdTheme } from './components/AntdTheme'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AntdTheme>
      <App />
    </AntdTheme>
  </React.StrictMode>,
)
