import { useEffect, useState } from 'react'
import {
  Bell,
  BellRing,
  MessageSquare,
  Cloud,
  Sparkles,
  Server,
  Database,
  Download,
  Upload,
  Trash2,
  Check,
  Loader2,
  Smartphone,
  Info,
  CalendarClock,
  Save,
  Clock,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react'
import type { Settings } from '../types'
import { Card, Button, Badge, Field, Input, Select, Toggle, Collapse, Eyebrow } from './ui'
import { AI_PRESETS } from '../lib/settings'
import type { AiPreset } from '../lib/settings'
import { ScheduleSettings } from './ScheduleSettings'
import {
  currentPermission,
  requestNotificationPermission,
  showNotification,
  type NotifyPermission,
} from '../lib/notify'
import { subscribePush, registerSubscription, pingServer, currentSubscription } from '../lib/push'
import { testWechat } from '../lib/wechat'
import { testConnection, explainAiError, listModels } from '../lib/ai'
import { BUILD_ID } from '../lib/version'
import { db } from '../db'
import { useApp } from '../store'
import { storageEstimate } from '../db'
import { formatBytes } from '../lib/utils'
import { canInstall, promptInstall, isStandalone, isIOS, onInstallChange } from '../lib/pwa'
import { AiSetupGuide, AiGuideBanner } from './AiSetupGuide'
import { BackupActions } from './BackupActions'
import { DangerZone } from './DangerZone'
import { syncScheduleToServer } from '../lib/reminderEngine'

const COMMON_MODELS = ['gpt-4o-mini', 'gpt-4o', 'claude-3-5-sonnet-20241022', 'deepseek-chat', 'qwen-plus', 'glm-4-plus']

interface Props {
  settings: Settings
  onToast: (text: string, type?: 'info' | 'success' | 'error') => void
}

export function SettingsView({ settings, onToast }: Props) {
  const [local, setLocal] = useState<Settings>(settings)
  const [perm, setPerm] = useState<NotifyPermission>(currentPermission())
  const [busy, setBusy] = useState('')
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)
  // 当前网址:在线版每次部署换域名,数据按域名隔离,得让用户看得见自己在哪
  const [origin, setOrigin] = useState('')
  useEffect(() => setOrigin(location.origin), [])
  const [installable, setInstallable] = useState(canInstall())
  const [standalone, setStandalone] = useState(isStandalone())
  // beforeinstallprompt 可能在组件挂载之后才到,不订阅就永远显示「暂不支持一键安装」
  useEffect(() => onInstallChange(() => setInstallable(canInstall())), [])
  /** 刚选了哪个预设,用来显示直连状态和申请 Key 入口 */
  const [presetNote, setPresetNote] = useState<AiPreset | null>(null)
  /** AI 配置指引(手把手那套) */
  const [guideOpen, setGuideOpen] = useState(false)
  /** 从服务商拉到的模型列表(拉不到就退回手填) */
  const [models, setModels] = useState<string[]>([])
  const [modelBusy, setModelBusy] = useState(false)
  const [modelErr, setModelErr] = useState<{ msg: string; hint?: string; preview?: string } | null>(null)

  /**
   * 拿到模型列表。带一个很实用的兜底:
   * 「通过本地服务转发」开着但本地服务没跑时,所有请求都会打去 localhost:8787 然后失败。
   * 这时自动试一次直连 —— 你这家中转站/服务商如果本身允许跨域,直连就能通,
   * 于是就顺手把转发关掉并说明,而不是让用户对着一句「连接失败」干瞪眼。
   */
  const fetchModels = async () => {
    setModelBusy(true)
    setModelErr(null)
    let ai = local.ai
    let autoSwitched = false
    try {
      let r
      try {
        r = await listModels(ai)
      } catch (err) {
        if (!local.ai.proxy) throw err
        const direct = { ...local.ai, proxy: false }
        try {
          r = await listModels(direct)
          ai = direct
          autoSwitched = true
        } catch (err2: any) {
          /*
           * 直连收到了服务端的回应(哪怕 401「Key 无效」)→ 说明浏览器能直接连,
           * 根本不需要转发。顺手把转发关掉,免得用户下次又被 localhost:8787 绊倒。
           */
          if (!/请求没有发出去/.test(String(err2?.message ?? ''))) {
            await save({ ai: direct })
          }
          throw err2
        }
      }
      setModels(r.models)
      if (autoSwitched) {
        await save({ ai: { ...ai, proxy: false } })
        onToast('本地转发服务没连上,但直连可以用 —— 已自动切回直连', 'info')
      }
      // 地址少写了 /v1 也能自动纠正,省得用户自己试
      if (r.suggestedBaseUrl && r.suggestedBaseUrl !== ai.baseUrl) {
        await save({ ai: { ...ai, baseUrl: r.suggestedBaseUrl } })
        onToast(`地址已自动补成 ${r.suggestedBaseUrl}`, 'info')
      }
      // 当前模型不在列表里(或还没填)→ 自动选第一个,省得用户再猜
      if (!ai.model || !r.models.includes(ai.model)) {
        await save({ ai: { ...ai, model: r.models[0] } })
      }
      onToast(`拉取到 ${r.models.length} 个模型`, 'success')
    } catch (err: any) {
      setModels([])
      setModelErr({
        msg: err?.message ?? String(err),
        hint: err?.hint ?? explainAiError(String(err?.message ?? '')),
        preview: err?.bodyPreview,
      })
    } finally {
      setModelBusy(false)
    }
  }

  /** 套用服务商预设:地址/模型名自动填,不能直连的自动开转发 */
  const applyPreset = (preset: AiPreset) => {
    setPresetNote(preset)
    save({
      ai: {
        ...local.ai,
        provider: preset.provider,
        baseUrl: preset.baseUrl || local.ai.baseUrl,
        model: preset.model || local.ai.model,
        embedBaseUrl: preset.embedBaseUrl || local.ai.embedBaseUrl,
        embedModel: preset.embedModel || local.ai.embedModel,
        // 浏览器不能直连的服务商,自动打开本地转发
        proxy: preset.direct ? local.ai.proxy : true,
      },
    })
  }

  useEffect(() => setLocal(settings), [settings])

  useEffect(() => {
    storageEstimate().then(setStorage)
  }, [])

  const save = async (patch: Partial<Settings>) => {
    const prev = local
    const next = { ...local, ...patch }
    setLocal(next)
    try {
      // 写库失败要回滚并告诉用户,否则界面显示「已保存」、刷新后静默变回去
      await useApp.getState().saveSettings(patch)
    } catch (err: any) {
      setLocal(prev)
      onToast(`设置保存失败:${err?.message ?? err}`, 'error')
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <div className="flex items-center gap-2 mb-2.5">
          <Eyebrow tone="butter">工具</Eyebrow>
        </div>
        <h1 className="page-title">设置</h1>
        <p className="page-sub">学期、提醒通道、AI 与数据管理</p>
      </div>

      {/* 备份与迁移 —— 刻意放在最上面:换设备/换网址时,这是唯一能救命的功能 */}
      <Card className="overflow-hidden border-2 border-tangerine-200">
        <SectionHeader icon={<Database size={15} />} title="备份与迁移" />
        <div className="p-4 space-y-3">
          {storage && (
            <div className="rounded-xl bg-butter-50 p-3 text-[12.5px] text-ink-soft">
              <div className="flex items-center gap-2 mb-1.5">
                <span>本地已用 {formatBytes(storage.usage)}</span>
                {storage.quota > 0 && <span className="text-ink-mute">/ 可用约 {formatBytes(storage.quota)}</span>}
              </div>
              <div className="h-1.5 rounded-full bg-butter-200 overflow-hidden">
                <div
                  className="h-full bg-tangerine-500 rounded-full"
                  style={{ width: `${Math.min(100, (storage.usage / (storage.quota || 1)) * 100)}%` }}
                />
              </div>
              <p className="text-[11.5px] text-ink-mute mt-1.5">
                所有数据都存在这台设备的浏览器里,不上传云端。
              </p>
            </div>
          )}

          <BackupActions onToast={onToast} onImported={() => setTimeout(() => location.reload(), 1600)} />

          <DangerZone onToast={onToast} />
        </div>
      </Card>

      {/* 作息时间(按学校调整) */}
      <Card className="overflow-hidden">
        <SectionHeader icon={<Clock size={15} />} title="作息时间(按学校调整)" />
        <div className="p-4">
          <ScheduleSettings settings={settings} onSave={save} onToast={onToast} />
        </div>
      </Card>

      {/* 学期 */}
      <Card className="overflow-hidden">
        <SectionHeader icon={<CalendarClock size={15} />} title="学期设置" />
        <div className="p-4 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="第一周周一" hint="用来换算「当前是第几周」">
              <Input
                type="date"
                value={local.semesterStart}
                onChange={(e) => save({ semesterStart: e.target.value })}
              />
            </Field>
            <Field label="学期总周数">
              <Input
                type="number"
                min={1}
                max={30}
                value={local.weekCount}
                onChange={(e) => save({ weekCount: Number(e.target.value) })}
              />
            </Field>
          </div>
        </div>
      </Card>

      {/* 提醒 */}
      <Card className="overflow-hidden">
        <SectionHeader icon={<Bell size={15} />} title="提醒设置" />
        <div className="p-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="课程提前提醒(分钟)">
              <Input
                type="number"
                min={0}
                max={180}
                value={local.courseLeadMinutes}
                onChange={(e) => save({ courseLeadMinutes: Number(e.target.value) })}
              />
            </Field>
            <Field label="作业提前提醒(分钟)">
              <Input
                type="number"
                min={0}
                max={2880}
                value={local.homeworkLeadMinutes}
                onChange={(e) => save({ homeworkLeadMinutes: Number(e.target.value) })}
              />
            </Field>
          </div>

          <Toggle
            checked={local.dailyDigestEnabled}
            onChange={(v) => save({ dailyDigestEnabled: v })}
            label="每天早安汇总"
            hint="每天固定时间推送当天课程与待办概览"
          />
          {local.dailyDigestEnabled && (
            <Field label="推送时间">
              <Input
                type="time"
                value={local.dailyDigestTime}
                className="w-32"
                onChange={(e) => save({ dailyDigestTime: e.target.value })}
              />
            </Field>
          )}
        </div>
      </Card>

      {/* 通道 */}
      <Card className="overflow-hidden">
        <SectionHeader icon={<BellRing size={15} />} title="通知通道" />
        <div className="p-4 space-y-4">
          {/* 本地通知 */}
          <div className="rounded-xl border border-ink/10 p-3.5">
            <div className="flex items-center gap-2 mb-2">
              <Smartphone size={14} className="text-ink-mute" />
              <span className="text-[13.5px] font-medium text-ink">系统通知</span>
              <Badge color={perm === 'granted' ? '#10b981' : perm === 'denied' ? '#ef4444' : '#94a3b8'}>
                {perm === 'granted' ? '已授权' : perm === 'denied' ? '已拒绝' : perm === 'unsupported' ? '不支持' : '未授权'}
              </Badge>
            </div>
            <p className="text-[12px] text-ink-soft leading-relaxed mb-2.5">
              页面打开时会准时弹窗。浏览器要求必须由用户手势触发授权,拒绝后需要在浏览器地址栏左侧的站点设置里手动恢复。
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  const r = await requestNotificationPermission()
                  setPerm(r)
                  onToast(r === 'granted' ? '已开启通知权限' : '未获得通知权限', r === 'granted' ? 'success' : 'error')
                }}
              >
                申请授权
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const ok = await showNotification('课程桌 · 测试通知', '这是一条测试消息,说明通知工作正常')
                  onToast(ok ? '测试通知已发送' : '通知未发送(权限未授予)', ok ? 'success' : 'error')
                }}
              >
                发一条测试
              </Button>
            </div>
          </div>

          {/* 微信 */}
          <div className="rounded-xl border border-ink/10 p-3.5">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare size={14} className="text-ink-mute" />
              <span className="text-[13.5px] font-medium text-ink">微信推送</span>
              <Badge color={local.channels.wechat ? '#10b981' : undefined}>
                {local.channels.wechat ? '已启用' : '未启用'}
              </Badge>
            </div>
            <p className="text-[12px] text-ink-soft leading-relaxed mb-3">
              用「Server 酱」把提醒推送到微信,手机上就能收到,不受电脑开关机影响。Key 在
              <span className="font-medium text-ink-soft"> sctapi.ftqq.com </span>
              免费申请。如果浏览器跨域被拦截,可以填下面的代理地址转发自建服务。
            </p>
            <div className="space-y-3">
              <Toggle
                checked={local.channels.wechat}
                onChange={(v) => save({ channels: { ...local.channels, wechat: v } })}
                label="启用微信通道"
              />
              <Field label="Server 酱 Key">
                <Input
                  value={local.wechatKey}
                  onChange={(e) => save({ wechatKey: e.target.value })}
                  placeholder="SCTxxxxxxxxxxxxxxxx"
                />
              </Field>
              <Field label="微信推送代理(可选)" hint="形如 https://你的域名/api/wechat,留空则直连 Server 酱">
                <Input
                  value={local.wechatProxy}
                  onChange={(e) => save({ wechatProxy: e.target.value })}
                  placeholder="https://..."
                />
              </Field>
              <Button
                size="sm"
                onClick={async () => {
                  const r = await testWechat(local)
                  onToast(r.message, r.ok ? 'success' : 'error')
                }}
              >
                测试微信通道
              </Button>
            </div>
          </div>

          {/* Web Push */}
          <div className="rounded-xl border border-ink/10 p-3.5">
            <div className="flex items-center gap-2 mb-2">
              <Cloud size={14} className="text-ink-mute" />
              <span className="text-[13.5px] font-medium text-ink">Web Push(页面关闭也能收到)</span>
              <Badge color={local.channels.webpush ? '#10b981' : undefined}>
                {local.channels.webpush ? '已启用' : '未启用'}
              </Badge>
            </div>
            <p className="text-[12px] text-ink-soft leading-relaxed mb-3">
              PWA 的网页通知在页面关闭后会失效。配置自建推送服务后,提醒由服务端按时下发,
              关掉浏览器也能收到。仓库里的 <code className="bg-butter-100 px-1 rounded">server/</code> 目录就是那个服务。
            </p>
            <div className="space-y-3">
              <Toggle
                checked={local.channels.webpush}
                onChange={(v) => save({ channels: { ...local.channels, webpush: v } })}
                label="启用 Web Push 通道"
              />
              <Field label="推送服务地址">
                <Input
                  value={local.pushServerUrl}
                  onChange={(e) => save({ pushServerUrl: e.target.value })}
                  placeholder="https://push.example.com"
                />
              </Field>
              <Field label="VAPID 公钥">
                <Input
                  value={local.vapidPublicKey}
                  onChange={(e) => save({ vapidPublicKey: e.target.value })}
                  placeholder="从推送服务 /api/health 获取"
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={async () => {
                    const ok = await pingServer(local.pushServerUrl)
                    onToast(ok ? '推送服务连接正常' : '连接不上推送服务', ok ? 'success' : 'error')
                  }}
                >
                  测试连接
                </Button>
                <Button
                  size="sm"
                  onClick={async () => {
                    if (!local.pushServerUrl || !local.vapidPublicKey) {
                      onToast('请先填写推送服务地址和 VAPID 公钥', 'error')
                      return
                    }
                    try {
                      const sub = await subscribePush(local.vapidPublicKey)
                      if (!sub) {
                        onToast('订阅失败,请确认浏览器支持 Push 且已授权通知', 'error')
                        return
                      }
                      const ok = await registerSubscription(local.pushServerUrl, sub)
                      onToast(ok ? '已订阅并注册到推送服务' : '注册到推送服务失败', ok ? 'success' : 'error')
                    } catch (err: any) {
                      onToast(`订阅失败:${err?.message ?? err}`, 'error')
                    }
                  }}
                >
                  订阅推送
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const sub = await currentSubscription()
                    onToast(sub ? '本设备已订阅' : '本设备未订阅', sub ? 'success' : 'info')
                  }}
                >
                  查看本机订阅
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* AI */}
      <Card className="overflow-hidden">
        <SectionHeader icon={<Sparkles size={15} />} title="AI 助手" />
        <div className="p-4 space-y-4">
          <AiGuideBanner onOpen={() => setGuideOpen(true)} />

          <Field label="服务商" hint="选一个预设,地址和模型名会自动填好,你只要贴 Key">
            <Select
              value=""
              onChange={(e) => {
                const preset = AI_PRESETS.find((p) => p.id === e.target.value)
                if (preset) applyPreset(preset)
              }}
            >
              <option value="">选择预设…</option>
              {AI_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.direct ? '' : ' · 需转发'}
                </option>
              ))}
            </Select>
          </Field>

          {presetNote && (
            <div
              className="rounded-2xl px-3.5 py-2.5 space-y-1.5"
              style={{
                backgroundColor: presetNote.direct ? '#EFF7F0' : '#FBEFE9',
                border: `2px solid ${presetNote.direct ? '#4FA35E' : '#BC5F4E'}33`,
              }}
            >
              <div className="flex items-start gap-2">
                <span className="text-[11.5px] font-bold" style={{ color: presetNote.direct ? '#376F42' : '#BC5F4E' }}>
                  {presetNote.direct ? '✓ 浏览器可直接调用' : '⚠ 需要通过本地服务转发'}
                </span>
                {presetNote.keyUrl && (
                  <a
                    href={presetNote.keyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto text-[11.5px] font-semibold text-tangerine-600 underline underline-offset-2 whitespace-nowrap"
                  >
                    去申请 API Key ↗
                  </a>
                )}
              </div>
              <p className="text-[11.5px] text-ink-soft leading-relaxed">{presetNote.note}</p>
            </div>
          )}

          <Field label="接口协议">
            <Select
              value={local.ai.provider}
              onChange={(e) => {
                setModels([])
                setModelErr(null)
                save({ ai: { ...local.ai, provider: e.target.value as 'openai' | 'anthropic' } })
              }}
            >
              <option value="openai">OpenAI 兼容(DeepSeek / 豆包 / 通义 / 硅基流动…)</option>
              <option value="anthropic">Anthropic Claude</option>
            </Select>
          </Field>

          <Field label="API 地址" hint="OpenAI 兼容接口通常以 /v1 结尾">
            <Input
              value={local.ai.baseUrl}
              onChange={(e) => {
                // 地址一改,之前拉到的模型就不作数了
                setModels([])
                setModelErr(null)
                save({ ai: { ...local.ai, baseUrl: e.target.value } })
              }}
            />
          </Field>
          <Field label="API Key" hint="只保存在这台设备的浏览器里,不会上传到任何第三方服务器">
            <Input
              type="password"
              value={local.ai.apiKey}
              onChange={(e) => {
                setModels([])
                setModelErr(null)
                save({ ai: { ...local.ai, apiKey: e.target.value } })
              }}
              placeholder="sk-..."
            />
          </Field>
          <Field label="模型名" hint="填好地址和 Key 后点「获取模型」,直接选,不用手打">
            <div className="flex gap-2">
              {models.length > 0 ? (
                <Select
                  value={models.includes(local.ai.model) ? local.ai.model : ''}
                  onChange={(e) => save({ ai: { ...local.ai, model: e.target.value } })}
                  className="flex-1"
                >
                  {!models.includes(local.ai.model) && (
                    <option value="">{local.ai.model ? `当前:${local.ai.model}(不在列表里)` : '选择模型…'}</option>
                  )}
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  value={local.ai.model}
                  onChange={(e) => save({ ai: { ...local.ai, model: e.target.value } })}
                  placeholder="点右边「获取模型」自动填,或手填 deepseek-chat"
                  className="flex-1"
                />
              )}
              <Button size="sm" variant="secondary" onClick={fetchModels} disabled={modelBusy}>
                {modelBusy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {models.length ? '重新拉取' : '获取模型'}
              </Button>
            </div>
          </Field>

          {models.length === 0 && (
            <div className="flex flex-wrap items-center gap-1.5 -mt-1">
              <span className="text-[11px] text-ink-mute">常用模型:</span>
              {COMMON_MODELS.map((m) => (
                <button
                  key={m}
                  onClick={() => save({ ai: { ...local.ai, model: m } })}
                  className={
                    'text-[11px] px-2 py-0.5 rounded-full border transition-colors ' +
                    (local.ai.model === m
                      ? 'bg-tangerine-500 text-white border-tangerine-500'
                      : 'bg-white text-ink-soft border-ink/10 hover:border-tangerine-300 hover:text-ink')
                  }
                >
                  {m}
                </button>
              ))}
            </div>
          )}

          {modelErr && (
            <div className="rounded-xl bg-cherry-500/8 border border-cherry-500/25 p-3 space-y-1.5">
              <div className="flex items-start gap-1.5 text-[12px] text-ink leading-relaxed">
                <AlertTriangle size={13} className="text-cherry-500 shrink-0 mt-0.5" />
                <span>拉取模型列表失败:{modelErr.msg}</span>
              </div>
              {modelErr.hint && (
                <p className="text-[11.5px] text-ink-soft leading-relaxed pl-5">{modelErr.hint}</p>
              )}
              {modelErr.preview && (
                <div className="pl-5">
                  <div className="text-[11px] text-ink-mute mb-1">服务商实际返回(前 240 字):</div>
                  <pre className="text-[10.5px] text-ink-soft bg-white/70 border border-ink/10 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-all">
                    {modelErr.preview}
                  </pre>
                </div>
              )}
              <p className="text-[11px] text-ink-mute pl-5">
                也可以先跳过,直接手填模型名再点「测试连接」。
              </p>
            </div>
          )}

          <Collapse title="向量模型(可选,用于语义检索)" defaultOpen={!!local.ai.embedModel}>
            <div className="space-y-3 pt-2">
              <Field label="Embedding API 地址" hint="留空则复用上面的地址">
                <Input
                  value={local.ai.embedBaseUrl}
                  onChange={(e) => save({ ai: { ...local.ai, embedBaseUrl: e.target.value } })}
                  placeholder="https://api.siliconflow.cn/v1"
                />
              </Field>
              <Field label="Embedding Key" hint="留空则复用上面的 Key">
                <Input
                  type="password"
                  value={local.ai.embedApiKey}
                  onChange={(e) => save({ ai: { ...local.ai, embedApiKey: e.target.value } })}
                />
              </Field>
              <Field label="Embedding 模型名">
                <Input
                  value={local.ai.embedModel}
                  onChange={(e) => save({ ai: { ...local.ai, embedModel: e.target.value } })}
                  placeholder="BAAI/bge-m3"
                />
              </Field>
            </div>
          </Collapse>

          {/* 跨域兜底:智谱 / OpenAI 官方 / Groq 之类必须走转发 */}
          <div className="rounded-2xl border-2 border-ink/[0.08] px-3.5 py-1">
            <Toggle
              checked={!!local.ai.proxy}
              onChange={(v) => save({ ai: { ...local.ai, proxy: v } })}
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Server size={13} /> 通过本地服务转发
                </span>
              }
              hint="浏览器直连被跨域拦下时打开它(智谱 / OpenAI 官方 / Groq)。需要先在项目目录跑 node server/index.js"
            />
            {local.ai.proxy && (
              <div className="pt-2 pb-2">
                <div className="flex items-start gap-1.5 rounded-xl bg-butter-100 border border-ink/10 p-2.5 mb-2">
                  <AlertTriangle size={13} className="text-tangerine-600 shrink-0 mt-0.5" />
                  <p className="text-[11.5px] text-ink-soft leading-relaxed">
                    开着转发时,所有请求都会先发给这个本地服务。<b>没跑起来 = 全部连接失败</b>。
                    如果你的服务商/中转站本身允许浏览器直连,建议关掉它(点「获取模型」也能自动判断并切回直连)。
                  </p>
                </div>
                <Field label="本地服务地址">
                  <Input
                    value={local.ai.proxyUrl ?? 'http://localhost:8787'}
                    onChange={(e) => save({ ai: { ...local.ai, proxyUrl: e.target.value } })}
                    placeholder="http://localhost:8787"
                  />
                </Field>
                <p className="text-[11.5px] text-ink-mute leading-relaxed mt-1.5">
                  Key 由浏览器直接交给本地服务转发,服务端只做一次性转发,不写盘、不记录。
                </p>
              </div>
            )}
          </div>

          {/* 「笔记保存后自动生成 AI 总结」原来是个死开关:
              没有任何代码读 autoSummarize,打开后什么都不会发生。
              与其给一个假承诺,不如先撤掉;要做得在笔记保存链路里真接上。 */}

          <Button
            size="sm"
            onClick={async () => {
              setBusy('ai')
              try {
                let out: string
                try {
                  out = await testConnection(local.ai)
                } catch (err) {
                  // 转发开着但本地服务没跑时,试一次直连(很多中转/服务商本身允许跨域)
                  if (!local.ai.proxy) throw err
                  const direct = { ...local.ai, proxy: false }
                  try {
                    out = await testConnection(direct)
                  } catch (err2: any) {
                    // 直连能拿到服务端回应 → 说明不需要转发,顺手关掉
                    if (!/请求没有发出去/.test(String(err2?.message ?? ''))) {
                      await save({ ai: direct })
                    }
                    throw err2
                  }
                  await save({ ai: direct })
                  onToast('本地转发服务没连上,但直连可以用 —— 已自动切回直连,再点一次测试确认', 'info')
                  return
                }
                onToast(`连接成功:${out}`, 'success')
              } catch (err: any) {
                const msg = err?.message ?? String(err)
                const friendly = err?.hint ?? explainAiError(msg)
                onToast(friendly ? `连接失败:${msg}｜${friendly}` : `连接失败:${msg}`, 'error')
              } finally {
                setBusy('')
              }
            }}
            disabled={busy === 'ai'}
          >
            {busy === 'ai' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} 测试连接
          </Button>

          <p className="text-[11.5px] text-ink-mute leading-relaxed -mt-1.5">
            Key 只存在这台设备的浏览器里,请求直接发给你选的服务商;只有勾了「通过本地服务转发」时才会经过你自己的本地服务。
          </p>
        </div>
      </Card>

      {/* 安装与关于 */}
      <Card className="overflow-hidden">
        <SectionHeader icon={<Info size={15} />} title="关于" />
        <div className="p-4 space-y-3">
          {!standalone && (
            <div className="rounded-xl bg-tangerine-50 border border-tangerine-100 p-3.5">
              <div className="text-[13.5px] font-medium text-ink mb-1">安装到桌面</div>
              <p className="text-[12px] text-ink-soft leading-relaxed mb-2.5">
                {isIOS()
                  ? '在 Safari 里点底部「分享」→「添加到主屏幕」,就能像 App 一样全屏使用。'
                  : '装成独立应用后有独立图标、全屏窗口,提醒也更稳定。'}
              </p>
              <Button
                size="sm"
                variant="primary"
                onClick={async () => {
                  const r = await promptInstall()
                  if (r === 'accepted') onToast('安装成功', 'success')
                  else if (r === 'unavailable') onToast('当前浏览器暂不支持一键安装,可手动用浏览器菜单添加', 'info')
                }}
              >
                <Download size={14} /> 立即安装
              </Button>
              {!installable && !isIOS() && (
                <p className="text-[11px] text-tangerine-700/70 mt-2">
                  提示:Chrome / Edge 地址栏右侧的安装图标也可以直接安装。
                </p>
              )}
            </div>
          )}
          <div className="text-[12px] text-ink-soft leading-relaxed space-y-1">
            <p>课程桌 CourseDesk · 大学生电子桌面课程表</p>
            <p>数据存储:本机 IndexedDB(离线可用)</p>
            <p>提醒通道:系统通知 / Web Push / 微信(Server 酱)</p>
            <p>
              版本 {BUILD_ID}
              {origin && (
                <>
                  {' · '}
                  当前网址{' '}
                  <span className="font-mono text-[11px] break-all">{origin}</span>
                </>
              )}
            </p>
          </div>
          {origin && (
            <div className="rounded-xl bg-butter-100 border border-butter-200 p-3">
              <p className="text-[12px] text-ink-soft leading-relaxed">
                <span className="font-medium text-ink">换网址前记得先导出备份。</span>
                <br />
                在线版每次更新都会换一个新网址,旧网址停留在当时那一版、不会跟着更新。
                而浏览器把数据按网址分开存,所以在旧网址录入的课表,在新网址里看不到。
                换网址时:先在旧网址「导出备份」,再到新网址「导入备份」。
              </p>
            </div>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const courses = await db.courses.toArray()
              const homework = await db.homework.toArray()
              const notes = await db.notes.toArray()
              await syncScheduleToServer(courses, homework, [], local)
              onToast('已尝试把提醒计划同步到推送服务', 'info')
            }}
          >
            <Save size={14} /> 同步提醒计划到推送服务
          </Button>
        </div>
      </Card>

      <AiSetupGuide
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        ai={local.ai}
        onApplyPreset={applyPreset}
        onToast={onToast}
      />
    </div>
  )
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="px-4 py-3 border-b border-ink/[0.08] flex items-center gap-2">
      <span className="text-ink-mute">{icon}</span>
      <h3 className="font-semibold text-ink text-[15px]">{title}</h3>
    </div>
  )
}
