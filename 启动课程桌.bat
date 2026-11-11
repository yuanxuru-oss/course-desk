@echo off
chcp 65001 >nul
title CourseDesk
cd /d "%~dp0"

rem ---------- 1) Node.js(装了的话最快) ----------
where node >nul 2>nul
if not errorlevel 1 (
  node serve.mjs 4173
  goto :end
)

rem ---------- 2) Windows 自带的 PowerShell(不用装任何东西) ----------
where powershell >nul 2>nul
if not errorlevel 1 (
  echo.
  echo   [ CourseDesk ] No Node.js found, using built-in PowerShell instead.
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" 4173
  goto :end
)

rem ---------- 3) 实在没有运行环境 ----------
echo.
echo   [ 需要一个运行环境 ]
echo.
echo   这个包要通过「本地服务器」打开,不能直接双击 index.html。
echo   请双击同一文件夹里的「启动课程桌.bat」重新试一次。
echo.
echo   如果还是不行,请到 https://nodejs.org 下载 LTS 版 Node.js,再双击本文件。
echo.
pause

:end
echo.
echo   服务已停止。
pause
