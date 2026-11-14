# 课程桌 CourseDesk —— 本地服务器(PowerShell 版,Windows 自带,无需安装任何东西)
#
# 用法:powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1 [端口]
#
# 说明:这个文件必须是「UTF-8 with BOM」保存,否则 Windows PowerShell 5.1
#      会按 ANSI 读取,中文全变乱码。

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 4173
if ($args.Count -ge 1) { $port = [int]$args[0] }

# ---------- MIME 类型 ----------
$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.ico'  = 'image/x-icon'
  '.woff2' = 'font/woff2'
  '.gz' = 'application/gzip'
  '.wasm' = 'application/wasm'
  '.txt'  = 'text/plain; charset=utf-8'
}

function Get-ContentType([string]$path) {
  $ext = [System.IO.Path]::GetExtension($path).ToLower()
  if ($mime.ContainsKey($ext)) { return $mime[$ext] }
  return 'application/octet-stream'
}

# 防目录穿越
function Resolve-SafePath([string]$rel) {
  $rel = $rel.TrimStart('/')
  $full = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
  $base = [System.IO.Path]::GetFullPath($root)
  if (-not $full.StartsWith($base)) { return $null }
  return $full
}

# ---------- 找可用端口 & 绑定 ----------
# 端口被占就往后找;localhost 不行就换 127.0.0.1 再试。
$listener = $null
$url = ''
$why = ''
for ($i = 0; $i -lt 20 -and -not $listener; $i++) {
  foreach ($prefix in @("http://localhost:$port/", "http://127.0.0.1:$port/")) {
    try {
      $l = New-Object System.Net.HttpListener
      $l.Prefixes.Add($prefix)
      $l.Start()
      $listener = $l
      $url = "http://localhost:$port/"
      break
    } catch {
      $why = $_.Exception.Message
      try { $l.Close() } catch {}
    }
  }
  if (-not $listener) { $port++ }
}

if (-not $listener) {
  Write-Host ''
  Write-Host '  [ 启动失败 ]' -ForegroundColor Red
  Write-Host "  $why"
  Write-Host ''
  Write-Host '  如果提示权限不足,请右键「启动课程桌.bat」→ 以管理员身份运行。'
  Write-Host '  或者到 https://nodejs.org 装个 LTS 版 Node.js 再双击。'
  Write-Host ''
  Read-Host '  按回车关闭'
  exit 1
}

Write-Host ''
Write-Host '  ╭──────────────────────────────────────────────╮'
Write-Host '  │   课程桌 CourseDesk · 本地已启动              │'
Write-Host '  ╰──────────────────────────────────────────────╯'
Write-Host ''
Write-Host "  ▸ 打开这个地址:  $url"
Write-Host ''
Write-Host '  ▸ 装成桌面 App:'
Write-Host '      Chrome / Edge → 地址栏右侧的「安装」图标 → 安装'
Write-Host ''
Write-Host '  ▸ 关掉这个窗口就停止服务。'
Write-Host ''

try { Start-Process $url } catch {}

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $req = $context.Request
  $res = $context.Response

  try {
    $rel = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)
    $file = Resolve-SafePath $rel

    if (-not $file -or -not (Test-Path -LiteralPath $file)) {
      # 单页应用回退
      $file = Join-Path $root 'index.html'
    }
    if (Test-Path -LiteralPath $file -PathType Container) {
      $file = Join-Path $file 'index.html'
    }
    if (-not (Test-Path -LiteralPath $file)) {
      $res.StatusCode = 404
      $body = [System.Text.Encoding]::UTF8.GetBytes('Not Found')
      $res.ContentType = 'text/plain; charset=utf-8'
      $res.OutputStream.Write($body, 0, $body.Length)
      $res.Close()
      continue
    }

    $bytes = [System.IO.File]::ReadAllBytes($file)
    $res.StatusCode = 200
    $res.ContentType = Get-ContentType $file
    $res.Headers.Add('Cache-Control', 'no-cache')
    $res.Headers.Add('Service-Worker-Allowed', '/')
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.Close()
  } catch {
    try { $res.Close() } catch {}
  }
}
