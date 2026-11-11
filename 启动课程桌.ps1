# 课程桌 CourseDesk —— 本地服务器(PowerShell 版,Windows 自带,无需安装任何东西)
#
# 用法:powershell -ExecutionPolicy Bypass -File 启动课程桌.ps1 [端口]

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 4173
if ($args.Count -ge 1) { $port = [int]$args[0] }

# MIME 类型
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
  '.ico'  = 'image/x-icon'
  '.woff2' = 'font/woff2'
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
  if (-not $full.StartsWith([System.IO.Path]::GetFullPath($root))) { return $null }
  return $full
}

$listener = $null
for ($i = 0; $i -lt 20; $i++) {
  try {
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$port/")
    $listener.Start()
    break
  } catch {
    if ($i -eq 19) {
      Write-Host ''
      Write-Host '  端口都被占用了,请关掉别的程序再试。' -ForegroundColor Yellow
      Read-Host '  按回车关闭'
      exit 1
    }
    $port++
  }
}

$url = "http://localhost:$port/"
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

Start-Process $url

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
