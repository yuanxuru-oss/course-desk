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

/** 桌宠页面(默认线上;本地调式可用 PET_URL=http://localhost:5173/#/pet) */
const PET_URL = process.env.PET_URL || 'https://yuanxuru-oss.github.io/course-desk/#/pet'
const APP_URL = process.env.APP_URL || 'https://yuanxuru-oss.github.io/course-desk/'

const W = 240
const H = 280

let win = null
let tray = null
let cursorTimer = null
let dragOffset = null

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

    // 拖拽中:窗口跟着鼠标走(透明窗没有标题栏,不能靠系统拖)
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

  win.on('closed', () => {
    saveBounds()
    win = null
    if (cursorTimer) clearInterval(cursorTimer)
  })
}

/* ---------- 渲染端 → 主进程 ---------- */
ipcMain.on('pet:interactive', (_e, on) => {
  if (!win || win.isDestroyed()) return
  // 鼠标进到兔子身上 → 关掉穿透,才能拖/点;离开 → 恢复穿透
  win.setIgnoreMouseEvents(!on, { forward: true })
})

ipcMain.on('pet:drag-start', (_e, offset) => {
  dragOffset = { x: Math.round(offset.x), y: Math.round(offset.y) }
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
  app.on('second-instance', () => {
    if (!win) createWindow()
    else {
      win.show()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    createWindow()
    buildTray()
  })
}

// 关掉窗口不退出进程:桌宠要一直活着(退出走托盘或右键菜单)
app.on('window-all-closed', () => {})
app.on('before-quit', () => saveBounds())
