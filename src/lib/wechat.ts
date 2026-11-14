/**
 * 微信通道:Server 酱(sctapi.ftqq.com)直连,或经自建代理转发。
 */
import type { Settings } from '../types'

const SCTAPI = 'https://sctapi.ftqq.com'

export interface WechatResult {
  ok: boolean
  message: string
}

/** 直接调用 Server 酱 */
async function sendDirect(key: string, title: string, body: string): Promise<WechatResult> {
  try {
    const res = await fetch(`${SCTAPI}/${key}.send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title,
        desp: body,
      }),
    })
    const text = await res.text()
    let data: any = null
    try {
      data = JSON.parse(text)
    } catch {
      /* not json */
    }
    if (!res.ok) {
      const msg = data?.message || data?.msg || `HTTP ${res.status}`
      return { ok: false, message: msg }
    }
    const code = data?.code ?? 0
    if (code !== 0) {
      return { ok: false, message: data?.message || `Server酱返回错误码 ${code}` }
    }
    return { ok: true, message: '已通过微信发送' }
  } catch (err: any) {
    const isCors = /Failed to fetch|NetworkError/i.test(err?.message ?? '')
    return {
      ok: false,
      message: isCors
        ? '浏览器跨域被拦截,建议在设置里填写「微信推送代理」指向自建服务 /api/wechat'
        : `请求失败:${err?.message ?? err}`,
    }
  }
}

/** 通过代理转发 */
async function sendViaProxy(proxy: string, key: string, title: string, body: string): Promise<WechatResult> {
  try {
    const res = await fetch(proxy.replace(/\/+$/, ''), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, title, desp: body }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, message: data?.message || `HTTP ${res.status}` }
    return { ok: !!data?.ok, message: data?.message || '已通过代理发送' }
  } catch (err: any) {
    return { ok: false, message: `代理请求失败:${err?.message ?? err}` }
  }
}

export async function sendWechat(settings: Settings, title: string, body: string): Promise<boolean> {
  const res = await sendWechatDetailed(settings, title, body)
  if (!res.ok) console.warn('[wechat]', res.message)
  return res.ok
}

export async function sendWechatDetailed(
  settings: Settings,
  title: string,
  body: string,
): Promise<WechatResult> {
  const key = settings.wechatKey.trim()
  if (!key && !settings.wechatProxy.trim()) {
    return { ok: false, message: '未配置 Server 酱 Key 或代理地址' }
  }
  if (settings.wechatProxy.trim()) {
    return sendViaProxy(settings.wechatProxy.trim(), key, title, body)
  }
  return sendDirect(key, title, body)
}

/** 测试通道 */
export async function testWechat(settings: Settings): Promise<WechatResult> {
  return sendWechatDetailed(
    settings,
    '课程桌 · 通道测试',
    `这是一条来自课程桌的测试消息,发送时间 ${new Date().toLocaleString('zh-CN')}`,
  )
}
