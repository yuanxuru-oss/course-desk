@echo off
setlocal
cd /d "%~dp0.."

echo === CourseDesk pet diagnostics ===
echo.

echo [1] Environment
echo     ELECTRON_RUN_AS_NODE=%ELECTRON_RUN_AS_NODE%
echo.

echo [2] Electron binary
if exist "node_modules\electron\dist\electron.exe" (
  echo     found: node_modules\electron\dist\electron.exe
) else (
  echo     MISSING - run: npm.cmd install
)
echo.

echo [3] Electron version ^(should print a version number^)
set ELECTRON_RUN_AS_NODE=
"node_modules\electron\dist\electron.exe" --version
echo.

echo [4] Page reachable?
"node_modules\electron\dist\electron.exe" -e "fetch('https://yuanxuru-oss.github.io/course-desk/').then(r=>console.log('     HTTP',r.status)).catch(e=>console.log('     ERR',e.message))"
echo.

echo Done. If [3] prints nothing, the runtime is broken - reinstall with the mirror.
pause
