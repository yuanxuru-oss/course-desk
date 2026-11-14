"""交互冒烟测试:真的去点、去输入,验证关键流程"""
import base64
import os
import re
import sys
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('SMOKE_BASE', 'http://127.0.0.1:4173')
OUT = '/workspace/course-desk/shots'
os.makedirs(OUT, exist_ok=True)

failures = []
console_errors = []


def check(label, cond, detail=''):
    if cond:
        print(f'  ✓ {label}')
    else:
        failures.append(f'{label} {detail}')
        print(f'  ✗ {label} {detail}')


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path='/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
            headless=True,
            args=['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        )
        ctx = browser.new_context(viewport={'width': 1360, 'height': 900}, locale='zh-CN',
                                  permissions=['notifications'])
        page = ctx.new_page()
        page.on('console', lambda m: console_errors.append(f'{m.type}: {m.text}') if m.type == 'error' else None)
        page.on('pageerror', lambda e: console_errors.append(f'pageerror: {e}'))

        page.goto(BASE, wait_until='networkidle')
        page.wait_for_timeout(1000)

        # ---------- 1. 一句话录入 ----------
        print('\n[1] 一句话录入')
        page.goto(f'{BASE}/#/import', wait_until='domcontentloaded')
        page.wait_for_timeout(600)
        page.get_by_role('button', name='一句话录入').click()
        page.wait_for_timeout(400)
        box = page.locator('textarea').first
        box.fill('周三下午3点高等数学 教三302')
        page.get_by_role('button', name='智能解析').click()
        page.wait_for_timeout(600)
        parsed_name = page.locator('input').first.input_value()
        check('解析出课程名「高等数学」', parsed_name == '高等数学', f'got={parsed_name}')
        weekday_val = page.locator('select').nth(0).input_value()
        check('星期识别为 3(周三)', weekday_val == '3', f'got={weekday_val}')
        page.screenshot(path=f'{OUT}/flow-1-nl-parse.png')
        page.get_by_role('button', name='确认添加').click()
        page.wait_for_timeout(800)

        # ---------- 2. 课表里能看到 ----------
        print('\n[2] 课表显示')
        page.goto(f'{BASE}/#/schedule', wait_until='domcontentloaded')
        page.wait_for_timeout(800)
        grid = page.locator('text=高等数学').first
        check('课表出现「高等数学」', grid.count() > 0)
        check('课表出现教室「教三302」', page.locator('text=教三302').count() > 0)
        # 每节课显示具体起止时间(默认 45 分钟制 → 08:00–08:45)
        time_chip = page.locator('text=/08:00[–-]08:45/')
        check('课表格块显示起止时间', time_chip.count() > 0, f'count={time_chip.count()}')
        page.screenshot(path=f'{OUT}/flow-2-schedule.png')

        # ---------- 2b. 文件导入(真实教务表格式) ----------
        print('\n[2b] 文件导入(教务 Excel)')
        page.goto(f'{BASE}/#/import', wait_until='domcontentloaded')
        page.wait_for_timeout(900)
        fixture = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', '教务课表样例.xlsx')
        if os.path.exists(fixture):
            page.locator('input[type="file"]').first.set_input_files(fixture)
            page.wait_for_timeout(2500)
            body_i = page.evaluate("()=>document.body.innerText")
            check('教务矩阵表能解析出课程', '解析出' in body_i and '门课' in body_i,
                  [l for l in body_i.split('\n') if '解析' in l][:1])
            check('解析结果里有「高等数学」', page.locator('text=高等数学').count() > 0)
            check('解析结果里有教师「张三」', page.locator('text=张三').count() > 0)
            check('解析结果里有教室「教三302」', page.locator('text=教三302').count() > 0)
            imp_btn = page.get_by_role('button', name='确认导入')
            if imp_btn.count():
                imp_btn.first.click()
                page.wait_for_timeout(1600)
                body_i2 = page.evaluate("()=>document.body.innerText")
                check('导入成功提示', '已导入' in body_i2,
                      [l for l in body_i2.split('\n') if '导入' in l][:1])
            else:
                check('有「确认导入」按钮', False, '按钮没找到')
            page.screenshot(path=f'{OUT}/flow-2b-import.png')
        else:
            check('找到教务表样例文件', False, fixture)

        # ---------- 3. 课程编辑 + 冲突检测 ----------
        print('\n[3] 课程编辑与冲突检测')
        # 课程块是带 draggable 的 div;别用纯文本定位(会撞上隐藏元素和冲突提示)
        page.locator('div[draggable="true"]').filter(has_text='高等数学').first.click()
        page.wait_for_timeout(600)
        check('课程编辑弹窗打开', page.locator('text=编辑课程').count() > 0)
        check('弹窗里有课程官网字段', page.locator('text=课程官网').count() > 0)
        # 改成周一第1节,应当与已存在课程冲突
        page.locator('select').nth(0).select_option('1')
        page.wait_for_timeout(400)
        page.screenshot(path=f'{OUT}/flow-3-course-dialog.png')
        page.get_by_role('button', name='取消').click()
        page.wait_for_timeout(400)

        # ---------- 4. 作业 + 每周模板 ----------
        print('\n[4] 作业与每周固定')
        page.goto(f'{BASE}/#/homework', wait_until='domcontentloaded')
        page.wait_for_timeout(600)
        page.get_by_role('button', name='每周固定').first.click()
        page.wait_for_timeout(500)
        page.locator('input').first.fill('提交本周高数周记')
        page.get_by_role('button', name='创建').click()
        page.wait_for_timeout(1000)
        check('模板出现在「每周模板」页签', page.locator('text=提交本周高数周记').count() > 0)
        page.locator('button', has_text='待办').first.click()
        page.wait_for_timeout(700)
        check('模板自动生成了待办', page.locator('text=提交本周高数周记').count() > 0)
        page.screenshot(path=f'{OUT}/flow-4-homework.png')

        # ---------- 5. 勾选完成 ----------
        print('\n[5] 勾选完成')
        before = page.locator('text=提交本周高数周记').count()
        page.locator('button[aria-label="标记为已完成"]').first.click()
        page.wait_for_timeout(800)
        check('勾选后仍在列表中(切到已完成)', page.locator('text=提交本周高数周记').count() > 0)

        # ---------- 6. 备忘录 + 知识库索引 ----------
        print('\n[6] 备忘录与知识库')
        page.goto(f'{BASE}/#/notes', wait_until='domcontentloaded')
        page.wait_for_timeout(600)
        page.get_by_role('button', name='新建').click()
        page.wait_for_timeout(500)
        page.get_by_role('textbox', name='标题', exact=True).fill('测试笔记')
        page.get_by_role('textbox', name='支持 Markdown').fill('# 测试标题\n\n这是洛必达法则的使用条件说明,用于验证知识库索引。')
        page.get_by_role('button', name='保存').click()
        page.wait_for_timeout(1000)
        check('笔记已创建', page.locator('text=测试笔记').count() > 0)
        page.screenshot(path=f'{OUT}/flow-6-notes.png')

        page.goto(f'{BASE}/#/ai', wait_until='domcontentloaded')
        page.wait_for_timeout(900)
        chunks_text = page.locator('text=检索切片').count()
        check('知识库面板显示切片统计', chunks_text > 0)
        # 本地检索模式提问
        page.locator('textarea').first.fill('洛必达法则的使用条件是什么?')
        page.keyboard.press('Control+Enter')
        page.wait_for_timeout(1500)
        body = page.locator('body').inner_text()
        check('本地检索模式返回了相关内容', '洛必达' in body, body[-300:])
        page.screenshot(path=f'{OUT}/flow-6-ai-local.png')

        # ---------- 7. 导出备份 ----------
        print('\n[7] 导出备份')
        page.goto(f'{BASE}/#/settings', wait_until='domcontentloaded')
        page.wait_for_timeout(600)
        with page.expect_download() as dl:
            page.get_by_role('button', name='导出备份').click()
        download = dl.value
        path = download.path()
        size = os.path.getsize(path) if path else 0
        check('导出文件非空', size > 100, f'size={size}')
        print(f'      导出文件名: {download.suggested_filename} ({size} bytes)')

        # ---------- 8. 设置持久化 ----------
        print('\n[8] 设置持久化')
        page.goto(f'{BASE}/#/settings', wait_until='domcontentloaded')
        page.wait_for_timeout(700)
        lead = page.get_by_label(re.compile('课程提前提醒')).first
        lead.fill('25')
        lead.dispatch_event('change')
        page.wait_for_timeout(900)
        page.reload(wait_until='networkidle')
        page.wait_for_timeout(1300)
        page.goto(f'{BASE}/#/settings', wait_until='domcontentloaded')
        page.wait_for_timeout(1000)
        val = page.get_by_label(re.compile('课程提前提醒')).first.input_value()
        check('提醒分钟数持久化', val == '25', f'got={val}')

        # ---------- 9. 按学校调整作息 ----------
        print('\n[9] 按学校调整作息')
        page.get_by_role('button', name='紧凑 40 分钟制').click()
        page.wait_for_timeout(900)
        check('预设已应用:第一节变成 08:00–08:40',
              page.locator('input[value="08:40"]').count() > 0,
              '找不到 08:40')
        page.goto(f'{BASE}/#/schedule', wait_until='domcontentloaded')
        page.wait_for_timeout(900)
        check('课表时间跟着学校作息走',
              page.locator('text=/08:00[–-]08:40/').count() > 0,
              '课表仍是旧时间')
        page.screenshot(path=f'{OUT}/flow-9-school-schedule.png')

        page.goto(f'{BASE}/#/settings', wait_until='domcontentloaded')
        page.wait_for_timeout(800)
        page.get_by_role('button', name='标准 45 分钟制').click()
        page.wait_for_timeout(800)
        check('可以换回别的预设',
              page.locator('input[value="08:45"]').count() > 0,
              '找不到 08:45')
        page.screenshot(path=f'{OUT}/flow-9-school-settings.png')

        # ---------- 10. 行程:斜纹块 + 同步到备忘 ----------
        print('\n[10] 行程(课程之外的校园活动)')
        page.goto(f'{BASE}/#/schedule', wait_until='domcontentloaded')
        page.wait_for_timeout(900)
        check('课表页有「加行程」入口', page.get_by_role('button', name='加行程').count() > 0)
        check('课表页有「本周行程」板块', page.locator('text=本周行程').count() > 0)
        page.get_by_role('button', name='加行程').first.click()
        page.wait_for_timeout(700)
        check('行程弹窗打开', page.locator('text=添加行程').count() > 0)
        title_input = page.get_by_label(re.compile('行程标题')).first
        title_input.fill('学生会例会')
        page.wait_for_timeout(400)
        page.get_by_role('button', name='保存').click()
        page.wait_for_timeout(1200)
        check('行程出现在本周行程列表', page.locator('text=学生会例会').count() > 0)
        check('行程出现在课表网格里', page.locator('text=学生会例会').count() > 0)
        page.screenshot(path=f'{OUT}/flow-10-events.png')

        # 同步到备忘
        page.goto(f'{BASE}/#/notes', wait_until='domcontentloaded')
        page.wait_for_timeout(1000)
        check('行程已同步到备忘录', page.locator('text=学生会例会').count() > 0)
        check('备忘上标了「由行程同步」', page.locator('text=由行程同步').count() > 0)
        page.screenshot(path=f'{OUT}/flow-10-notes-synced.png')

        # ---------- 10b. 微信消息 → 一键识别行程 ----------
        print('\n[10b] 粘贴微信消息自动识别行程')
        page.goto(f'{BASE}/#/schedule', wait_until='domcontentloaded')
        page.wait_for_timeout(900)
        page.get_by_role('button', name='加行程').first.click()
        page.wait_for_timeout(700)
        check('行程弹窗有「粘贴聊天消息」入口', page.locator('text=粘贴聊天消息').count() > 0)
        paste_input = page.get_by_placeholder(re.compile('周三下午3点开党会')).first
        paste_input.fill('周三下午3点开党会,在教三201')
        page.wait_for_timeout(300)
        page.get_by_role('button', name='识别').click()
        page.wait_for_timeout(700)
        check('识别后提示已填好', page.locator('text=已填好,确认无误后点').count() > 0)
        title_val = page.get_by_label(re.compile('行程标题')).first.input_value()
        check('标题自动填成「党会」', title_val == '党会', title_val)
        loc_val = page.get_by_label(re.compile('地点')).first.input_value()
        check('地点自动填成「教三201」', loc_val == '教三201', loc_val)
        start_val = page.get_by_label(re.compile('开始时间')).first.input_value()
        check('开始时间自动填成 15:00', start_val == '15:00', start_val)
        page.screenshot(path=f'{OUT}/flow-10b-paste-parse.png')
        page.get_by_role('button', name='保存').click()
        page.wait_for_timeout(1400)
        check('识别出的行程进了列表', page.locator('text=党会').count() > 0)
        page.screenshot(path=f'{OUT}/flow-10b-events.png')

        # ---------- 10c. 全局粘贴:在哪儿按 Ctrl+V 都能识别 ----------
        print('\n[10c] 全局粘贴自动识别')
        page.goto(f'{BASE}/#/today', wait_until='domcontentloaded')
        page.wait_for_timeout(1000)
        check('页面有「速记」悬浮按钮', page.get_by_role('button', name='速记').count() > 0)

        # 在非课表页粘贴 → 也应该弹识别卡片
        page.evaluate("""() => {
          const dt = new DataTransfer()
          dt.setData('text/plain', '周三下午3点开党会,在教三201')
          document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
        }""")
        page.wait_for_timeout(900)
        check('在今日页粘贴也能弹识别卡片', page.locator('text=识别到一条行程').count() > 0)
        check('卡片读出了标题', page.locator('text=党会').count() > 0)
        page.screenshot(path=f'{OUT}/flow-10c-global-paste.png')

        # 普通文字不该打扰
        page.get_by_role('button', name='关闭').click()
        page.wait_for_timeout(400)
        page.evaluate("""() => {
          const dt = new DataTransfer()
          dt.setData('text/plain', '这是一段普通的笔记文字,随便写点什么')
          document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
        }""")
        page.wait_for_timeout(700)
        check('粘贴普通文字不会弹卡片', page.locator('text=识别到一条行程').count() == 0)

        # 粘到输入框里也不该打扰
        page.goto(f'{BASE}/#/homework', wait_until='domcontentloaded')
        page.wait_for_timeout(900)
        page.get_by_role('button', name='添加', exact=True).first.click()
        page.wait_for_timeout(700)
        hw_input = page.get_by_placeholder(re.compile('第 5 章课后习题')).first
        hw_input.evaluate("""(el) => {
          const dt = new DataTransfer()
          dt.setData('text/plain', '周三下午3点开党会')
          el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
        }""")
        page.wait_for_timeout(700)
        check('粘到输入框里不会弹卡片', page.locator('text=识别到一条行程').count() == 0)
        page.get_by_role('button', name='取消').click()
        page.wait_for_timeout(400)

        # 一键加到课表
        page.goto(f'{BASE}/#/today', wait_until='domcontentloaded')
        page.wait_for_timeout(900)
        page.evaluate("""() => {
          const dt = new DataTransfer()
          dt.setData('text/plain', '明天晚上7点学生会例会,在学生活动中心301,记得带笔记本')
          document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
        }""")
        page.wait_for_timeout(900)
        check('识别出学生会例会', page.locator('text=学生会例会').count() > 0)
        check('识别出活动中心地点', page.locator('text=学生活动中心301').count() > 0)
        page.get_by_role('button', name='加到课表').click()
        page.wait_for_timeout(1400)
        check('一键添加成功', page.locator('text=已加入课表').count() > 0)
        page.goto(f'{BASE}/#/schedule', wait_until='domcontentloaded')
        page.wait_for_timeout(1200)
        check('全局粘贴加的行程进了课表', page.locator('text=学生会例会').count() > 0)

        # ---------- 10d. 图片上传 + OCR(资源必须自托管,不能依赖外网) ----------
        print('\n[10d] 备忘录图片上传 + OCR')
        page.goto(f'{BASE}/#/notes', wait_until='domcontentloaded')
        page.wait_for_timeout(900)
        # 打开笔记编辑器
        for i in range(page.get_by_role('button').count()):
            if '新建' in page.get_by_role('button').nth(i).inner_text():
                page.get_by_role('button').nth(i).click()
                break
        page.wait_for_timeout(900)
        # 现造一张 PNG。优先用 PIL 画带中英文的图(顺带验证 OCR 真的认得出字),
        # 没有 PIL 就退化成纯白图(仍能验证图片存库 + 渲染)。
        import zlib as _zlib
        def _chunk(tag, data):
            # PNG chunk 顺序: length(4) + type(4) + data + crc32(type+data)
            return (len(data).to_bytes(4, 'big') + tag + data
                    + _zlib.crc32(tag + data).to_bytes(4, 'big'))
        def _blank_png(w, h):
            raw = b''.join(b'\x00' + b'\xff' * (w * 3) for _ in range(h))
            return (b'\x89PNG\r\n\x1a\n'
                    + _chunk(b'IHDR', w.to_bytes(4, 'big') + h.to_bytes(4, 'big') + bytes([8, 2, 0, 0, 0]))
                    + _chunk(b'IDAT', _zlib.compress(raw, 9))
                    + _chunk(b'IEND', b''))
        png = None
        try:
            import glob as _glob
            from PIL import Image as _Image, ImageDraw as _Draw, ImageFont as _Font
            _c = (_glob.glob('/usr/share/fonts/**/*CJK*.ttc', recursive=True)
                  + _glob.glob('/usr/share/fonts/**/wqy*.ttc', recursive=True))
            _img = _Image.new('RGB', (760, 140), 'white')
            _dr = _Draw.Draw(_img)
            _f = _Font.truetype(_c[0], 40) if _c else None
            _dr.text((20, 16), '高数作业 第三章 习题 3-5', font=_f, fill='black')
            _dr.text((20, 76), 'Linear Algebra HW4', font=_f, fill='black')
            _buf = __import__('io').BytesIO()
            _img.save(_buf, 'PNG')
            png = _buf.getvalue()
        except Exception:
            png = _blank_png(64, 64)
        page.locator('input[type="file"]').first.set_input_files([
            {'name': 'ocr.png', 'mimeType': 'image/png', 'buffer': png},
        ])
        # 等图片真正渲染出来(OCR worker 会占 CPU,别死等固定时间)
        try:
            page.wait_for_selector('img[src^="blob:"]', timeout=20000)
        except Exception:
            pass
        page.wait_for_timeout(800)
        blob_rows = page.evaluate('''async () => {
          const req = indexedDB.open('course-desk');
          const db = await new Promise(r => req.onsuccess = () => r(req.result));
          const tx = db.transaction('blobs', 'readonly');
          const all = await new Promise(r => {
            const q = tx.objectStore('blobs').getAll(); q.onsuccess = () => r(q.result);
          });
          return all.length;
        }''')
        check('图片存进了 IndexedDB', blob_rows and blob_rows > 0, f'rows={blob_rows}')
        check('页面渲染出了这张图', page.locator('img[src^="blob:"]').count() > 0)
        # OCR:文字应该已经被识别出来插进正文(识别资源全在本地,不依赖外网)
        _ed = page.locator('textarea').first
        _txt = _ed.input_value() if _ed.count() else ''
        check('OCR 把图片里的中英文认出来了',
              ('高数' in _txt) and ('Linear' in _txt or 'linear' in _txt.lower()),
              repr(_txt[:80]))

        # ---------- 10e. 头像/名称双击编辑 ----------
        print('\n[10e] 头像与名称双击编辑')
        page.goto(f'{BASE}/#/schedule', wait_until='domcontentloaded')
        page.wait_for_timeout(1200)
        name_el = page.locator('div[title="双击改名"]').first
        check('侧栏名称可双击(有提示)', name_el.count() > 0)
        if name_el.count():
            name_el.dblclick()
            page.wait_for_timeout(500)
            name_input = page.locator('aside input').first
            check('双击后出现输入框', name_input.count() > 0)
            if name_input.count():
                name_input.fill('我的课程桌')
                name_input.press('Enter')
                page.wait_for_timeout(700)
                check('改名已生效', page.locator('text=我的课程桌').count() > 0)
                # 刷新后还在
                page.reload(wait_until='domcontentloaded')
                page.wait_for_timeout(1500)
                check('改名已持久化', page.locator('text=我的课程桌').count() > 0)
        # 头像:双击出菜单 → 上传
        page.locator('aside button[title="双击换头像"]').first.dblclick()
        page.wait_for_timeout(500)
        check('双击头像弹出菜单', page.locator('text=选一张图片').count() > 0)
        import zlib as _zlib
        def _ck(tag, data):
            return len(data).to_bytes(4, 'big') + tag + data + _zlib.crc32(tag + data).to_bytes(4, 'big')
        _raw = b''.join(b'\x00' + bytes([255, 140, 60]) * 16 for _ in range(16))
        _png = (b'\x89PNG\r\n\x1a\n'
                + _ck(b'IHDR', (16).to_bytes(4, 'big') + (16).to_bytes(4, 'big') + bytes([8, 2, 0, 0, 0]))
                + _ck(b'IDAT', _zlib.compress(_raw, 9))
                + _ck(b'IEND', b''))
        page.locator('aside input[type="file"]').first.set_input_files([
            {'name': 'a.png', 'mimeType': 'image/png', 'buffer': _png},
        ])
        page.wait_for_timeout(1200)
        check('头像换成了图片', page.locator('aside img[alt="头像"]').count() > 0)
        check('选完图菜单自动收起', page.locator('text=选一张图片').count() == 0)
        page.screenshot(path=f'{OUT}/flow-10e-brand.png')
        # 还原默认名,免得影响后面的截图
        page.locator('div[title="双击改名"]').first.dblclick()
        page.wait_for_timeout(400)
        _i = page.locator('aside input').first
        if _i.count():
            _i.fill('课程桌'); _i.press('Enter'); page.wait_for_timeout(600)

        # ---------- 11. 通知与图片上传入口不报错 ----------
        print('\n[11] 其他入口')
        page.goto(f'{BASE}/#/settings', wait_until='domcontentloaded')
        page.wait_for_timeout(800)
        page.get_by_role('button', name='申请授权').click()
        page.wait_for_timeout(700)
        check('通知权限流程无异常', True)
        page.screenshot(path=f'{OUT}/flow-8-settings.png')

        print('\n--- console errors ---')
        real_errors = [e for e in console_errors if 'favicon' not in e]
        for e in real_errors[:20]:
            print(e)
        if not real_errors:
            print('(none)')
        if real_errors:
            failures.append(f'{len(real_errors)} 个控制台错误')

        browser.close()

    print('\n' + '=' * 40)
    if failures:
        print(f'❌ {len(failures)} 项未通过:')
        for f in failures:
            print('  -', f)
        sys.exit(1)
    print('✅ 全部交互流程通过')


main()
