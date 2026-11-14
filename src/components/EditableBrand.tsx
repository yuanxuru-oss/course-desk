import { useEffect, useRef, useState } from 'react'
import { Upload, X } from 'lucide-react'
import { blobUrl, deleteBlob, saveBlob } from '../db'
import { useApp } from '../store'

/**
 * 侧栏页头的头像 + 名称,双击就能改。
 *
 * 头像:双击选图片(存进 IndexedDB,跟其它数据一样只在本机)
 * 名称:双击就地编辑,回车保存、Esc 取消
 *
 * 交互上刻意做得很轻:平时跟普通文字没区别,
 * 只有双击时才亮出「可编辑」的提示,避免把数据密集区弄得花哨。
 */

/** 头像(双击换图) */
export function EditableAvatar({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const settings = useApp((s) => s.settings)
  const saveSettings = useApp((s) => s.saveSettings)
  const toast = useApp((s) => s.toast)

  const [avatarUrl, setAvatarUrl] = useState<string | undefined>()
  const [open, setOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const name = settings.appName || '课程桌'

  useEffect(() => {
    let alive = true
    if (!settings.avatarId) {
      setAvatarUrl(undefined)
      return
    }
    blobUrl(settings.avatarId).then((u) => {
      if (alive) setAvatarUrl(u)
    })
    return () => {
      alive = false
    }
  }, [settings.avatarId])

  const pickAvatar = async (file: File) => {
    try {
      const shrunk = await shrinkAvatar(file)
      const id = await saveBlob(shrunk)
      const old = settings.avatarId
      if (old) await deleteBlob(old).catch(() => {})
      await saveSettings({ avatarId: id })
      toast('头像换好啦', 'success')
    } catch (err: any) {
      toast(`换头像失败:${err?.message ?? err}`, 'error')
    }
  }

  const clearAvatar = async () => {
    const old = settings.avatarId
    if (old) await deleteBlob(old).catch(() => {})
    await saveSettings({ avatarId: '' })
    setOpen(false)
  }

  const box = size === 'sm' ? 'w-8 h-8 rounded-xl text-[13px]' : 'w-9 h-9 rounded-2xl text-[16px]'

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onDoubleClick={() => setOpen((v) => !v)}
        title="双击换头像"
        className={`${box} bg-tangerine-500 grid place-items-center font-extrabold text-white shadow-sticker-sm overflow-hidden`}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="头像" className="w-full h-full object-cover" />
        ) : (
          name.slice(0, 1) || '课'
        )}
      </button>
      {size === 'md' && <StarDot />}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-11 left-0 z-50 w-44 rounded-xl bg-white border border-ink/10 shadow-sticker p-2 space-y-1">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12.5px] text-ink-soft hover:bg-butter-50"
            >
              <Upload size={13} /> 选一张图片
            </button>
            {settings.avatarId && (
              <button
                type="button"
                onClick={clearAvatar}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12.5px] text-ink-soft hover:bg-butter-50"
              >
                <X size={13} /> 恢复默认
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                setOpen(false)
                if (f) pickAvatar(f)
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}

/** 可双击改名的文字 */
export function EditableName({
  className = '',
  inputClassName = '',
}: {
  className?: string
  inputClassName?: string
}) {
  const settings = useApp((s) => s.settings)
  const saveSettings = useApp((s) => s.saveSettings)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const name = settings.appName || '课程桌'

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = () => {
    const v = draft.trim()
    setEditing(false)
    if (!v || v === name) return
    saveSettings({ appName: v })
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
        className={`bg-white/75 border border-tangerine-400 rounded-lg px-1.5 outline-none focus:border-tangerine-600 ${inputClassName}`}
        style={{ width: `${Math.max(2, draft.length + 1)}em` }}
      />
    )
  }

  return (
    <div
      onDoubleClick={() => {
        setDraft(name)
        setEditing(true)
      }}
      title="双击改名"
      className={`cursor-text rounded px-0.5 -mx-0.5 hover:bg-white/45 ${className}`}
    >
      {name}
    </div>
  )
}

/** 侧栏页头:头像 + 名称 + 教学周 */
export function EditableBrand() {
  const settings = useApp((s) => s.settings)
  const week = useWeek()
  return (
    <div className="flex items-start gap-2 mb-6">
      <EditableAvatar />
      <div className="min-w-0">
        <EditableName
          className="font-extrabold text-ink text-[17px] leading-tight tracking-tight"
          inputClassName="font-extrabold text-ink text-[17px] leading-tight tracking-tight"
        />
        <div className="text-[11px] text-ink-soft font-medium truncate">第 {week} 教学周</div>
        <div className="text-[10.5px] text-ink-mute font-medium truncate">
          {settings.schoolName || <SemesterRange />}
        </div>
      </div>
    </div>
  )
}

/** 头像右上角的小星星(和原来一致) */
function StarDot() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      className="absolute -top-1.5 -right-1.5"
      style={{ animation: 'twinkle 2.4s ease-in-out infinite' }}
      aria-hidden
    >
      <path
        d="M12 2.5l2.6 6.1 6.6.6-5 4.4 1.5 6.4L12 16.6 6.3 20l1.5-6.4-5-4.4 6.6-.6z"
        fill="#F4CE4E"
        stroke="#241F1A"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/* 下面两个从 store 里取,避免组件直接依赖别的字段 */
function useWeek() {
  const s = useApp((x) => x.settings)
  return weekOf(s.semesterStart, s.weekCount)
}
function SemesterRange() {
  const s = useApp((x) => x.settings)
  return <>{semesterRangeText(s)}</>
}

function weekOf(start: string, weekCount: number): number {
  const d = new Date(start + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return 1
  const now = new Date()
  const day = (now.getDay() + 6) % 7
  const monday = new Date(now)
  monday.setDate(now.getDate() - day)
  const diff = Math.round((monday.getTime() - d.getTime()) / 604800000)
  const w = diff + 1
  if (w < 1) return 1
  return Math.min(w, weekCount)
}

function semesterRangeText(s: { semesterStart: string; weekCount: number }): string {
  const start = new Date(s.semesterStart + 'T00:00:00')
  if (Number.isNaN(start.getTime())) return ''
  const end = new Date(start)
  end.setDate(start.getDate() + (s.weekCount - 1) * 7)
  const p = (n: number) => String(n).padStart(2, '0')
  const f = (d: Date) => `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`
  return `${f(start)} ~ ${f(end)}`
}

/** 把头像缩到 256×256 见方,省空间 */
async function shrinkAvatar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const size = Math.min(256, Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  const ox = (bitmap.width - size) / 2
  const oy = (bitmap.height - size) / 2
  ctx.drawImage(bitmap, ox, oy, size, size, 0, 0, size, size)
  bitmap.close?.()
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/png', 0.9))
}
