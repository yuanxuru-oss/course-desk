#!/usr/bin/env node
/**
 * 课程桌 CourseDesk —— 零依赖本地服务器
 *
 * 用法:node serve.mjs [端口]
 * 双击「启动课程桌.bat」(Windows)或「启动课程桌.command」(macOS)会自动跑它。
 *
 * 为什么不能直接双击 index.html:
 *   file:// 不是安全上下文,浏览器不会注册 Service Worker,
 *   也就没有「安装到桌面」按钮、离线能力和网页通知。
 *   localhost 算安全上下文,所以必须通过这个脚本打开。
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const START_PORT = Number(process.argv[2] || process.env.PORT || 4173)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.gz': 'application/gzip',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost')
    let pathname = decodeURIComponent(url.pathname)
    if (pathname.endsWith('/')) pathname += 'index.html'

    let file = path.join(ROOT, path.normalize(pathname).replace(/^([/\\])+/, ''))
    if (!file.startsWith(ROOT)) {
      res.writeHead(403)
      return res.end('Forbidden')
    }
    // 单页应用:找不到就回退到 index.html
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(ROOT, 'index.html')
    }
    if (!fs.existsSync(file)) {
      res.writeHead(404)
      return res.end('index.html 不存在,请确认解压完整')
    }

    const body = fs.readFileSync(file)
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/',
    })
    res.end(body)
  } catch (err) {
    res.writeHead(500)
    res.end(String(err))
  }
})

/** 端口被占用就往后找 */
function listen(port, attempt = 0) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < 20) {
      listen(port + 1, attempt + 1)
    } else {
      console.error('启动失败:', err.message)
      process.exit(1)
    }
  })
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/`
    console.log('')
    console.log('  ╭──────────────────────────────────────────────╮')
    console.log('  │   课程桌 CourseDesk · 本地已启动             │')
    console.log('  ╰──────────────────────────────────────────────╯')
    console.log('')
    console.log(`  ▸ 打开这个地址:  ${url}`)
    console.log('')
    console.log('  ▸ 装成桌面 App:')
    console.log('      Chrome / Edge → 地址栏右侧的「安装」图标 → 安装')
    console.log('      Safari(macOS)→ 文件 → 添加到程序坞')
    console.log('')
    console.log('  ▸ 装完会有独立图标、全屏窗口、离线可用、通知可用。')
    console.log('  ▸ 关掉这个窗口就停止服务(装了 App 之后可从这里关闭)。')
    console.log('')
    openBrowser(url)
  })
}

function openBrowser(url) {
  try {
    if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
    } else if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
    }
  } catch {
    /* 打不开就算了,手动复制地址也行 */
  }
}

listen(START_PORT)
