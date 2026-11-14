@echo off
rem ============================================================
rem  CourseDesk Pet launcher
rem  1) register coursedesk:// so the web page can open / sync it
rem  2) start with --no-sandbox (Chromium sandbox fails on some PCs)
rem ============================================================
setlocal
cd /d "%~dp0"

if not exist "CourseDeskPet.exe" (
  echo [x] CourseDeskPet.exe not found. Keep this file next to it.
  pause
  exit /b 1
)

reg add "HKCU\Software\Classes\coursedesk" /ve /d "URL:CourseDesk Pet" /f >nul 2>&1
reg add "HKCU\Software\Classes\coursedesk" /v "URL Protocol" /d "" /f >nul 2>&1
reg add "HKCU\Software\Classes\coursedesk\shell\open\command" /ve /d "\"%~dp0CourseDeskPet.exe\" --no-sandbox \"%%1\"" /f >nul 2>&1
if errorlevel 1 (echo [i] protocol register failed) else (echo [ok] coursedesk:// registered)

start "" "%~dp0CourseDeskPet.exe" --no-sandbox
exit /b 0
