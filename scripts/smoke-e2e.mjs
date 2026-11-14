/**
 * 端到端冒烟:启动无头 Chrome → 打开构建产物 → 走一遍所有页面 →
 * 把真实生成的教务 PDF 通过「导入」页面的文件输入框喂进去 → 断言解析结果。
 *
 * 用法:node scripts/smoke-e2e.mjs [appUrl] [pdfPath]
 * 需要本机有 Chrome,并且已用任意静态服务器托管 dist。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const APP = process.argv[2] || 'http://127.0.0.1:4173/'
const PDF = process.argv[3] || path.join('scripts', 'fixtures', '课表样例-矩阵.pdf')
const PORT = 9335

if (!fs.existsSync(PDF)) {
  console.error('找不到测试 PDF:', PDF)
  process.exit(1)
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdpsmoke-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--no-first-run',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`,
    '--remote-allow-origins=*',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function targetWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch {}
    await sleep(250)
  }
  throw new Error('CDP target 没起来')
}

const ws = new WebSocket(await targetWs())
let seq = 0
const pending = new Map()
const errors = []

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
    return
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails
    errors.push(d?.exception?.description ?? d?.text ?? 'unknown exception')
  }
})

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  return r.result?.result?.value
}

await new Promise((r) => ws.addEventListener('open', r))
await send('Runtime.enable')
await send('Page.enable')
await send('DOM.enable')

let pass = 0
let fail = 0
const check = (label, cond, extra = '') => {
  if (cond) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label} ${extra}`)
  }
}

await send('Page.navigate', { url: APP })
await sleep(3500)
const boot = await evaluate('document.body.innerText')
check('首屏渲染出课表(不是卡在启动中)', /教学周/.test(boot) && !/正在启动/.test(boot))

for (const r of ['today', 'homework', 'notes', 'ai', 'import', 'settings', 'widget', 'schedule']) {
  const before = errors.length
  await send('Page.navigate', { url: `${APP}#/${r}` })
  await sleep(1200)
  const txt = await evaluate('document.body.innerText')
  check(`页面 #/${r} 有内容`, typeof txt === 'string' && txt.length > 40)
  check(`页面 #/${r} 无运行时报错`, errors.length === before, errors.slice(before).join(' | ').slice(0, 200))
}

await send('Page.navigate', { url: `${APP}#/import` })
await sleep(2000)
const doc = await send('DOM.getDocument', { depth: -1 })
const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: 'input[type=file]' })
check('找到文件输入框', !!q.result?.nodeId)
if (q.result?.nodeId) {
  await send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: [path.resolve(PDF)] })
  await sleep(9000)
  const txt = await evaluate('document.body.innerText')
  for (const name of ['高等数学', '大学英语', '数据结构', '线性代数', '操作系统', '概率论', '计算机网络']) {
    check(`PDF 解析出「${name}」`, txt.includes(name))
  }
  check('PDF 解析出教师「张三」', txt.includes('张三'))
  check('PDF 解析出教室「教三302」', txt.includes('教三302'))
  check('导入过程没有报「解析失败」', !/解析失败/.test(txt))
}

console.log('\n运行时异常:', errors.length ? errors.slice(0, 3).join('\n') : '(无)')
console.log(`\n通过 ${pass} 项,失败 ${fail} 项`)
ws.close()
chrome.kill()
process.exit(fail > 0 ? 1 : 0)
