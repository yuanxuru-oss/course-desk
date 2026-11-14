import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  KeyRound,
  Loader2,
  ShieldCheck,
  Sparkles,
  Wand2,
  AlertTriangle,
} from 'lucide-react'
import { Modal, Button } from './ui'
import type { AiConfig } from '../types'
import { AI_PRESETS, type AiPreset } from '../lib/settings'
import { testConnection, explainAiError } from '../lib/ai'
import { cn } from '../lib/utils'

interface Props {
  open: boolean
  onClose: () => void
  ai: AiConfig
  onApplyPreset: (preset: AiPreset) => void
  onToast: (text: string, type?: 'info' | 'success' | 'error') => void
  /** 配置好了就跳到 AI 页面试试 */
  onFinish?: () => void
}

const STEPS = ['选服务商', '拿 Key', '填进去', '测一下'] as const

/**
 * AI 配置指引。
 *
 * 为什么需要它:AI 这块对不折腾的人是黑箱 ——
 * 「API Key 去哪拿」「地址填什么」「为什么有的要开转发」,
 * 不解释清楚,大部分人会停在第一步。
 */
export function AiSetupGuide({ open, onClose, ai, onApplyPreset, onToast, onFinish }: Props) {
  const [step, setStep] = useState(0)
  const [picked, setPicked] = useState<AiPreset | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  const wasOpen = useRef(false)
  useEffect(() => {
    /*
     * 只在「刚打开」时重置。
     * 之前依赖里带了 ai.baseUrl,于是一选服务商 → 设置被改 → baseUrl 变化 →
     * 这个 effect 又把步骤打回第 1 步,看起来像点了没反应。
     */
    if (open && !wasOpen.current) {
      setStep(0)
      setTestResult(null)
      const current = AI_PRESETS.find((p) => p.baseUrl && ai.baseUrl.startsWith(p.baseUrl.replace(/\/+$/, '')))
      setPicked(current ?? null)
    }
    wasOpen.current = open
  }, [open, ai.baseUrl])

  const hasKey = !!ai.apiKey?.trim()

  const pick = (preset: AiPreset) => {
    setPicked(preset)
    onApplyPreset(preset)
    setTestResult(null)
    setStep(1)
  }

  const runTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const out = await testConnection(ai)
      setTestResult({ ok: true, text: out || '连接成功' })
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      setTestResult({ ok: false, text: explainAiError(msg) ?? msg })
    } finally {
      setTesting(false)
    }
  }

  const canNext = step === 0 ? !!picked : step === 1 ? true : step === 2 ? hasKey : true

  const footer = (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setStep((s) => Math.max(0, s - 1))}
        disabled={step === 0}
        className="mr-auto"
      >
        <ArrowLeft size={14} /> 上一步
      </Button>
      {step < STEPS.length - 1 ? (
        <Button size="sm" variant="primary" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
          下一步 <ArrowRight size={14} />
        </Button>
      ) : (
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            onClose()
            onFinish?.()
          }}
        >
          完成 <Check size={14} />
        </Button>
      )}
    </>
  )

  return (
    <Modal open={open} onClose={onClose} title="配置 AI 助手" wide footer={footer}>
      {/* 步骤条 */}
      <div className="flex items-center gap-1.5 mb-5">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-1.5 flex-1 min-w-0">
            <div
              className={cn(
                'w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold shrink-0 transition-colors',
                i < step
                  ? 'bg-tangerine-500 text-white'
                  : i === step
                    ? 'bg-ink text-white'
                    : 'bg-butter-200 text-ink-mute',
              )}
            >
              {i < step ? <Check size={12} /> : i + 1}
            </div>
            <span
              className={cn(
                'text-[11.5px] truncate',
                i === step ? 'text-ink font-semibold' : 'text-ink-mute',
              )}
            >
              {s}
            </span>
            {i < STEPS.length - 1 && <div className="h-[2px] flex-1 bg-ink/[0.08] rounded-full" />}
          </div>
        ))}
      </div>

      {/* 1. 选服务商 */}
      {step === 0 && (
        <div className="space-y-3">
          <p className="text-[13px] text-ink-soft leading-relaxed">
            先选一家服务商。<b>选哪个都能用</b>,区别只是价格、速度和要不要多开一个转发服务。
            不确定就选 <b>DeepSeek</b>(最便宜)或 <b>豆包 / 火山方舟</b>(国内速度最稳)。
          </p>
          <div className="grid gap-2">
            {AI_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => pick(p)}
                className={cn(
                  'w-full text-left rounded-xl border-2 px-3 py-2.5 transition-colors',
                  picked?.id === p.id
                    ? 'border-tangerine-500 bg-tangerine-50'
                    : 'border-ink/[0.1] bg-white hover:border-tangerine-300 hover:bg-butter-50',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-ink">{p.label}</span>
                  <span
                    className={
                      p.direct
                        ? 'text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-grass-100 text-grass-700'
                        : 'text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-butter-200 text-ink-soft'
                    }
                  >
                    {p.direct ? '填了就能用' : '需要开转发'}
                  </span>
                </div>
                <div className="text-[11.5px] text-ink-mute mt-0.5 leading-snug">{p.note}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 2. 拿 Key */}
      {step === 1 && (
        <div className="space-y-4">
          <p className="text-[13px] text-ink-soft leading-relaxed">
            去 <b>{picked?.label}</b> 的控制台注册账号,在「API Key」页面创建一个 Key 复制下来。
            大多数服务商注册时要做实名认证,新账号通常还送一些免费额度。
          </p>
          {picked && (
            <a
              href={picked.keyUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 h-9 px-3 rounded-xl bg-tangerine-500 text-white text-[13px] font-semibold hover:bg-tangerine-600 transition-colors"
            >
              <ExternalLink size={14} /> 打开 {picked.label} 的 Key 页面
            </a>
          )}
          <div className="rounded-xl bg-butter-100/70 p-3.5 text-[12.5px] text-ink-soft leading-relaxed space-y-1.5">
            <div className="flex items-center gap-1.5 font-medium text-ink">
              <KeyRound size={13} className="text-tangerine-600" /> 它长什么样
            </div>
            <p>
              一般是一串以 <code className="px-1 rounded bg-white border border-ink/10">sk-</code> 开头、
              或者类似 <code className="px-1 rounded bg-white border border-ink/10">SCT...</code> 的字符。
              腾讯云、百度千帆的 Key 是<b>两段式</b>(ID + Key),要两段都填。
            </p>
          </div>
          <div className="flex items-start gap-2 rounded-xl bg-cherry-500/8 border border-cherry-500/20 p-3">
            <ShieldCheck size={14} className="text-cherry-500 shrink-0 mt-0.5" />
            <p className="text-[12px] text-ink-soft leading-relaxed">
              Key 相当于你的钱包密码:只填在课程桌里,别发群里、别截图发出去。
              它只保存在这台设备的浏览器里,课程桌没有服务器,不会传走。
            </p>
          </div>
        </div>
      )}

      {/* 3. 填进去 */}
      {step === 2 && (
        <div className="space-y-4">
          <p className="text-[13px] text-ink-soft leading-relaxed">
            地址和模型名在选服务商时已经自动填好了,<b>你只要把 Key 贴进设置里的「API Key」这一栏</b>。
          </p>
          <div className="rounded-xl bg-white border-2 border-ink/[0.08] divide-y divide-ink/[0.06] text-[12.5px]">
            <GuideRow label="API 地址" value={ai.baseUrl || '(空)'} state="已自动填好" />
            <GuideRow label="模型名" value={ai.model || '(空)'} state="已自动填好" />
            <GuideRow label="API Key" value={hasKey ? '已填写 ✓' : '(还没填)'} state={hasKey ? '好' : '待填'} />
          </div>
          {!hasKey && (
            <div className="flex items-start gap-2 rounded-xl bg-butter-100 border border-ink/10 p-3">
              <Wand2 size={14} className="text-tangerine-600 shrink-0 mt-0.5" />
              <p className="text-[12px] text-ink-soft leading-relaxed">
                先点下面的「上一步」回到上一步,然后关掉这个指引 → 在设置页「AI 助手」里把 Key 粘贴到 API Key,
                再回来点「测一下」。
              </p>
            </div>
          )}
          {picked && !picked.direct && (
            <div className="flex items-start gap-2 rounded-xl bg-butter-100 border border-ink/10 p-3">
              <AlertTriangle size={14} className="text-tangerine-600 shrink-0 mt-0.5" />
              <p className="text-[12px] text-ink-soft leading-relaxed">
                {picked.label} 不允许浏览器直接连(会被跨域拦)。已经自动帮你勾上「通过本地服务转发」了 ——
                在电脑上跑一下 <code className="px-1 rounded bg-white border border-ink/10">server/</code>
                那个小服务就行(README 里有命令),手机上用的话建议先选一个「填了就能用」的服务商。
              </p>
            </div>
          )}
        </div>
      )}

      {/* 4. 测一下 */}
      {step === 3 && (
        <div className="space-y-4">
          <p className="text-[13px] text-ink-soft leading-relaxed">
            点一下测试,课程桌会向服务商发一条很短的请求。成功就说明配好了,AI 总结、知识库问答立刻可用。
          </p>
          <Button onClick={runTest} disabled={testing || !hasKey}>
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} 测试连接
          </Button>
          {!hasKey && (
            <p className="text-[12px] text-ink-mute">还没填 Key,先去设置页「AI 助手」里粘贴。</p>
          )}
          {testResult && (
            <div
              className={cn(
                'rounded-xl p-3 text-[12.5px] leading-relaxed',
                testResult.ok
                  ? 'bg-grass-100 text-grass-700 border border-grass-500/30'
                  : 'bg-cherry-500/8 text-ink-soft border border-cherry-500/25',
              )}
            >
              {testResult.ok ? '✓ ' : '✗ '}
              {testResult.text}
            </div>
          )}

          <div className="rounded-xl bg-butter-100/70 p-3.5 text-[12px] text-ink-soft leading-relaxed">
            <div className="font-medium text-ink mb-1.5">配完之后能做什么</div>
            <ul className="space-y-1 list-disc pl-4">
              <li>备忘里的「AI 总结」:把一节课的笔记压成重点</li>
              <li>AI 页的「知识库问答」:只用你自己的笔记和课件回答</li>
              <li>导入课表时把整段文字丢进去,自动拆成课程</li>
            </ul>
            <p className="mt-2 text-ink-mute">
              不配也完全不影响主功能 —— 课表、作业、备忘、提醒都不需要 AI。
            </p>
          </div>
        </div>
      )}

      {/* 常见问题 */}
      <details className="mt-4 rounded-xl bg-butter-50 border border-ink/[0.08] px-3.5 py-2.5">
        <summary className="text-[12.5px] font-medium text-ink-soft cursor-pointer select-none">
          常见问题(点开)
        </summary>
        <div className="mt-2 space-y-2 text-[12px] text-ink-soft leading-relaxed">
          <p>
            <b>「需要开转发」是什么意思?</b> 有些服务商(OpenAI 官方、智谱、Groq)不允许网页直接调用,
            必须由一个小程序在中间转一手。课程桌自带了这个程序,在 `server/` 目录,电脑上跑一次就行。
          </p>
          <p>
            <b>向量模型是什么,必须填吗?</b> 不必须。填了之后「知识库问答」能从「关键词匹配」升级成「理解意思」,
            找资料更准。不填照样能用。
          </p>
          <p>
            <b>要花很多钱吗?</b> 一次总结几分钱。日常用一个月通常不到几块钱,而且大多数服务商送额度。
          </p>
          <p>
            <b>不想配怎么办?</b> 完全不用配。AI 只是加分项,课表、作业、备忘、提醒、导入全都不依赖它。
          </p>
        </div>
      </details>
    </Modal>
  )
}

function GuideRow({ label, value, state }: { label: string; value: string; state: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="text-ink-mute w-16 shrink-0">{label}</span>
      <span className="flex-1 min-w-0 truncate font-mono text-ink">{value}</span>
      <span className="text-[11px] text-ink-mute shrink-0">{state}</span>
    </div>
  )
}

/** 设置页 AI 区域顶部那条「不会配?」的提示 */
export function AiGuideBanner({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-xl border-2 border-dashed border-tangerine-300 bg-tangerine-50/60 px-3.5 py-3 hover:bg-tangerine-50 transition-colors group"
    >
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-tangerine-500 text-white grid place-items-center shrink-0">
          <Wand2 size={14} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-ink">第一次配 AI?跟着指引走一遍</div>
          <div className="text-[11.5px] text-ink-mute">
            选服务商 → 拿 Key → 填进去 → 测连接,大约 1 分钟
          </div>
        </div>
        <ArrowRight size={15} className="text-tangerine-600 shrink-0 group-hover:translate-x-0.5 transition-transform" />
      </div>
    </button>
  )
}
