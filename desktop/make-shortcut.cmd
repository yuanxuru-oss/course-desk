@echo off
rem ============================================================
rem  CourseDesk Pet - create a desktop shortcut
rem
rem  Everything path-related is computed INSIDE PowerShell:
rem    - the desktop folder may contain non-ASCII characters (e.g. 桌面)
rem    - this .cmd itself is ASCII so any console code page works
rem ============================================================
setlocal
cd /d "%~dp0"

if not exist "CourseDeskPet.exe" (
  echo [x] CourseDeskPet.exe not found. Keep this file next to it.
  pause
  exit /b 1
)

set "PET_EXE=%~dp0CourseDeskPet.exe"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$exe = $env:PET_EXE; $dir = Split-Path -Parent $exe; $desktop = [Environment]::GetFolderPath('Desktop'); $lnkPath = Join-Path $desktop 'CourseDeskPet.lnk'; $ws = New-Object -ComObject WScript.Shell; $lnk = $ws.CreateShortcut($lnkPath); if (-not $lnk) { Write-Output '   [x] CreateShortcut returned null'; exit 1 }; $lnk.TargetPath = $exe; $lnk.Arguments = '--no-sandbox'; $lnk.WorkingDirectory = $dir; $lnk.IconLocation = \"$exe,0\"; $lnk.Description = 'CourseDesk Pet'; $lnk.Save(); if (Test-Path $lnkPath) { Write-Output '   [ok] shortcut saved' } else { Write-Output '   [x] save failed' }"

if exist "%USERPROFILE%\Desktop\CourseDeskPet.lnk" (
  echo [ok] Desktop shortcut created: CourseDeskPet.lnk
) else (
  echo [i] Check your desktop for CourseDeskPet.lnk
  echo     If it is missing, just double-click 启动桌宠.cmd each time.
)

echo.
pause
