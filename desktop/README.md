# 桌宠外壳(Windows / macOS / Linux)

把课程桌的小兔做成**真正的桌面宠物**:透明、无边框、置顶、不挡鼠标,眼神跟着你的系统鼠标走。

## 为什么不是 Tauri

Tauri 更小(~5MB),但需要 Rust + MSVC 链接器编译;这个仓库的机器上没装 VC++ 工具链,编译不了。
Electron 自带运行时、而且有现成的**全局鼠标位置** API(`screen.getCursorScreenPoint`),
眼神跟随必须要它 —— 浏览器里拿不到别的窗口上的鼠标坐标。

## 跑起来

```bash
# 1) 首次会下载约 100MB 运行时(国内建议先设镜像)
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/   # PowerShell: $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"

# 2) 启动
npm run desktop
```

默认加载线上的 `#/pet` 页面。本地调试:

```bash
# 一个终端跑前端
npm run dev

# 另一个终端把桌宠指到本地
# PowerShell:
$env:PET_URL="http://localhost:5173/#/pet"; npm run desktop
```

## 它会做什么

| 行为 | 实现 |
|---|---|
| 透明、无边框、置顶、不进任务栏 | `transparent + frame:false + alwaysOnTop('screen-saver') + skipTaskbar` |
| 眼神跟着系统鼠标 | 主进程每 40ms 用 `screen.getCursorScreenPoint()` 推坐标,渲染端换算成 -1~1 让头和眼珠转 |
| 不挡后面的窗口 | 默认 `setIgnoreMouseEvents(true, { forward: true })`;鼠标进到兔子上才临时关掉穿透 |
| 拖得动 | 按住拖动时主进程跟着鼠标 `setPosition`(透明窗没有标题栏,不能靠系统拖) |
| 点一下会蹦 | 渲染端计数,3D 里播一次跳跃 |
| 双击打开课程桌 / 右键菜单 | `shell.openExternal` + 原生 `Menu` |

## 文件

```
desktop/
  main.cjs     主进程:窗口、全局鼠标轮询、拖拽、右键菜单
  preload.cjs  只暴露必要接口(contextIsolation 开着,页面拿不到 Node)
```

## 已知限制

- 窗口透明、置顶是**操作系统级**的能力,只有套壳能给;纯网页版只能做到「页面内悬浮」。
- Windows 上拖动是主进程跟随鼠标实现的,快速甩动时会有轻微延迟(系统级 `-webkit-app-region: drag` 会和点击冲突,所以没用)。
- 开机自启、打包成 exe 还没做;需要的话下一步加 `electron-builder`。
