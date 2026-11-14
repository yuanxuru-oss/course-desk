import type { AiConfig } from '../types'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export class AiError extends Error {
  hint?: string
  constructor(message: string, hint?: string) {
    super(message)
    this.name = 'AiError'
    this.hint = hint
  }
}

function requireConfig(ai: AiConfig): AiConfig {
  if (!ai.apiKey) {
    throw new AiError('尚未配置 AI 接口密钥', '到「设置 → AI 助手」里填入 API Key')
  }
  if (!ai.baseUrl) {
    throw new AiError('尚未配置 API 地址', '到「设置 → AI 助手」里选择服务商或填写 Base URL')
  }
  if (!ai.model) {
    throw new AiError('尚未配置模型名称', '到「设置 → AI 助手」里填写模型名')
  }
  return ai
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '')
  const p = path.replace(/^\/+/, '')
  return `${b}/${p}`
}

/** 本地转发服务地址(用户可改) */
function proxyBase(ai: AiConfig): string {
  return (ai.proxyUrl || 'http://localhost:8787').replace(/\/+$/, '')
}

/**
 * 带超时的 fetch。
 *
 * 之前所有请求都只传调用方给的 signal,而实际上没有任何调用方传过 ——
 * 国内直连被丢包时 fetch 会一直挂着,表现是「点了按钮一直转圈,
 * 既不成功也不报错」,用户只能刷新页面。这里统一兜 60 秒。
 */
async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 60_000): Promise<Response> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  const outer = init.signal
  const forward = () => ctl.abort()
  if (outer) {
    if (outer.aborted) ctl.abort()
    else outer.addEventListener('abort', forward, { once: true })
  }
  try {
    return await fetch(url, { ...init, signal: ctl.signal })
  } catch (err) {
    if (err instanceof DOMException && /Abort/i.test(err.name)) {
      throw new AiError(
        `请求超时(${Math.round(ms / 1000)} 秒没有响应)`,
        '网络可能被拦截。OpenAI 官方 / 智谱 / Groq 这类服务商请在设置里打开「通过本地服务转发」',
      )
    }
    /*
     * fetch 抛 TypeError("Failed to fetch") 基本就是跨域被拦。
     * 浏览器出于安全不会告诉你细节,用户只会看到「连接不上」——这里必须翻译成人话,
     * 否则会以为是 Key 填错了,怎么试都试不好。
     */
    if (err instanceof TypeError) {
      throw new AiError(`请求没有发出去:${url}`, CORS_HINT)
    }
    throw err
  } finally {
    clearTimeout(timer)
    if (outer) outer.removeEventListener('abort', forward)
  }
}

/**
 * 调用大模型,返回文本
 *
 * `ai.proxy = true` 时走本地服务转发 —— 用于智谱 / OpenAI 官方 / Groq 这类
 * 不允许浏览器直连的服务商(它们的预检响应不带 CORS 头)。
 */
export async function chat(
  ai: AiConfig,
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number; signal?: AbortSignal } = {},
): Promise<string> {
  requireConfig(ai)
  const temperature = opts.temperature ?? 0.4
  const maxTokens = opts.maxTokens ?? 2048

  if (ai.proxy) {
    const res = await fetchWithTimeout(`${proxyBase(ai)}/api/ai/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUrl: ai.baseUrl,
        apiKey: ai.apiKey,
        model: ai.model,
        messages,
        temperature,
        maxTokens,
        provider: ai.provider,
      }),
      signal: opts.signal,
    })
    if (!res.ok) throw new AiError(await readError(res), proxyHint(res.status))
    const data = await res.json()
    const text =
      ai.provider === 'anthropic'
        ? (data.content ?? []).map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join('').trim()
        : data?.choices?.[0]?.message?.content
    if (typeof text === 'string' && text.trim()) return text.trim()
    return '(模型没有返回内容)'
  }

  if (ai.provider === 'anthropic') {
    const system = messages.find((m) => m.role === 'system')?.content
    const rest = messages.filter((m) => m.role !== 'system')
    const res = await fetchWithTimeout(joinUrl(ai.baseUrl, 'messages'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ai.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: ai.model,
        system,
        messages: rest.map((m) => ({ role: m.role, content: m.content })),
        temperature,
        max_tokens: maxTokens,
      }),
      signal: opts.signal,
    })
    if (!res.ok) throw new AiError(await readError(res), anthropicHint(res.status))
    const data = await res.json()
    const text = (data.content ?? [])
      .map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
      .join('')
      .trim()
    return text || '(模型没有返回内容)'
  }

  const res = await fetchWithTimeout(joinUrl(ai.baseUrl, 'chat/completions'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${ai.apiKey}`,
    },
    body: JSON.stringify({
      model: ai.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
    }),
    signal: opts.signal,
  })
  if (!res.ok) throw new AiError(await readError(res), openaiHint(res.status))
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content
  if (typeof text === 'string' && text.trim()) return text.trim()
  return '(模型没有返回内容)'
}

/** 调用 embedding 接口,返回向量 */
export async function embed(ai: AiConfig, input: string): Promise<number[]> {
  const key = ai.embedApiKey || ai.apiKey
  const base = ai.embedBaseUrl || ai.baseUrl
  if (!key || !base || !ai.embedModel) {
    throw new AiError('尚未配置向量模型', '到「设置 → AI 助手」里填写 Embedding 的 Base URL / Key / 模型名')
  }
  const res = ai.proxy
    ? await fetchWithTimeout(`${proxyBase(ai)}/api/ai/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseUrl: base, apiKey: key, model: ai.embedModel, input }),
      })
    : await fetchWithTimeout(joinUrl(base, 'embeddings'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: ai.embedModel, input }),
      })
  if (!res.ok) throw new AiError(await readError(res), openaiHint(res.status))
  const data = await res.json()
  const vec = data?.data?.[0]?.embedding
  if (!Array.isArray(vec)) throw new AiError('向量接口返回格式异常')
  return vec as number[]
}

async function readError(res: Response): Promise<string> {
  try {
    const text = await res.text()
    try {
      const json = JSON.parse(text)
      const msg = json?.error?.message || json?.message || json?.error
      if (typeof msg === 'string') return msg
      if (msg) return JSON.stringify(msg).slice(0, 300)
    } catch {
      /* not json */
    }
    return text.slice(0, 300) || `HTTP ${res.status}`
  } catch {
    return `HTTP ${res.status}`
  }
}

function openaiHint(status: number): string | undefined {
  if (status === 401 || status === 403) return '密钥无效或没有权限,请检查 API Key'
  if (status === 404) return '接口地址或模型名不正确,OpenAI 兼容接口通常需要以 /v1 结尾'
  if (status === 429) return '请求过于频繁或额度不足'
  if (status === 0 || status === 502) return '可能是浏览器跨域被拦截,可改用内置代理服务'
  return undefined
}

/** 走本地转发时的提示 */
function proxyHint(status: number): string | undefined {
  if (status === 0 || status === 502) {
    return '连不上本地转发服务 —— 先在项目目录跑 node server/index.js(默认 8787 端口)'
  }
  return undefined
}

/** 服务商常见的报错含义(给用户看人话) */
export function explainAiError(message: string): string | undefined {
  const m = message.toLowerCase()
  if (m.includes('endpoint not found')) return '这个模型/接入点不存在 —— 去控制台确认模型 ID 或接入点 ID 是否填对'
  if (m.includes('access denied') || m.includes('permission'))
    return '这个 Key 没有该模型的权限 —— 去控制台开通该模型或创建推理接入点'
  if (m.includes('model') && (m.includes('not found') || m.includes('does not exist')))
    return '模型名不存在 —— 用「获取模型列表」自动拉一份,别手打'
  if (m.includes('api key format')) return 'API Key 格式不对,重新复制一次(注意不要带空格)'
  if (m.includes('insufficient') || m.includes('quota') || m.includes('arrearage'))
    return '额度不足或欠费,去控制台充值'
  if (m.includes('rate limit') || m.includes('too many requests')) return '请求太频繁,等一会儿再试'
  if (m.includes('无效的令牌') || m.includes('invalid token') || m.includes('unauthorized'))
    return 'Key 无效或已过期,重新复制一次'
  return undefined
}

/** 浏览器连不上时最常见的原因,单独给人话 */
export const CORS_HINT =
  '浏览器被「跨域」拦住了:这家服务商不允许网页直接调用(跟你的 Key 对不对无关)。三种解法:① 换一家允许直连的(DeepSeek / 豆包 / 通义 / Kimi / 硅基流动);② 用支持跨域的中转 API;③ 在下面打开「通过本地服务转发」并在电脑上跑起 server/。'

export interface ModelListResult {
  models: string[]
  /** 实际请求的地址,方便用户核对地址有没有填错 */
  endpoint: string
  /** 如果 /models 404 但加了 /v1 就好了,把建议的地址带回去 */
  suggestedBaseUrl?: string
}

/** 试一次 GET {base}/models */
async function tryModels(base: string, ai: AiConfig): Promise<{ res: Response; endpoint: string }> {
  const endpoint = ai.proxy ? `${proxyBase(ai)}/api/ai/models` : joinUrl(base, 'models')
  const headers: Record<string, string> = { accept: 'application/json' }
  let init: RequestInit

  if (ai.proxy) {
    // 走本地转发:由服务端带 Key 去请求,浏览器不碰密钥
    init = {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ baseUrl: base, apiKey: ai.apiKey, provider: ai.provider }),
    }
  } else {
    if (ai.provider === 'anthropic') {
      headers['x-api-key'] = ai.apiKey
      headers['anthropic-version'] = '2023-06-01'
      headers['anthropic-dangerous-direct-browser-access'] = 'true'
    } else {
      headers.authorization = `Bearer ${ai.apiKey}`
    }
    init = { method: 'GET', headers }
  }

  return { res: await fetchWithTimeout(endpoint, init, 30_000), endpoint }
}

/**
 * 拉取服务商支持的模型列表(GET /models)。
 *
 * 用户不用再手打模型名 —— 手打最容易错,而且中转站的模型 ID 往往和官方不一样。
 * 拉不到也不致命:前端会退回手动输入。
 */
export async function listModels(ai: AiConfig): Promise<ModelListResult> {
  const base = (ai.baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) throw new AiError('还没填 API 地址', '例如 https://api.deepseek.com/v1')

  let { res, endpoint } = await tryModels(base, ai)
  let suggestedBaseUrl: string | undefined

  /*
   * 很多中转站的地址是 https://xxx.com(不带 /v1),直接拼 /models 会 404。
   * 这里自动再试一次 /v1/models —— 成功就顺手把建议的地址带回去,省得用户自己猜。
   */
  if (res.status === 404 && !/\/v\d+$/.test(base)) {
    const withV1 = `${base}/v1`
    const retry = await tryModels(withV1, ai)
    if (retry.res.ok) {
      res = retry.res
      endpoint = retry.endpoint
      suggestedBaseUrl = withV1
    }
  }

  if (!res.ok) {
    const msg = await readError(res)
    throw new AiError(msg, explainAiError(msg) ?? openaiHint(res.status))
  }

  const text = await res.text()
  let data: any = null
  try {
    data = JSON.parse(text)
  } catch {
    data = null
  }

  const raw: any[] = Array.isArray(data) ? data : (data?.data ?? data?.models ?? data?.result?.data ?? [])
  const models = [...new Set(
    raw
      .map((x) => (typeof x === 'string' ? x : x?.id ?? x?.name ?? x?.model))
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0),
  )].sort()

  if (!models.length) {
    /*
     * 有的中转站返回 200 但 data 是空的,或者干脆返回一个 id→对象 的映射表。
     * 这里把原文片段带上,用户(和我)一眼就能看出是「没权限」还是「形状不一样」。
     */
    const mapped = data && typeof data === 'object' && !Array.isArray(data)
      ? Object.keys(data).filter((k) => /^[a-z0-9][\w.:/-]{1,60}$/i.test(k) && !['data', 'object', 'error', 'message', 'result'].includes(k))
      : []
    if (mapped.length >= 2) return { models: mapped.sort(), endpoint }

    const preview = text ? text.replace(/\s+/g, ' ').slice(0, 240) : '(空响应)'
    const err = new AiError('接口没有返回模型列表', '有的服务商不支持 /models,或者这个 Key 没有模型权限。可以手填模型名,或用下面的「常用模型」快捷选项')
    ;(err as any).bodyPreview = preview
    throw err
  }
  return { models, endpoint, suggestedBaseUrl }
}

function anthropicHint(status: number): string | undefined {
  if (status === 401) return 'API Key 无效'
  if (status === 404) return '模型名或接口地址不正确'
  if (status === 429) return '额度不足或请求过快'
  return undefined
}

/** 测试连接 */
export async function testConnection(ai: AiConfig): Promise<string> {
  const out = await chat(ai, [{ role: 'user', content: '只回复两个字:可用' }], { maxTokens: 16 })
  return out
}

/** 摘要:把长文本压缩成结构化要点 */
export async function summarize(ai: AiConfig, text: string, title?: string): Promise<string> {
  const prompt = [
    '你是一名大学生学习助手。请把下面的学习材料整理成结构化要点,要求:',
    '1. 用 Markdown 输出,不要有前言和客套;',
    '2. 第一行写「## 一句话概括」,再用 1 句话总结;',
    '3. 然后写「## 核心要点」,分条列出 3-8 条,每条一句话;',
    '4. 然后写「## 术语 / 公式」,列出材料里出现的关键术语、公式、概念,没有就写「无」;',
    '5. 最后写「## 可能考点」,基于材料推测 2-4 个考试可能问的方向;',
    '6. 全文控制在 400 字以内,不要编造材料里没有的内容。',
    title ? `材料标题:${title}` : '',
    '',
    '--- 材料开始 ---',
    text.slice(0, 24000),
    '--- 材料结束 ---',
  ].join('\n')
  return chat(ai, [{ role: 'user', content: prompt }], { temperature: 0.2 })
}
