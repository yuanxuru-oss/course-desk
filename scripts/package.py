#!/usr/bin/env python3
"""
打包课程桌:源码包 + 部署包

为什么不用命令行 zip:
  Info-ZIP 存中文文件名时**不设 UTF-8 标志位(bit 0x800)**,
  Windows 资源管理器 / 7-Zip / Python 解压后文件名会变成乱码
  (启动课程桌.bat → σÉ»σè¿Φ»╛τ¿ïµíî.bat),用户根本认不出哪个是启动器。
  Python 的 zipfile 对非 ASCII 文件名会自动设这个标志位,各平台都正常。

用法:
  python3 scripts/package.py
  输出:
    output/课程桌-CourseDesk-源码.zip
    output/课程桌-CourseDesk-部署包.zip
"""
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # 项目根(course-desk)
PARENT = os.path.dirname(ROOT)                                      # 上一级(放 output/ 的地方)
OUT = os.path.join(PARENT, 'output')
DIST = os.path.join(ROOT, 'dist')

SRC_ZIP = os.path.join(OUT, '课程桌-CourseDesk-源码.zip')
DEPLOY_ZIP = os.path.join(OUT, '课程桌-CourseDesk-部署包.zip')

# 源码包要排除的
SRC_EXCLUDE_DIRS = {'node_modules', '.git', 'dist', 'shots', 'data', '.mavis'}
SRC_EXCLUDE_FILES = {'package-lock.json'}
# 这些是构建时从 node_modules 复制出来的(见 scripts/copy-ocr-assets.mjs),
# 源码包里不用带,体积小一大截。语言包 .gz 是随仓库走的,必须保留。
SRC_EXCLUDE_PATHS = {
    os.path.join('public', 'tesseract', 'worker.min.js'),
    os.path.join('public', 'tesseract', 'tesseract-core-simd-lstm.wasm.js'),
    os.path.join('public', 'tesseract', 'tesseract-core-lstm.wasm.js'),
}


def add_dir(zf, base, prefix=''):
    """把 base 目录下的内容加进 zip,保留可执行位"""
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = sorted(d for d in dirnames if d not in SRC_EXCLUDE_DIRS)
        rel_dir = os.path.relpath(dirpath, base)
        if rel_dir == '.':
            rel_dir = ''
        for fn in sorted(filenames):
            if fn in SRC_EXCLUDE_FILES:
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.normpath(os.path.join(rel_dir, fn))
            if rel in SRC_EXCLUDE_PATHS:
                continue
            arc = os.path.join(prefix, rel) if prefix else rel
            zf.write(full, arc)
            # 保留权限位(macOS 的 .command 需要可执行位)
            mode = os.stat(full).st_mode
            info = zf.getinfo(arc)
            info.external_attr = (mode & 0xFFFF) << 16
            info.create_system = 3  # unix


def build_src():
    with zipfile.ZipFile(SRC_ZIP, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        add_dir(zf, ROOT, 'course-desk')
    return SRC_ZIP


def build_deploy():
    with zipfile.ZipFile(DEPLOY_ZIP, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        add_dir(zf, DIST, '')
    return DEPLOY_ZIP


def verify(path, expect):
    """校验:文件名能正确解码 + 关键文件存在"""
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        bad = [n for n in names if any(ord(c) > 127 for c in n) and n not in expect]
        for n in expect:
            if n not in names:
                print(f'  ✗ 缺少文件:{n}')
                return False
        # 所有非 ASCII 文件名必须带 UTF-8 标志位
        for info in zf.infolist():
            if any(ord(c) > 127 for c in info.filename):
                if not (info.flag_bits & 0x800):
                    print(f'  ✗ 文件名没设 UTF-8 标志位:{info.filename!r}')
                    return False
    return True


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    s = build_src()
    d = build_deploy()

    ok_src = verify(s, ['course-desk/src/App.tsx', 'course-desk/package.json', 'course-desk/README.md'])
    ok_dep = verify(d, [
        'index.html', 'manifest.json', 'sw.js',
        '启动课程桌.bat', '启动课程桌.command', '启动课程桌.ps1',
        'serve.mjs', 'serve.ps1', 'serve.py', '怎么用.txt',
    ])

    for p in (s, d):
        print(f'  {os.path.basename(p):44} {os.path.getsize(p):>9,} bytes')

    print()
    print('  源码包校验:', '✓' if ok_src else '✗')
    print('  部署包校验:', '✓' if ok_dep else '✗')
    if not (ok_src and ok_dep):
        raise SystemExit(1)
