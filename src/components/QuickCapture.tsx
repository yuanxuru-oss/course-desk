import { useEffect, useMemo, useState } from 'react'
import { ClipboardPaste, X, Check, PencilLine, Zap } from 'lucide-react'
import type { CourseEvent, Settings } from '../types'
import { upsertEvent } from '../lib/actions'
import { parseQuickCapture, isEditableTarget } from '../lib/quickCapture'
import type { QuickCapture as QuickCaptureHit } from '../lib/quickCapture'
import { EVENT_COLOR, eventKindMeta } from '../lib/event'
import { EventDialog } from './EventDialog'
import { Button } from './ui'

interface Props {
  settings: Settings
  onToast: (text: string, type?: 'info' | 'success' | 'error') => void
}

/** 「11/12 周三」这种短写法 */
function fmtWhen(date: string, weekly: boolean): string {
  const d = new Date(date)
  const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()} 周${wd}${weekly ? ' · 每周' : ''}`
}

/** 解析结果 → 可编辑的行程草稿 */
function toDraft(p: QuickCaptureHit['parsed']): CourseEvent {
  return {
    id: '',
    title: p.title,
    kind: p.kind,
    date: p.date,
    start: p.start,
    end: p.end,
    location: p.location,
    detail: p.detail,
    weekly: p.weekly,
    createdAt: 0,
    updatedAt: 0,
  }
}

/**
 * 全局速记 —— 在任何页面按 Ctrl+V,自动识别成行程。
 *
 * 和「添加行程」弹窗里的粘贴框是同一套解析器,
 * 区别只在于:那个要你专门跑过去,这个在哪儿都能用。
 */
export function QuickCapture({ settings, onToast }: Props) {
  const [hit, setHit] = useState<QuickCaptureHit | null>(null)
  const [editing, setEditing] = useState(false)
  /** 浏览器不给读剪贴板时的兜底:弹一个框让用户自己 Ctrl+V */
  const [manual, setManual] = useState(false)
  const [manualText, setManualText] = useState('')

  const tryParse = (text: string): boolean => {
    if (!text.trim()) return false
    const cap = parseQuickCapture(text, { now: new Date(), periods: settings.periods })
    if (!cap) return false
    setHit(cap)
    setEditing(false)
    setManual(false)
    setManualText('')
    return true
  }

  /* ---- 全局粘贴监听:文档级,和当前在哪个页面无关 ---- */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      // 粘到输入框/笔记里的,那是用户自己在输入,别插手
      if (isEditableTarget(e.target)) return
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (!text.trim()) return
      const cap = parseQuickCapture(text, { now: new Date(), periods: settings.periods })
      if (!cap) return // 不是活动消息 → 安静待着
      e.preventDefault()
      setHit(cap)
      setEditing(false)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [settings.periods])

  /* ---- 从剪贴板直接读(悬浮按钮)---- */
  const grab = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        onToast('剪贴板是空的,先复制一条消息', 'info')
        return
      }
      if (!tryParse(text)) {
        onToast('这段文字里没找到「日期 + 时间」,试试「周三下午3点 开党会 在教三302」', 'info')
      }
    } catch {
      /*
       * Chrome / Safari 默认不给网页读剪贴板(需要用户授权,而且授权弹窗经常被忽略)。
       * 之前这里只弹一句提示就结束,用户会觉得「粘贴功能坏了」。
       * 现在退一步:弹一个输入框,让用户在框里自己按 Ctrl+V —— 这是浏览器一定允许的操作。
       */
      setManual(true)
      setManualText('')
      onToast('浏览器不给直接读剪贴板,已在下方打开输入框,按 Ctrl+V 粘贴即可', 'info')
    }
  }

  const add = async (p: QuickCaptureHit['parsed']) => {
    try {
      await upsertEvent({
        title: p.title,
        kind: p.kind,
        date: p.date,
        start: p.start,
        end: p.end,
        location: p.location,
        detail: p.detail,
        weekly: p.weekly,
      })
      setHit(null)
      onToast(`「${p.title}」已加入课表,并同步到备忘`, 'success')
    } catch (err) {
      console.warn('[quick-capture]', err)
      onToast('添加失败,再试一次', 'error')
    }
  }

  // 草稿要稳定引用,否则弹窗每次渲染都会重置表单
  const draft = useMemo(() => (hit ? toDraft(hit.parsed) : null), [hit])

  const meta = hit ? eventKindMeta(hit.parsed.kind) : null

  return (
    <>
      {/* ============ 悬浮速记按钮:在哪都能点 ============
          位置刻意抬到右下角「上方一段」:
          很多静态托管平台会在页面右下角注入自己的悬浮控件(固定在距底约 20~60px),
          贴边放会被压住,按钮就点不动了。
          FAB 和识别卡片互斥显示,共用同一个锚点,所以抬一次就够。 */}
      {!hit && !manual && (
        <button
          onClick={grab}
          title="从剪贴板读取微信消息,自动识别成行程"
          className="fixed z-[45] bottom-24 right-4 lg:bottom-[76px] lg:right-6 h-11 pl-3.5 pr-4 rounded-full bg-tangerine-500 text-white shadow-sticker-lg flex items-center gap-1.5 text-[13px] font-bold hover:bg-tangerine-600 active:translate-y-[1px] active:shadow-none transition-all"
        >
          <ClipboardPaste size={16} />
          速记
        </button>
      )}

      {/* ============ 读不到剪贴板时的兜底输入框 ============ */}
      {manual && !hit && (
        <div className="fixed z-[90] bottom-24 left-3 right-3 lg:left-auto lg:right-6 lg:w-[356px] lg:bottom-[76px]">
          <div
            className="rounded-[26px] bg-[#fffdf5] shadow-sticker-lg overflow-hidden"
            style={{ border: `2px dashed ${EVENT_COLOR}` }}
          >
            <div className="px-4 pt-3.5 pb-2 flex items-center gap-2">
              <ClipboardPaste size={13} style={{ color: EVENT_COLOR }} className="shrink-0" />
              <span className="text-[12.5px] font-bold" style={{ color: EVENT_COLOR }}>
                把消息粘到这里
              </span>
              <button
                onClick={() => {
                  setManual(false)
                  setManualText('')
                }}
                aria-label="关闭"
                className="ml-auto w-6 h-6 rounded-full grid place-items-center text-ink-mute hover:bg-ink/5"
              >
                <X size={13} />
              </button>
            </div>
            <div className="px-4 pb-1">
              <textarea
                autoFocus
                rows={3}
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                onPaste={(e) => {
                  const t = e.clipboardData?.getData('text/plain') ?? ''
                  if (!t.trim()) return
                  e.preventDefault()
                  setManualText(t)
                  if (!tryParse(t)) onToast('没识别出「日期 + 时间」,把时间补上再试', 'info')
                }}
                placeholder="例:周三下午3点开党会,在教三302"
                className="w-full rounded-xl border-2 border-ink/10 p-2.5 text-[13px] text-ink bg-white outline-none focus:border-tangerine-400"
              />
              <p className="text-[11px] text-ink-mute mt-1.5">
                浏览器不允许网页直接读剪贴板,但<b>在这里按 Ctrl+V(手机长按粘贴)</b> 一定可以。
              </p>
            </div>
            <div className="flex items-center gap-2 px-4 py-3 bg-white/75 border-t-2 border-ink/[0.07]">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setManual(false)
                  setManualText('')
                }}
              >
                取消
              </Button>
              <Button
                size="sm"
                variant="primary"
                className="ml-auto"
                onClick={() => {
                  if (!tryParse(manualText)) onToast('没识别出「日期 + 时间」,补上时间再试', 'info')
                }}
              >
                <Check size={13} /> 识别
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ============ 识别结果卡片 ============ */}
      {hit && meta && (
        <div className="fixed z-[90] bottom-24 left-3 right-3 lg:left-auto lg:right-6 lg:w-[356px] lg:bottom-[76px]">
          <div
            className="rounded-[26px] bg-[#fffdf5] shadow-sticker-lg overflow-hidden"
            style={{ border: `2px dashed ${EVENT_COLOR}` }}
          >
            <div
              className="px-4 pt-3.5 pb-3"
              style={{
                backgroundImage: `repeating-linear-gradient(45deg, ${EVENT_COLOR}1a 0 2px, transparent 2px 11px)`,
              }}
            >
              <div className="flex items-center gap-2">
                <Zap size={13} style={{ color: EVENT_COLOR }} className="shrink-0" />
                <span className="text-[12.5px] font-bold" style={{ color: EVENT_COLOR }}>
                  识别到一条行程
                </span>
                <button
                  onClick={() => setHit(null)}
                  aria-label="关闭"
                  className="ml-auto w-6 h-6 rounded-full grid place-items-center text-ink-mute hover:bg-ink/5 transition-colors"
                >
                  <X size={13} />
                </button>
              </div>

              <div className="mt-2 text-[16px] font-bold text-ink truncate">{hit.parsed.title}</div>
              <div className="text-[12.5px] text-ink-soft font-bold mt-0.5">
                {fmtWhen(hit.parsed.date, hit.parsed.weekly)} · {hit.parsed.start}–{hit.parsed.end}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-ink-mute mt-1">
                <span>
                  {meta.icon} {meta.label}
                </span>
                {hit.parsed.location && <span>地点:{hit.parsed.location}</span>}
              </div>
              {hit.parsed.detail && (
                <div className="text-[11.5px] text-ink-mute mt-1 line-clamp-2">备注:{hit.parsed.detail}</div>
              )}
              {hit.parsed.notes.map((n, i) => (
                <div key={i} className="text-[11px] text-ink-mute mt-0.5">
                  · {n}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 px-4 py-3 bg-white/75 border-t-2 border-ink/[0.07]">
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <PencilLine size={13} /> 改一下
              </Button>
              <Button
                size="sm"
                variant="primary"
                className="ml-auto"
                onClick={() => add(hit.parsed)}
              >
                <Check size={13} /> 加到课表
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 「改一下」→ 打开完整的行程表单,内容已经填好 */}
      {editing && draft && (
        <EventDialog
          open
          event={draft}
          settings={settings}
          onClose={() => {
            setEditing(false)
            setHit(null)
          }}
          onSave={async (data) => {
            await upsertEvent(data)
            setEditing(false)
            setHit(null)
            onToast(`「${data.title}」已加入课表,并同步到备忘`, 'success')
          }}
          onDelete={async () => {
            setEditing(false)
            setHit(null)
          }}
        />
      )}
    </>
  )
}
