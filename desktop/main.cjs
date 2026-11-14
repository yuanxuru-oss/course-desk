/**
 * 桌宠外壳(Electron)。
 *
 * 为什么用 Electron 而不是 Tauri:
 *   - 这台机器有 Rust,但没装 MSVC 链接器,编译不了 Tauri;
 *   - Electron 自带运行时,而且有现成的**全局鼠标位置** API(screen.getCursorScreenPoint),
 *     眼神跟随必须要它 —— 浏览器里拿不到别的窗口上的鼠标坐标。
 *
 * 窗口特性:透明、无边框、置顶、不进任务栏、可拖、平时不挡鼠标(鼠标穿透)。
 */
/* 有人会在环境里设 ELECTRON_RUN_AS_NODE,那会让 Electron 退化成纯 Node,窗口起不来 */
if (process.env.ELECTRON_RUN_AS_NODE) delete process.env.ELECTRON_RUN_AS_NODE

const { app, BrowserWindow, Menu, screen, ipcMain, shell } = require('electron')

if (!process.versions.electron) {
  console.error('[桌宠] 请用 
pm run desktop 启动(当前被当成普通 Node 在跑)')
  process.exit(1)
}
const path = require('node:path')

/** 桌宠页面(默认线上;本地调式可用 PET_URL=http://localhost:5173/#/pet) */
const PET_URL = process.env.PET_URL || 'https://yuanxuru-oss.github.io/course-desk/#/pet'
const APP_URL = process.env.APP_URL || 'https://yuanxuru-oss.github.io/course-desk/'

const W = 240
const H = 280

let win = null
let cursorTimer = null
let dragOffset = null

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay()

  win = new BrowserWindow({
    width: W,
    height: H,
    x: workArea.x + workArea.width - W - 40,
    y: workArea.y + workArea.height - H - 20,
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
    show: false,
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

  /*
   * 全局鼠标位置:每 40ms 推一次(25Hz)。
   * 只算相对窗口的坐标,渲染端据此让眼眶/头转向鼠标 —— 这就是「眼神跟随」的数据源。
   */
  cursorTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return
    const p = screen.getCursorScreenPoint()

    // 拖拽中:窗口跟着鼠标走(而不是让系统处理,透明窗没有标题栏)
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

  win.on('closed', () => {
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
})

ipcMain.on('pet:quit', () => app.quit())

ipcMain.on('pet:open-app', () => {
  shell.openExternal(APP_URL)
})

/* ---------- 右键菜单 ---------- */
function showMenu() {
  Menu.buildFromTemplate([
    { label: '打开课程桌', click: () => shell.openExternal(APP_URL) },
    { type: 'separator' },
    { label: '退出桌宠', click: () => app.quit() },
  ]).popup({ window: win })
}
ipcMain.on('pet:menu', showMenu)

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
