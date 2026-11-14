#!/usr/bin/env python3
"""
课程桌 CourseDesk —— 本地服务器(Python 兜底版,只用标准库)

macOS / Linux 上如果没装 Node.js,「启动课程桌.command」会自动调用这个脚本。
用法:python3 serve.py [端口]
"""
import http.server
import os
import socketserver
import sys
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4173


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.webmanifest': 'application/manifest+json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
        '.woff2': 'font/woff2',
        '.gz': 'application/gzip',
        '.wasm': 'application/wasm',
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # 让 Service Worker 能控制整个站点
        self.send_header('Service-Worker-Allowed', '/')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def send_head(self):
        # 单页应用:找不到就回退到 index.html
        path = self.translate_path(self.path)
        if not os.path.exists(path) or os.path.isdir(path):
            if '.' not in os.path.basename(path):
                self.path = '/index.html'
        return super().send_head()

    def log_message(self, *args):
        pass  # 安静一点


def main():
    global PORT
    for attempt in range(20):
        try:
            socketserver.TCPServer.allow_reuse_address = True
            with socketserver.TCPServer(('127.0.0.1', PORT), Handler) as httpd:
                url = f'http://localhost:{PORT}/'
                print('')
                print('  ╭──────────────────────────────────────────────╮')
                print('  │   课程桌 CourseDesk · 本地已启动(Python)     │')
                print('  ╰──────────────────────────────────────────────╯')
                print('')
                print(f'  ▸ 打开这个地址:  {url}')
                print('')
                print('  ▸ 装成桌面 App:')
                print('      Chrome / Edge → 地址栏右侧的「安装」图标 → 安装')
                print('      Safari(macOS)→ 文件 → 添加到程序坞')
                print('')
                print('  ▸ 关掉这个窗口就停止服务。')
                print('')
                try:
                    webbrowser.open(url)
                except Exception:
                    pass
                httpd.serve_forever()
                return
        except OSError:
            PORT += 1
    print('  端口都被占用了,请关掉别的程序再试。')
    input()


if __name__ == '__main__':
    main()
