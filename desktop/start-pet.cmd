@echo off
setlocal
cd /d "%~dp0.."

rem Some environments set ELECTRON_RUN_AS_NODE=1, which makes Electron behave
rem like plain Node (no window). Clear it before launching.
set ELECTRON_RUN_AS_NODE=

if not exist "node_modules\electron\dist\electron.exe" (
  echo [x] Electron runtime not found.
  echo     Run this first in this folder:
  echo       npm.cmd install
  echo.
  pause
  exit /b 1
)

echo Starting CourseDesk pet...
echo The pet window should appear at the bottom-right of your screen.
echo Keep this window open. Close it or press Ctrl+C to stop the pet.
echo.

"node_modules\electron\dist\electron.exe" "desktop\main.cjs"

echo.
echo [pet] exited with code %ERRORLEVEL%
pause
