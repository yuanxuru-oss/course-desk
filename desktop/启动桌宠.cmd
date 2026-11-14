@echo off
chcp 65001 >nul
cd /d "%~dp0.."

echo 正在启动桌宠…
echo.

if not exist "node_modules\electron\dist\electron.exe" (
  echo [x] 找不到 Electron 运行时。
  echo     请先在这个目录打开终端执行: npm install
  echo     如果下载很慢,先设镜像:
  echo       set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
  echo       npm install
  echo.
  pause
  exit /b 1
)

rem 有些环境会把这个变量设成 1,那会让 Electron 退化成普通 Node,窗口起不来
set ELECTRON_RUN_AS_NODE=

start "" "node_modules\electron\dist\electron.exe" "desktop\main.cjs"
exit /b 0
