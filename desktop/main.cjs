/**
 * 桌宠外壳(Electron)。
 *
 * 为什么要外壳:浏览器窗口一最小化,页面里的 DOM 就画不出来了。
 * 想让小兔「一直在桌面上」,必须有一个**独立、透明、置顶**的小窗。
 *
 * 为什么用 Electron 而不是 Tauri:
 *   - 这台机器有 Rust,但没装 MSVC 链接器,编译不了 Tauri;
 *   - Electron 自带运行时,而且有现成的全局鼠标位置 API(screen.getCursorScreenPoint),
 *     眼神跟随必须要它 —— 浏览器里拿不到别的窗口上的鼠标坐标。
 *
 * 窗口特性:透明、无边框、置顶、不进任务栏、可拖、平时不挡鼠标(鼠标穿透)。
 * 关掉浏览器 / 最小化浏览器都不影响它;托盘图标可以随时唤起或退出。
 */
const { app, BrowserWindow, Menu, Tray, screen, ipcMain, shell, nativeImage } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

/*
 * 有人在环境里设了 ELECTRON_RUN_AS_NODE,那会让 Electron 退化成纯 Node:
 * 这时 require('electron') 只返回一个路径字符串,ipcMain / app 全是 undefined。
 * 这时候窗口当然起不来,所以这里给出明确提示,而不是抛一句看不懂的 TypeError。
 */
if (!ipcMain || !app) {
  console.error('[pet] Electron 没有以 GUI 模式启动(环境里有 ELECTRON_RUN_AS_NODE)')
  console.error('[pet] 请双击 desktop\\start-pet.cmd,或先执行: $env:ELECTRON_RUN_AS_NODE=""')
  process.exit(1)
}

/*
 * 有些受限环境(只读 AppData / 沙箱)里写不了默认的 userData,
 * 会连带单实例锁、GPU 缓存全部失败。允许用 PET_USERDATA 指定一个可写目录。
 */
if (process.env.PET_USERDATA) {
  try {
    app.setPath('userData', process.env.PET_USERDATA)
  } catch (err) {
    console.error('[pet] 设置 userData 失败:', err.message)
  }
}

/* 打包后没有控制台,设 PET_LOG=<文件> 就能把启动过程写下来,方便排查 */
const LOG_FILE = process.env.PET_LOG || ''
function log(...args) {
  if (!LOG_FILE) return
  try {
    require('node:fs').appendFileSync(LOG_FILE, '' + new Date().toISOString() + ' ' + args.join(' ') + '\n')
  } catch {}
}

process.on('uncaughtException', (err) => {
  log('[致命]', err && err.stack ? err.stack : String(err))
})
process.on('unhandledRejection', (err) => {
  log('[未处理 Promise]', err && err.stack ? err.stack : String(err))
})

log('[启动] version=', app.getVersion(), 'packaged=', app.isPackaged)

/*
 * 有些机器(装了某些安全软件 / 组策略)上 Chromium 的沙箱进程起不来,
 * 表现是双击后进程瞬间退出、退出码 -2147483645(STATUS_BREAKPOINT)。
 * 在命令行加 --no-sandbox 就好了,但双击 exe 没法带参数,所以这里在应用内补上。
 */
if (!process.argv.includes('--no-sandbox') && !process.argv.includes('--enable-sandbox')) {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
  log('[启动] 已内置 no-sandbox')
}

/** 桌宠页面(默认线上;本地调式可用 PET_URL=http://localhost:5173/#/pet) */
const PET_URL = process.env.PET_URL || 'https://yuanxuru-oss.github.io/course-desk/#/pet'
const APP_URL = process.env.APP_URL || 'https://yuanxuru-oss.github.io/course-desk/'

const W = 240
const H = 280

let win = null
let tray = null
let cursorTimer = null
let dragOffset = null
let dragStamp = 0

/*
 * 自定义协议 coursedesk://
 *
 * 网页没法直接启动本地程序(浏览器安全限制),标准做法是注册一个协议:
 * 网页里点开关 → 浏览器问一次「是否打开课程桌桌宠」→ 系统调起这个 exe。
 * 只在 HKCU 下写注册表,不需要管理员权限。
 */
const PROTOCOL = 'coursedesk'

function registerProtocol() {
  // 先试 Electron 自带 API(打包后一般能成)
  try {
    const ok = process.defaultApp
      ? app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])])
      : app.setAsDefaultProtocolClient(PROTOCOL)
    log('[协议] setAsDefaultProtocolClient =', ok)
    if (ok && process.platform !== 'win32') return
  } catch (err) {
    log('[协议] API 出错', err.message)
  }

  /*
   * Electron 的 API 在便携版 / 某些环境里会返回 false 且什么都不写,
   * 所以直接自己写 HKCU\Software\Classes(不需要管理员权限)。
   */
  if (process.platform !== 'win32') return
  try {
    const { execFileSync } = require('node:child_process')
    const exe = process.execPath
    const base = 'HKCU\\Software\\Classes\\' + PROTOCOL
    const cmd = '"' + exe + '" --no-sandbox "%1"'
    execFileSync('reg', ['add', base, '/ve', '/d', 'URL:CourseDesk Pet', '/f'], { stdio: 'ignore' })
    execFileSync('reg', ['add', base, '/v', 'URL Protocol', '/d', '', '/f'], { stdio: 'ignore' })
    execFileSync('reg', ['add', base + '\\shell\\open\\command', '/ve', '/d', cmd, '/f'], { stdio: 'ignore' })
    log('[协议] 已写入注册表:', base)
  } catch (err) {
    log('[协议] 写注册表失败', err.message)
  }
}

/** 快照文件:网页推过来的「今天要看的东西」 */
const snapshotFile = () => path.join(app.getPath('userData'), 'pet-snapshot.json')

function saveSnapshot(snap) {
  try {
    fs.writeFileSync(snapshotFile(), JSON.stringify(snap), 'utf8')
    log('[快照] 已保存 week=', snap.week, 'courses=', (snap.today || []).length, 'events=', (snap.events || []).length)
    if (win && !win.isDestroyed()) win.webContents.send('pet:snapshot', snap)
  } catch (err) {
    log('[快照] 保存失败', err.message)
  }
}

function loadSnapshot() {
  try {
    return JSON.parse(fs.readFileSync(snapshotFile(), 'utf8'))
  } catch {
    return null
  }
}

/** 处理 coursedesk://open | hide | toggle | sync?d=... */
function handleUrl(raw) {
  if (!raw || !raw.startsWith(PROTOCOL + '://')) return
  const body = raw.slice(PROTOCOL.length + 3)
  const [actionRaw, query] = body.split('?')
  const action = (actionRaw || 'open').replace(/\/+$/, '').toLowerCase()

  if (action === 'sync') {
    try {
      const d = new URLSearchParams(query || '').get('d') || ''
      const b64 = d.replace(/-/g, '+').replace(/_/g, '/')
      const json = Buffer.from(b64, 'base64').toString('utf8')
      saveSnapshot(JSON.parse(json))
    } catch (err) {
      log('[快照] 解析失败', err.message)
    }
    return
  }

  log('[协议] 收到', action)
  if (!win) createWindow()
  if (action === 'hide') win.hide()
  else if (action === 'toggle') (win.isVisible() ? win.hide() : win.show())
  else {
    win.show()
    win.focus()
  }
}

/* ---------------- 位置记忆:关掉再开还在上次的地方 ---------------- */
const stateFile = () => path.join(app.getPath('userData'), 'pet-window.json')

function loadBounds() {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
    if (Number.isFinite(raw.x) && Number.isFinite(raw.y)) return raw
  } catch {}
  return null
}

function saveBounds() {
  if (!win || win.isDestroyed()) return
  try {
    const b = win.getBounds()
    fs.writeFileSync(stateFile(), JSON.stringify({ x: b.x, y: b.y }), 'utf8')
  } catch {}
}

function defaultBounds() {
  const { workArea } = screen.getPrimaryDisplay()
  return {
    x: workArea.x + workArea.width - W - 40,
    y: workArea.y + workArea.height - H - 20,
  }
}

/* ---------------- 托盘:不上任务栏,但随时能找到它 ---------------- */
function buildTray() {
  const iconPath = path.join(__dirname, '..', 'public', 'icons', 'icon-192.png')
  let img = nativeImage.createFromPath(iconPath)
  if (img.isEmpty()) img = nativeImage.createEmpty()

  try {
    tray = new Tray(img.resize({ width: 16, height: 16 }))
  } catch (err) {
    console.error('[pet] 托盘创建失败(不影响桌宠本体):', err.message)
    return
  }

  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏桌宠', click: () => togglePet() },
    { label: '打开课程桌', click: () => shell.openExternal(APP_URL) },
    { type: 'separator' },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => setAutoStart(item.checked),
    },
    { type: 'separator' },
    { label: '退出桌宠', click: () => app.quit() },
  ])
  tray.setToolTip('课程桌 · 桌宠')
  tray.setContextMenu(menu)
  tray.on('click', () => togglePet())
}

function setAutoStart(on) {
  // 只有打包后的 exe 才能被系统正确识别;开发模式下退化成提示
  const ok = app.isPackaged
  if (!ok) {
    shell.openExternal(APP_URL)
    return
  }
  app.setLoginItemSettings({ openAtLogin: on, path: process.execPath })
}

function togglePet() {
  if (!win) return createWindow()
  if (win.isVisible()) win.hide()
  else win.show()
}

function createWindow() {
  const bounds = loadBounds() || defaultBounds()

  win = new BrowserWindow({
    width: W,
    height: H,
    x: bounds.x,
    y: bounds.y,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    // 直接显示:等 ready-to-show 的话,页面慢一点窗口就一直不出现,看起来像没启动
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // 默认鼠标穿透:点得到后面的窗口;渲染端发现鼠标在兔子身上时会临时关掉
  win.setIgnoreMouseEvents(true, { forward: true })
  win.loadURL(PET_URL)
  win.once('ready-to-show', () => win.show())

  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('[pet] 页面加载失败', code, desc, PET_URL)
  })

  /* ---------- 日志:出问题时黑窗口里能看出卡在哪一步 ---------- */
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) console.log('[pet:页面]', message, `(${source}:${line})`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[pet] 渲染进程挂了:', details.reason, details.exitCode)
  })
  win.webContents.on('preload-error', (_e, p, err) => {
    console.error('[pet] preload 出错:', p, err)
  })
  win.on('unresponsive', () => console.error('[pet] 窗口无响应'))

  /*
   * 调试用:设 PET_SHOT=路径 会把窗口内容截图存下来(不依赖屏幕捕获,能直接看渲染端画了什么)
   */
  if (process.env.PET_SHOT) {
    setTimeout(async () => {
      try {
        const img = await win.webContents.capturePage()
        fs.writeFileSync(process.env.PET_SHOT, img.toPNG())
        console.log('[pet] 已保存窗口截图:', process.env.PET_SHOT)
      } catch (err) {
        console.error('[pet] 截图失败', err)
      }
      if (process.env.PET_SHOT_EXIT) app.quit()
    }, 6000)
  }

  /*
   * 全局鼠标位置:每 40ms 推一次(25Hz)。
   * 只算相对窗口的坐标,渲染端据此让头和眼珠转向鼠标 —— 这就是「眼神跟随」的数据源。
   */
  cursorTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return
    const p = screen.getCursorScreenPoint()

    /*
     * 拖拽中:窗口跟着鼠标走(透明窗没有标题栏,不能靠系统拖)。
     * 加一个 900ms 的看门狗:鼠标离开窗口时渲染端可能收不到 pointerup,
     * dragOffset 会一直挂着 —— 那就会表现为「桌宠粘着鼠标跑,甩不掉」。
     */
    if (dragOffset && Date.now() - dragStamp > 900) {
      dragOffset = null
      if (!win.isDestroyed()) win.webContents.send('pet:drag-cancel')
    }
    if (dragOffset) {
      win.setPosition(Math.round(p.x - dragOffset.x), Math.round(p.y - dragOffset.y))
    }

    const b = win.getBounds()
    win.webContents.send('pet:cursor', {
      x: p.x - b.x,
      y: p.y - b.y,
      w: b.width,
      h: b.height,
    })
  }, 40)

  let saveTimer = null
  const scheduleSave = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(saveBounds, 400)
  }
  win.on('move', scheduleSave)
  win.on('moved', scheduleSave)

  /*
   * 盯着快照文件:网页可能通过「第二个实例」把新数据写进来(那种情况下
   * 当前窗口收不到 IPC),也可能直接改写文件。每 3 秒对一次修改时间,
   * 变了就推给渲染端刷新气泡。
   */
  let lastSnapMtime = 0
  const snapWatch = setInterval(() => {
    if (!win || win.isDestroyed()) return
    try {
      const st = fs.statSync(snapshotFile())
      if (st.mtimeMs !== lastSnapMtime) {
        lastSnapMtime = st.mtimeMs
        const snap = loadSnapshot()
        if (snap) win.webContents.send('pet:snapshot', snap)
      }
    } catch {}
  }, 3000)
  win.on('closed', () => clearInterval(snapWatch))

  win.on('closed', () => {
    saveBounds()
    win = null
    if (cursorTimer) clearInterval(cursorTimer)
  })
}

/* ---------- 渲染端 → 主进程 ---------- */
ipcMain.handle('pet:get-snapshot', () => loadSnapshot())

ipcMain.on('pet:interactive', (_e, on) => {
  if (!win || win.isDestroyed()) return
  // 鼠标进到兔子身上 → 关掉穿透,才能拖/点;离开 → 恢复穿透
  win.setIgnoreMouseEvents(!on, { forward: true })
})

ipcMain.on('pet:drag-start', (_e, offset) => {
  dragOffset = { x: Math.round(offset.x), y: Math.round(offset.y) }
  dragStamp = Date.now()
})

/* 拖动过程中鼠标每次移动都会续一次命,看门狗据此判断是否还在拖 */
ipcMain.on('pet:drag-move', () => {
  dragStamp = Date.now()
})

ipcMain.on('pet:drag-end', () => {
  dragOffset = null
  saveBounds()
})

ipcMain.on('pet:quit', () => app.quit())

ipcMain.on('pet:open-app', () => {
  shell.openExternal(APP_URL)
})

/* ---------- 右键菜单 ---------- */
ipcMain.on('pet:menu', () => {
  if (!win) return
  Menu.buildFromTemplate([
    { label: '打开课程桌', click: () => shell.openExternal(APP_URL) },
    { label: '隐藏(托盘里还能找回来)', click: () => win.hide() },
    { type: 'separator' },
    { label: '退出桌宠', click: () => app.quit() },
  ]).popup({ window: win })
})

/* ---------- 单实例:重复双击只唤起已有的那只 ---------- */
let gotLock = true
try {
  gotLock = app.requestSingleInstanceLock()
} catch (err) {
  // 写不了锁文件时不要直接退出,否则表现为"双击没反应"
  console.error('[pet] 单实例锁创建失败,继续启动:', err.message)
  gotLock = true
}
if (!gotLock) {
  console.error('[pet] 已经有一只桌宠在运行了')
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const u = argv.find((a) => a.startsWith(PROTOCOL + '://'))
    if (u) handleUrl(u)
    else if (!win) createWindow()
    else {
      win.show()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    registerProtocol()
    const first = process.argv.find((a) => a.startsWith(PROTOCOL + '://'))
    if (first) setTimeout(() => handleUrl(first), 400)
    log('[ready] createWindow')
    try {
      createWindow()
    } catch (err) {
      log('[窗口创建失败]', err && err.stack ? err.stack : String(err))
    }
    try {
      buildTray()
      log('[tray] ok')
    } catch (err) {
      log('[托盘失败]', err && err.stack ? err.stack : String(err))
    }
  })
}

// 关掉窗口不退出进程:桌宠要一直活着(退出走托盘或右键菜单)
app.on('window-all-closed', () => {})
app.on('before-quit', () => saveBounds())
