@echo off
setlocal
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\CourseDeskPet.lnk"

if exist "%LNK%" (
  del /q "%LNK%"
  echo [ok] Removed from startup.
) else (
  echo [i] Not in startup - nothing to remove.
)
echo.
pause
