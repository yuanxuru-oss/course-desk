@echo off
setlocal
cd /d "%~dp0"

echo Creating startup shortcut for CourseDesk pet...
echo.

set "VBS=%~dp0start-pet.vbs"
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\CourseDeskPet.lnk"

if not exist "%VBS%" (
  echo [x] start-pet.vbs not found.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('%LNK%'); $s.TargetPath = '%VBS%'; $s.WorkingDirectory = '%~dp0..'; $s.Description = 'CourseDesk pet'; $s.Save()"

if exist "%LNK%" (
  echo [ok] Added to startup:
  echo      %LNK%
  echo.
  echo The pet will start automatically the next time you sign in.
) else (
  echo [x] Failed to create the shortcut.
)

echo.
pause
