#!/usr/bin/env python3
"""生成课程桌 PWA 图标(Bruna family 色系:陶橘 + 奶黄 + 星星)"""
import math
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'icons')
os.makedirs(OUT, exist_ok=True)

FONT_BOLD = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
if not os.path.exists(FONT_BOLD):
    FONT_BOLD = '/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc'

TANGERINE = (229, 118, 58)  # 主色 陶橘
CHERRY = (188, 95, 78)      # 渐变末端 陶土红
BUTTER = (244, 206, 78)     # 奶黄星
INK = (36, 31, 26)


def rounded_mask(size, radius):
    mask = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size * 4 - 1, size * 4 - 1], radius=radius * 4, fill=255
    )
    return mask.resize((size, size), Image.LANCZOS)


def gradient(size):
    img = Image.new('RGB', (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x * 0.65 + y * 0.35) / (size - 1)
            px[x, y] = (
                int(TANGERINE[0] + (CHERRY[0] - TANGERINE[0]) * t),
                int(TANGERINE[1] + (CHERRY[1] - TANGERINE[1]) * t),
                int(TANGERINE[2] + (CHERRY[2] - TANGERINE[2]) * t),
            )
    return img


def star_points(cx, cy, r_out, r_in, n=5):
    pts = []
    for i in range(n * 2):
        ang = -math.pi / 2 + i * math.pi / n
        r = r_out if i % 2 == 0 else r_in
        pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    return pts


def motif(size):
    """课表格子:奶黄星星 + 白色课程块"""
    s = size * 4
    layer = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    # 顶部奶黄星星
    d.polygon(star_points(int(s * 0.79), int(s * 0.21), int(s * 0.085), int(s * 0.038)), fill=(244, 206, 78, 255))
    # 左下小星(蓝紫)
    d.polygon(star_points(int(s * 0.17), int(s * 0.74), int(s * 0.055), int(s * 0.024)), fill=(123, 146, 220, 235))

    # 课表格子:2x2 白色圆角块
    pad = int(s * 0.215)
    gap = int(s * 0.042)
    block = (s - pad * 2 - gap) // 2
    for i in range(2):
        for j in range(2):
            x = pad + j * (block + gap)
            y = int(s * 0.40) + i * (block + gap)
            alpha = [255, 170, 225, 190][(i * 2 + j)]
            d.rounded_rectangle([x, y, x + block, y + block], radius=int(block * 0.26),
                                fill=(255, 255, 255, alpha))
    return layer.resize((size, size), Image.LANCZOS)


def make_icon(size, maskable=False):
    base = gradient(size).convert('RGBA')
    base = Image.alpha_composite(base, motif(size))

    # 文字
    text = '课'
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    fsize = int(size * (0.38 if not maskable else 0.32))
    font = ImageFont.truetype(FONT_BOLD, fsize)
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - tw) / 2 - bbox[0]
    y = (size - th) / 2 - bbox[1] + int(size * 0.02)

    shadow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).text((x, y + int(size * 0.014)), text, font=font, fill=(0, 0, 0, 105))
    shadow = shadow.filter(ImageFilter.GaussianBlur(size * 0.013))
    base = Image.alpha_composite(base, shadow)
    ImageDraw.Draw(base).text((x, y), text, font=font, fill=(255, 255, 255, 255))

    if maskable:
        inner = base.crop((int(size * 0.1), int(size * 0.1), int(size * 0.9), int(size * 0.9)))
        canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        canvas.paste(inner, (int(size * 0.1), int(size * 0.1)))
        return canvas

    mask = rounded_mask(size, int(size * 0.22))
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(base, (0, 0), mask)
    return out


for size, name in [(192, 'icon-192.png'), (512, 'icon-512.png')]:
    make_icon(size).save(os.path.join(OUT, name), 'PNG')
    print('wrote', name)

make_icon(512, maskable=True).save(os.path.join(OUT, 'icon-maskable-512.png'), 'PNG')
print('wrote icon-maskable-512.png')

svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#E5763A"/>
      <stop offset="1" stop-color="#BC5F4E"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <path fill="#F4CE4E" d="M50 12.6l1.9 4 4.4.6-3.2 3.1.8 4.4-3.9-2-3.9 2 .8-4.4-3.2-3.1 4.4-.6z"/>
  <g fill="#ffffff">
    <rect x="14" y="28" width="16" height="13" rx="4" opacity=".95"/>
    <rect x="34" y="28" width="16" height="13" rx="4" opacity=".72"/>
    <rect x="14" y="45" width="16" height="9" rx="4" opacity=".8"/>
    <rect x="34" y="45" width="16" height="9" rx="4" opacity=".6"/>
  </g>
  <text x="32" y="28" font-size="24" font-weight="bold" text-anchor="middle"
        font-family="PingFang SC, Microsoft YaHei, sans-serif" fill="#fff">课</text>
</svg>
'''
with open(os.path.join(ROOT, 'public', 'favicon.svg'), 'w', encoding='utf-8') as f:
    f.write(svg)
print('wrote favicon.svg')
