"""用 Playwright 灌入演示数据并截图,验证渲染"""
import datetime
import json
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get('SHOT_BASE', 'http://127.0.0.1:4173')
OUT = '/workspace/course-desk/shots'
os.makedirs(OUT, exist_ok=True)

COURSES = [
    dict(name='高等数学', teacher='张老师', location='教三 302', campus='本部校区', building='第三教学楼',
         weekday=1, period=1, periods=2, startWeek=1, endWeek=16, color='#F26722',
         website='https://example.com/math'),
    dict(name='大学英语', teacher='李老师', location='一教 201', campus='本部校区', building='第一教学楼',
         weekday=1, period=3, periods=2, startWeek=1, endWeek=16, color='#4FAFD6'),
    dict(name='数据结构', teacher='王老师', location='实训楼 5-302', campus='新校区', building='实训楼',
         weekday=1, period=5, periods=2, startWeek=1, endWeek=16, color='#3FA08A'),
    dict(name='大学物理', teacher='陈老师', location='物理楼 401', campus='本部校区', building='物理楼',
         weekday=2, period=1, periods=2, startWeek=1, endWeek=16, color='#2FBE55'),
    dict(name='马克思主义基本原理', teacher='刘老师', location='文科楼 210', campus='本部校区', building='文科楼',
         weekday=2, period=3, periods=2, startWeek=1, endWeek=16, color='#F4CE4E'),
    dict(name='线性代数', teacher='赵老师', location='教二 305', campus='本部校区', building='第二教学楼',
         weekday=3, period=1, periods=2, startWeek=1, endWeek=16, color='#E8422F'),
    dict(name='计算机网络', teacher='孙老师', location='教三 401', campus='本部校区', building='第三教学楼',
         weekday=3, period=3, periods=2, startWeek=3, endWeek=16, color='#A97C5B'),
    dict(name='体育(篮球)', teacher='周老师', location='体育馆', campus='本部校区', building='体育馆',
         weekday=3, period=7, periods=2, startWeek=1, endWeek=16, color='#7B92DC'),
    dict(name='概率论与数理统计', teacher='吴老师', location='教三 305', campus='本部校区', building='第三教学楼',
         weekday=4, period=1, periods=2, startWeek=1, endWeek=16, color='#2FBE55'),
    dict(name='操作系统', teacher='郑老师', location='实训楼 3-205', campus='新校区', building='实训楼',
         weekday=4, period=5, periods=2, startWeek=1, endWeek=16, color='#F26722'),
    dict(name='大学语文', teacher='冯老师', location='文科楼 305', campus='本部校区', building='文科楼',
         weekday=5, period=1, periods=2, startWeek=1, endWeek=16, color='#10b981'),
    dict(name='体育(羽毛球)', teacher='周老师', location='体育馆', campus='本部校区', building='体育馆',
         weekday=5, period=3, periods=2, startWeek=1, endWeek=16, color='#7B92DC'),
]

# 行程:课程之外的校园活动(刻意用旧色值无关的独立数据)
def event(title, kind, date, start, end, location=None, detail=None, weekly=False):
    return dict(title=title, kind=kind, date=date, start=start, end=end,
                location=location, detail=detail, weekly=weekly)


NOW = int(time.time() * 1000)


def _week_dates():
    """本周一到周日,给演示行程用"""
    today = datetime.date.today()
    monday = today - datetime.timedelta(days=today.weekday())
    return [(monday + datetime.timedelta(days=i)).isoformat() for i in range(7)]


_WD = _week_dates()

EVENTS = [
    event('学生会例会', 'meeting', _WD[1], '19:00', '20:00', '学生活动中心 301',
          '带上本月总结和下月活动策划,顺便把上次没定的分工敲定'),
    event('党支部大会', 'party', _WD[2], '10:00', '11:40', '文科楼 210',
          '讨论发展新党员名单,会前把登记表交给组织委员'),
    event('社团招新摆摊', 'club', _WD[4], '14:00', '17:40', '图书馆前广场',
          '带易拉宝、传单和抽奖箱,再借两把折叠椅'),
    event('讲座:AI 与未来职业', 'lecture', _WD[0], '19:00', '20:40', '学生活动中心 报告厅',
          '凭学生证入场,提前十分钟到'),
    event('辅导员例会', 'meeting', _WD[0], '19:00', '20:00', '行政楼 205', '每周一次,汇报班级情况'),
]


def homework(title, course_name, due_offset_h, priority=1, detail=None, done=False):
    return dict(title=title, courseName=course_name, dueAt=NOW + due_offset_h * 3600_000,
                priority=priority, detail=detail, done=done)


SEED_JS = """
async ([courses, homeworks, notes, events]) => {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('course-desk')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  const db = await open()
  const put = (store, rows) => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite')
    const s = tx.objectStore(store)
    for (const row of rows) s.put(row)
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  })
  const now = Date.now()
  await put('courses', courses.map((c, i) => ({
    id: 'course_demo_' + i, ...c, createdAt: now, updatedAt: now,
  })))
  await put('homework', homeworks.map((h, i) => ({
    id: 'hw_demo_' + i, title: h.title, courseId: h.courseId ?? null, detail: h.detail ?? '',
    dueAt: h.dueAt, done: h.done, attachments: [], priority: h.priority,
    createdAt: now, updatedAt: now,
  })))
  await put('notes', notes.map((n, i) => ({
    id: 'note_demo_' + i, title: n.title, content: n.content, images: [], tags: n.tags,
    courseId: null, pinned: !!n.pinned, createdAt: now, updatedAt: now,
  })))
  await put('events', events.map((e, i) => ({
    id: 'event_demo_' + i, title: e.title, kind: e.kind, date: e.date,
    start: e.start, end: e.end, location: e.location ?? null, detail: e.detail ?? null,
    weekly: !!e.weekly, noteId: null, createdAt: now, updatedAt: now,
  })))
  return 'ok'
}
"""


def main():
    course_ids = {}
    for i, c in enumerate(COURSES):
        course_ids[c['name']] = 'course_demo_%d' % i

    hw = [
        dict(title='第 3 章课后习题 1-10', courseId=course_ids['高等数学'], dueAt=NOW - 6 * 3600_000, priority=2, done=False),
        dict(title='实验报告 1:线性表', courseId=course_ids['数据结构'], dueAt=NOW + 3 * 3600_000, priority=2, done=False),
        dict(title='英语单元测验准备', courseId=course_ids['大学英语'], dueAt=NOW + 20 * 3600_000, priority=1, done=False),
        dict(title='第三章作业', courseId=course_ids['线性代数'], dueAt=NOW + 50 * 3600_000, priority=1, done=False),
        dict(title='小组展示 PPT', courseId=course_ids['计算机网络'], dueAt=NOW + 74 * 3600_000, priority=2, done=False),
        dict(title='马原读书笔记', courseId=course_ids['马克思主义基本原理'], dueAt=NOW + 98 * 3600_000, priority=0, done=False),
    ]
    hw[0]['done'] = False

    notes = [
        dict(title='高数 · 洛必达法则的使用条件', pinned=True,
             tags=['高数', '重点'],
             content='# 洛必达法则\n\n## 三个前提\n- 必须是 **0/0** 或 **∞/∞** 型未定式\n- 分子分母在该点附近可导且导数不为 0\n- 求导后极限存在或为无穷\n\n## 易错\n\n> 连续使用洛必达前,每一步都要重新检查是否仍是未定式。\n\n例题:$\\lim_{x\\to 0}\\frac{\\sin x - x}{x^3}$ 连续用三次。'),
        dict(title='英语 · Unit 5 词汇', tags=['英语'],
             content='## 核心词\n- diligent /ˈdɪlɪdʒənt/ 勤奋的\n- resilient ��有韧性的\n- curriculum 课程\n\n短语搭配:\n1. keep abreast of 与…保持同步\n2. bridge the gap 弥合差距'),
        dict(title='操作系统 · 进程与线程', tags=['操作系统', '面试'],
             content='## 进程 vs 线程\n\n| 维度 | 进程 | 线程 |\n|---|---|---|\n| 调度单位 | 否 | 是 |\n| 独立地址空间 | 是 | 否(共享) |\n| 通信开销 | 大 | 小 |\n\n### 死锁四个必要条件\n1. 互斥\n2. 占有并等待\n3. 不可剥夺\n4. 循环等待'),
        dict(title='待办 · 周末计划', tags=['生活'],
             content='- [ ] 洗衣服\n- [ ] 整理高数笔记\n- [ ] 给图书馆还书\n- [x] 买咖啡豆'),
    ]

    # 行程对应的备忘(真实使用时由「保存行程」自动生成)
    KIND_LABEL = {'meeting': '会议', 'party': '党团', 'club': '社团', 'lecture': '讲座', 'other': '其他'}
    for ev in EVENTS:
        d = datetime.date.fromisoformat(ev['date'])
        wd = ['一', '二', '三', '四', '五', '六', '日'][d.weekday()]
        notes.append(dict(
            title=ev['title'], tags=['行程', KIND_LABEL.get(ev['kind'], '其他')],
            content=f"**{ev['title']}**\n\n"
                    f"- 类型:{KIND_LABEL.get(ev['kind'], '其他')}\n"
                    f"- 时间:{d.month} 月 {d.day} 日 星期{wd} {ev['start']} – {ev['end']}\n"
                    f"- 地点:{ev.get('location') or '待定'}\n\n{ev.get('detail') or ''}\n\n"
                    f"> 这条备忘由「行程」自动同步,行程改动会一并更新。",
        ))

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path='/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
            headless=True,
            args=['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        )
        ctx = browser.new_context(viewport={'width': 1360, 'height': 900}, device_scale_factor=2,
                                  locale='zh-CN')
        page = ctx.new_page()
        errors = []
        page.on('console', lambda m: errors.append(f'[console.{m.type}] {m.text}') if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(f'[pageerror] {e}'))

        page.goto(BASE, wait_until='networkidle')
        page.wait_for_timeout(1200)

        # 灌数据
        page.evaluate(SEED_JS, [COURSES, hw, notes, EVENTS])
        page.wait_for_timeout(600)
        page.reload(wait_until='networkidle')
        page.wait_for_timeout(1200)

        routes = [
            ('today', '今日'),
            ('schedule', '课表'),
            ('homework', '作业'),
            ('notes', '备忘'),
            ('ai', 'AI'),
            ('import', '导入'),
            ('settings', '设置'),
        ]
        for r, _ in routes:
            page.goto(f'{BASE}/#/{r}', wait_until='domcontentloaded')
            page.wait_for_timeout(900)
            page.screenshot(path=f'{OUT}/desktop-{r}.png', full_page=False)
            print('shot desktop-%s' % r)

        # 移动端
        mctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=3,
                                   is_mobile=True, has_touch=True, locale='zh-CN')
        mpage = mctx.new_page()
        mpage.goto(BASE, wait_until='networkidle')
        mpage.wait_for_timeout(1200)
        mpage.evaluate(SEED_JS, [COURSES, hw, notes, EVENTS])
        mpage.wait_for_timeout(600)
        mpage.reload(wait_until='networkidle')
        mpage.wait_for_timeout(1200)
        for r in ['today', 'schedule', 'homework', 'notes', 'more']:
            mpage.goto(f'{BASE}/#/{r}', wait_until='domcontentloaded')
            mpage.wait_for_timeout(900)
            mpage.screenshot(path=f'{OUT}/mobile-{r}.png')
            print('shot mobile-%s' % r)

        # 小组件
        page.goto(f'{BASE}/#/widget', wait_until='domcontentloaded')
        page.wait_for_timeout(1200)
        page.screenshot(path=f'{OUT}/desktop-widget.png')
        print('shot desktop-widget')

        print('\n--- console errors ---')
        for e in errors[:30]:
            print(e)
        if not errors:
            print('(none)')
        browser.close()


main()
