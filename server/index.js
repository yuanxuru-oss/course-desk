/**
 * 课程桌 · 推送服务
 *
 * 解决 PWA 的核心短板:网页通知在页面关闭后失效。
 * 这里由服务端持有提醒计划,到点主动通过 Web Push 下发;
 * 同时代理 Server 酱,用于把提醒转发到微信。
 *
 * 启动:
 *   npm i -g web-push  (或在 server/ 目录 npm install)
 *   node server/index.js
 *
 * 环境变量:
 *   PORT           监听端口,默认 8787
 *   VAPID_PUBLIC   VAPID 公钥(可用 `npx web-push generate-vapid-keys` 生成)
 *   VAPID_PRIVATE  VAPID 私钥
 *   VAPID_SUBJECT  联系邮箱,形如 mailto:you@example.com
 */
import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import webpush from 'web-push'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
const DATA_FILE = path.join(DATA_DIR, 'store.json')

const PORT = process.env.PORT || 8787
const VAPID_PUBLIC = process.env.VAPID_PUBLIC || ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:course-desk@example.com'
/** 服务端的微信 key(可选):配了才算「微信可用」,否则只有前端自带 key 能用 */
const WECHAT_KEY = process.env.WECHAT_KEY || ''

if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
  console.warn(
    '[course-desk] 未配置 VAPID 密钥,Web Push 不可用。\n' +
      '  生成:npx web-push generate-vapid-keys --json\n' +
      '  然后设置环境变量 VAPID_PUBLIC / VAPID_PRIVATE / VAPID_SUBJECT',
  )
} else {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
}

/* ---------------- 持久化 ---------------- */
function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  } catch {
    return { subscriptions: [], schedule: [], sent: [] }
  }
}

function saveStore(store) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2))
  } catch (err) {
    console.error('[course-desk] 保存失败', err)
  }
}

let store = loadStore()

/* ---------------- 服务 ---------------- */
const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))

app.get('/api/health', (_req, res) => {
  res.json({
    // 没配 VAPID 就没法推送,不能再谎报 ok
    ok: !!VAPID_PUBLIC,
    service: 'course-desk-push',
    vapidPublicKey: VAPID_PUBLIC,
    subscriptions: store.subscriptions.length,
    scheduled: store.schedule.length,
    wechatConfigured: !!WECHAT_KEY,
  })
})

app.post('/api/push/subscribe', (req, res) => {
  const sub = req.body
  if (!sub?.endpoint) {
    return res.status(400).json({ ok: false, message: '缺少 endpoint' })
  }
  const exists = store.subscriptions.find((s) => s.endpoint === sub.endpoint)
  if (!exists) {
    store.subscriptions.push({ ...sub, createdAt: Date.now() })
    saveStore(store)
    console.log(`[course-desk] 新增订阅 ${sub.endpoint.slice(0, 40)}…`)
  }
  res.json({ ok: true, count: store.subscriptions.length })
})

app.delete('/api/push/subscribe', (req, res) => {
  const { endpoint } = req.body ?? {}
  store.subscriptions = store.subscriptions.filter((s) => s.endpoint !== endpoint)
  saveStore(store)
  res.json({ ok: true })
})

app.post('/api/push/send', async (req, res) => {
  const payload = JSON.stringify({
    title: req.body?.title ?? '课程桌',
    body: req.body?.body ?? '',
    tag: req.body?.tag,
    icon: '/icons/icon-192.png',
  })
  const result = await broadcast(payload, req.body?.tag)
  res.json(result)
})

app.get('/api/schedule', (_req, res) => {
  res.json({ ok: true, reminders: store.schedule })
})

app.post('/api/schedule', (req, res) => {
  const reminders = Array.isArray(req.body?.reminders) ? req.body.reminders : []
  /*
   * 不能整体替换、更不能清空 store.sent:
   *   · 客户端同步上来的计划里本来就带着「刚刚已经推过」的条目
   *     (它保留最近 60 分钟内的提醒),清空 sent 会在 30 秒后重推一遍
   *   · 设置页的手动同步只传课程/作业,清空会把服务端计划里的行程提醒抹掉
   * 所以按 id 合并:新计划里有的覆盖,没有的删掉;sent 只保留仍存在的 id。
   */
  const incoming = new Map(reminders.map((r) => [r.id, r]))
  const merged = []
  const seen = new Set()
  for (const r of store.schedule ?? []) {
    if (!seen.has(r.id)) {
      merged.push(incoming.get(r.id) ?? r)
      seen.add(r.id)
    }
  }
  for (const r of reminders) {
    if (!seen.has(r.id)) {
      merged.push(r)
      seen.add(r.id)
    }
  }
  store.schedule = merged
  store.sent = (store.sent ?? []).filter((id) => seen.has(id))
  saveStore(store)
  console.log(`[course-desk] 已接收提醒计划,共 ${merged.length} 条`)
  res.json({ ok: true, count: merged.length })
})

/** 微信代理:转发到 Server 酱,规避浏览器跨域 */
app.post('/api/wechat', async (req, res) => {
  const { key, title, desp } = req.body ?? {}
  if (!key) return res.status(400).json({ ok: false, message: '缺少 key' })
  try {
    const r = await fetch(`https://sctapi.ftqq.com/${key}.send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: title || '课程桌', desp: desp || '' }),
    })
    const data = await r.json().catch(() => ({}))
    res.json({ ok: r.ok && (data.code ?? 0) === 0, message: data.message || data.msg || '已发送' })
  } catch (err) {
    res.status(502).json({ ok: false, message: `转发失败:${err.message}` })
  }
})

/**
 * AI 代理:转发到模型服务商,规避浏览器跨域。
 *
 * 有些服务商(OpenAI 官方、智谱 GLM、Groq 等)在预检响应里不带
 * Access-Control-Allow-Origin,浏览器直连会被拦。
 * 这里的代理只做转发,Key 由前端传进来,服务端不落盘、不记录。
 */
/** 拉取模型列表(GET /models),浏览器直连会被跨域拦,所以也给一个转发 */
app.post('/api/ai/models', async (req, res) => {
  const { baseUrl, apiKey, provider } = req.body ?? {}
  if (!baseUrl || !apiKey) {
    return res.status(400).json({ error: { message: '缺少 baseUrl / apiKey' } })
  }
  try {
    const base = String(baseUrl).replace(/\/+$/, '')
    const headers = { accept: 'application/json' }
    if (provider === 'anthropic') {
      headers['x-api-key'] = apiKey
      headers['anthropic-version'] = '2023-06-01'
    } else {
      headers.authorization = `Bearer ${apiKey}`
    }
    const r = await fetch(`${base}/models`, { method: 'GET', headers })
    const text = await r.text()
    res.status(r.status).type('application/json').send(text)
  } catch (err) {
    res.status(502).json({ error: { message: `拉取模型列表失败:${err?.message ?? err}` } })
  }
})

app.post('/api/ai/chat', async (req, res) => {  const { baseUrl, apiKey, model, messages, temperature, maxTokens, provider } = req.body ?? {}
  if (!baseUrl || !apiKey || !model) {
    return res.status(400).json({ error: { message: '缺少 baseUrl / apiKey / model' } })
  }
  try {
    const base = String(baseUrl).replace(/\/+$/, '')
    let r
    if (provider === 'anthropic') {
      const system = messages?.find((m) => m.role === 'system')?.content
      const rest = (messages ?? []).filter((m) => m.role !== 'system')
      r = await fetch(`${base}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          system,
          messages: rest,
          temperature: temperature ?? 0.4,
          max_tokens: maxTokens ?? 2048,
        }),
      })
    } else {
      r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages,
          temperature: temperature ?? 0.4,
          max_tokens: maxTokens ?? 2048,
          stream: false,
        }),
      })
    }
    const text = await r.text()
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(text)
  } catch (err) {
    res.status(502).json({ error: { message: `代理转发失败:${err.message}` } })
  }
})

/** 向量模型代理 */
app.post('/api/ai/embeddings', async (req, res) => {
  const { baseUrl, apiKey, model, input } = req.body ?? {}
  if (!baseUrl || !apiKey || !model) {
    return res.status(400).json({ error: { message: '缺少 baseUrl / apiKey / model' } })
  }
  try {
    const base = String(baseUrl).replace(/\/+$/, '')
    const r = await fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input }),
    })
    const text = await r.text()
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(text)
  } catch (err) {
    res.status(502).json({ error: { message: `代理转发失败:${err.message}` } })
  }
})

/* ---------------- 推送 ---------------- */
async function broadcast(payload, tag) {
  if (!VAPID_PUBLIC) return { ok: false, message: '未配置 VAPID,无法推送' }
  let sent = 0
  let failed = 0
  const expired = []

  for (const sub of store.subscriptions) {
    try {
      await webpush.sendNotification(sub, payload, { TTL: 60 * 60 })
      sent++
    } catch (err) {
      failed++
      if (err.statusCode === 404 || err.statusCode === 410) expired.push(sub.endpoint)
    }
  }

  if (expired.length) {
    store.subscriptions = store.subscriptions.filter((s) => !expired.includes(s.endpoint))
    saveStore(store)
  }

  console.log(`[course-desk] 推送「${tag ?? ''}」成功 ${sent} 条,失败 ${failed} 条`)
  return { ok: sent > 0, sent, failed, message: sent > 0 ? '推送成功' : '没有可用的订阅' }
}

/* ---------------- 调度器 ---------------- */
setInterval(async () => {
  if (!store.schedule.length) return
  const now = Date.now()
  const due = store.schedule.filter((r) => r.fireAt <= now && !store.sent.includes(r.id))
  if (!due.length) return

  for (const r of due) {
    const payload = JSON.stringify({
      title: r.title,
      body: r.body,
      tag: r.id,
      icon: '/icons/icon-192.png',
      requireInteraction: r.kind === 'homework',
    })
    await broadcast(payload, r.id)
    store.sent.push(r.id)
  }

  // 清理过期计划与记录
  store.schedule = store.schedule.filter((r) => r.fireAt > now - 864e5)
  store.sent = store.sent.filter((id) => !store.schedule.some((r) => r.id === id))
  saveStore(store)
}, 30_000)

app.listen(PORT, () => {
  console.log(`[course-desk] 推送服务已启动: http://localhost:${PORT}`)
  if (!VAPID_PUBLIC) console.log('[course-desk] 提醒:当前未配置 VAPID,只有微信代理可用')
})
