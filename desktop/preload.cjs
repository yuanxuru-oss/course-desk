/**
 * 桌宠外壳的 preload:只暴露几个必要的方法,页面拿不到 Node。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopPet', {
  /** 是否运行在桌面外壳里 —— 页面据此决定要不要开透明背景/全局眼神跟随 */
  isDesktop: true,
  /** 订阅全局鼠标位置(窗口坐标系),返回取消订阅函数 */
  onCursor(cb) {
    const handler = (_e, pos) => cb(pos)
    ipcRenderer.on('pet:cursor', handler)
    return () => ipcRenderer.removeListener('pet:cursor', handler)
  },
  /** 拉取网页推过来的快照(今天的课 / 行程 / 作业) */
  getSnapshot() {
    return ipcRenderer.invoke('pet:get-snapshot')
  },
  /** 网页更新数据后会推新的快照过来 */
  onSnapshot(cb) {
    const handler = (_e, snap) => cb(snap)
    ipcRenderer.on('pet:snapshot', handler)
    return () => ipcRenderer.removeListener('pet:snapshot', handler)
  },
  /** 鼠标是否在兔子身上:决定窗口要不要接收鼠标事件 */
  setInteractive(on) {
    ipcRenderer.send('pet:interactive', !!on)
  },
  dragStart(offset) {
    ipcRenderer.send('pet:drag-start', offset)
  },
  dragEnd() {
    ipcRenderer.send('pet:drag-end')
  },
  menu() {
    ipcRenderer.send('pet:menu')
  },
  quit() {
    ipcRenderer.send('pet:quit')
  },
  openApp() {
    ipcRenderer.send('pet:open-app')
  },
})
