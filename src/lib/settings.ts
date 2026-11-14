import type { Settings } from '../types'
import { DEFAULT_PERIODS, mondayOf, parseDate, formatDate } from './time.ts'

/** 默认设置:学期从最近的某个周一开始(可用今天所在周) */
export function defaultSettings(): Settings {
  const today = new Date()
  const monday = mondayOf(today)
  return {
    id: 'app',
    schoolName: '',
    appName: '课程桌',
    avatarId: '',
    semesterStart: formatDate(monday),
    weekCount: 20,
    periods: DEFAULT_PERIODS,
    courseLeadMinutes: 15,
    homeworkLeadMinutes: 120,
    dailyDigestTime: '08:00',
    dailyDigestEnabled: true,
    channels: { local: true, webpush: false, wechat: false },
    wechatKey: '',
    wechatProxy: '',
    pushServerUrl: '',
    vapidPublicKey: '',
    ai: {
      provider: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      model: 'deepseek-chat',
      embedBaseUrl: 'https://api.deepseek.com/v1',
      embedApiKey: '',
      embedModel: '',
      proxy: false,
      proxyUrl: 'http://localhost:8787',
    },
    autoSummarize: false,
    ocrLang: 'chi_sim+eng',
    theme: 'light',
    updatedAt: Date.now(),
  }
}

/**
 * AI 服务商预设。
 *
 * `direct` = 浏览器能不能直接连(2026-11 实测预检响应是否带 CORS 头)。
 *   true  → 填 Key 就能用,不需要任何服务器
 *   false → 浏览器直连会被跨域拦,需要开「设置 → 通过本地服务转发」
 *
 * `keyUrl` = 申请 API Key 的控制台地址,省得自己搜。
 */
export interface AiPreset {
  id: string
  label: string
  provider: 'openai' | 'anthropic'
  baseUrl: string
  model: string
  embedBaseUrl: string
  embedModel: string
  /** 浏览器直连是否可用 */
  direct: boolean
  /** 申请 Key 的地方 */
  keyUrl: string
  /** 一句话说明这个服务商的坑 */
  note: string
}

export const AI_PRESETS: AiPreset[] = [
  {
    id: 'doubao',
    label: '豆包 / 火山方舟(字节)',
    provider: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-1-5-pro-32k-250115',
    embedBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    embedModel: 'doubao-embedding-text-240715',
    direct: true,
    keyUrl: 'https://console.volcengine.com/ark/region:cn-beijing/apiKey',
    note: '模型名可填「模型 ID」或你自己建的接入点 ID(ep- 开头);上海/广州地域把地址改成 ark.cn-shanghai / ark.cn-guangzhou',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek(便宜、够用)',
    provider: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    embedBaseUrl: '',
    embedModel: '',
    direct: true,
    keyUrl: 'https://platform.deepseek.com/api_keys',
    note: 'DeepSeek 没有向量模型,想用语义检索就另配一个(推荐硅基流动)',
  },
  {
    id: 'qwen',
    label: '通义千问(阿里 DashScope)',
    provider: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    embedBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    embedModel: 'text-embedding-v3',
    direct: true,
    keyUrl: 'https://bailian.console.aliyun.com/',
    note: '用的是兼容模式地址,不是百炼的原生 API;模型名还有 qwen-max / qwen-turbo',
  },
  {
    id: 'kimi',
    label: 'Kimi / 月之暗面',
    provider: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    embedBaseUrl: '',
    embedModel: '',
    direct: true,
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    note: '长文本可以用 moonshot-v1-32k',
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow(含向量模型)',
    provider: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    embedBaseUrl: 'https://api.siliconflow.cn/v1',
    embedModel: 'BAAI/bge-m3',
    direct: true,
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    note: '模型全都有,包括便宜的向量模型 BAAI/bge-m3,做语义检索最省事',
  },
  {
    id: 'hunyuan',
    label: '腾讯混元',
    provider: 'openai',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    model: 'hunyuan-turbo',
    embedBaseUrl: '',
    embedModel: '',
    direct: true,
    keyUrl: 'https://cloud.tencent.com/product/hunyuan',
    note: '腾讯云密钥是「SecretId + SecretKey」两段,不是一把 sk-',
  },
  {
    id: 'qianfan',
    label: '百度千帆',
    provider: 'openai',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    model: 'ernie-4.0-8k',
    embedBaseUrl: '',
    embedModel: '',
    direct: true,
    keyUrl: 'https://console.bce.baidu.com/qianfan/ais/console/apikeylist',
    note: '千帆的 Key 是「API Key + Secret Key」两段',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    provider: 'openai',
    baseUrl: 'https://api.minimaxi.com/v1',
    model: 'MiniMax-Text-01',
    embedBaseUrl: '',
    embedModel: '',
    direct: true,
    keyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    note: '国内用 api.minimaxi.com,海外用 api.minimax.io',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter(一个 Key 用遍各家模型)',
    provider: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-3.5-sonnet',
    embedBaseUrl: '',
    embedModel: '',
    direct: true,
    keyUrl: 'https://openrouter.ai/keys',
    note: '模型名格式是「厂商/模型」,在 openrouter.ai/models 里查',
  },
  {
    id: 'glm',
    label: '智谱 GLM',
    provider: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-plus',
    embedBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    embedModel: 'embedding-3',
    direct: false,
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    note: '⚠ 智谱的预检响应不带 CORS 头,浏览器直连会被拦 —— 需要开「通过本地服务转发」',
  },
  {
    id: 'openai',
    label: 'OpenAI 官方',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    embedBaseUrl: 'https://api.openai.com/v1',
    embedModel: 'text-embedding-3-small',
    direct: false,
    keyUrl: 'https://platform.openai.com/api-keys',
    note: '⚠ 官方接口禁止浏览器直连(防止 Key 泄露)—— 需要开「通过本地服务转发」,且国内需要梯子',
  },
  {
    id: 'groq',
    label: 'Groq(极快,免费额度大)',
    provider: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    embedBaseUrl: '',
    embedModel: '',
    direct: false,
    keyUrl: 'https://console.groq.com/keys',
    note: '⚠ 预检被 403 拦下 —— 需要开「通过本地服务转发」',
  },
  {
    id: 'claude',
    label: 'Claude(需浏览器直连头)',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-20250514',
    embedBaseUrl: '',
    embedModel: '',
    direct: true,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    note: '走的是 Anthropic 原生 /messages 协议,不是 OpenAI 兼容;国内需要梯子',
  },
  {
    id: 'custom',
    label: '自定义 OpenAI 兼容接口',
    provider: 'openai',
    baseUrl: '',
    model: '',
    embedBaseUrl: '',
    embedModel: '',
    direct: true,
    keyUrl: '',
    note: '任何 OpenAI 兼容的服务都能用:地址 + Key + 模型名,填对就行',
  },
]

/** 依日期猜一个常见学期起点 */
export function guessSemesterStart(now = new Date()): string {
  const y = now.getFullYear()
  const candidates = [
    `${y}-02-17`,
    `${y}-02-24`,
    `${y}-09-07`,
    `${y - 1}-09-08`,
  ]
  const mondays = candidates.filter((c) => mondayOf(parseDate(c)).getDay() === 1)
  return mondays[0] ?? formatDate(mondayOf(now))
}
