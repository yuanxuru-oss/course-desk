#!/bin/bash
# 课程桌 CourseDesk —— macOS / Linux 一键启动
cd "$(dirname "$0")" || exit 1

BANNER=''
say() { echo ""; echo "  ╭──────────────────────────────────────────────╮"; echo "  │   课程桌 CourseDesk · 本地已启动              │"; echo "  ╰──────────────────────────────────────────────╯"; echo ""; }

# ---------- 1. Node.js ----------
if command -v node >/dev/null 2>&1; then
  exec node serve.mjs 4173
fi

# ---------- 2. Python 3(macOS 自带 / Linux 一般都有) ----------
for py in python3 python; do
  if command -v "$py" >/dev/null 2>&1; then
    echo ""
    echo "  没检测到 Node.js,改用 $py 启动(无需额外安装)。"
    exec "$py" serve.py 4173
  fi
done

# ---------- 3. 实在没有 ----------
echo ""
echo "  [ 缺少运行环境 ]"
echo ""
echo "  这个包需要用「本地服务器」打开,不能直接双击 index.html。"
echo "  macOS 上装 Node.js:  https://nodejs.org  →  下载 LTS 版"
echo "  或者在「终端」里执行:  xcode-select --install  (装完自带 python3)"
echo ""
read -r -p "  按回车键关闭…"
exit 1
