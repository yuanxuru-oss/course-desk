import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '../lib/utils'
import { blobUrl } from '../db'

/* ---------------- 星星装饰(品牌元素) ---------------- */
export function Star({
  size = 18,
  color = '#F8DF7C',
  className,
  spin,
}: {
  size?: number
  color?: string
  className?: string
  spin?: boolean
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cn(spin && 'animate-wiggle', className)}
      style={{ color }}
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M12 1.6l2.9 6.2 6.8.9-5 4.7 1.3 6.7L12 16.8 6 20.1l1.3-6.7-5-4.7 6.8-.9L12 1.6z"
      />
    </svg>
  )
}

/* ---------------- 层级眉标 ---------------- */
export function Eyebrow({
  children,
  tone = 'butter',
}: {
  children: ReactNode
  tone?: 'butter' | 'periwi' | 'grass' | 'ink'
}) {
  const tones = {
    butter: 'bg-butter-200 text-ink-soft border-ink/10',
    periwi: 'bg-periwi-100 text-periwi-700 border-periwi-200',
    grass: 'bg-grass-100 text-grass-700 border-grass-200',
    ink: 'bg-ink text-white border-ink',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[10.5px] font-bold tracking-[0.12em] uppercase px-2.5 py-1 rounded-full border-2',
        tones[tone],
      )}
    >
      {children}
    </span>
  )
}

/* ---------------- 按钮 ---------------- */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'butter' | 'periwi'
type ButtonSize = 'sm' | 'md' | 'lg'

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-tangerine-500 text-white shadow-sticker-sm hover:bg-tangerine-600 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none',
    secondary: 'bg-white text-ink border-2 border-[#241f1a]/[0.12] shadow-sticker-sm hover:bg-butter-50 hover:border-tangerine-300 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none',
    ghost: 'text-ink-soft hover:bg-butter-100 hover:text-ink',
    danger: 'bg-cherry-500 text-white shadow-sticker-sm hover:bg-cherry-600 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none',
    butter: 'bg-butter-200 text-ink shadow-sticker-sm hover:bg-butter-300 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none',
    periwi: 'bg-periwi-100 text-periwi-700 shadow-sticker-sm hover:bg-periwi-200 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none',
  }
  const sizes: Record<ButtonSize, string> = {
    sm: 'h-8 px-3.5 text-[13px] rounded-full gap-1.5 font-semibold',
    md: 'h-10 px-5 text-sm rounded-full gap-2 font-semibold',
    lg: 'h-12 px-6 text-[15px] rounded-full gap-2 font-bold',
  }
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center transition-all select-none whitespace-nowrap',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tangerine-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fdf6e4]',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

/* ---------------- Card ---------------- */
export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('card', className)} {...rest}>
      {children}
    </div>
  )
}

/** 次级卡片:用于配角区域,视觉上安静一档 */
export function SoftCard({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('card-soft bg-white/70', className)} {...rest}>
      {children}
    </div>
  )
}

/* ---------------- Modal ---------------- */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-ink/[0.35] backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div
        className={cn(
          'relative bg-white w-full flex flex-col max-h-[92vh] sm:max-h-[86vh] overflow-hidden',
          'rounded-t-[28px] sm:rounded-[28px] border-2 border-[#241f1a]/[0.12] shadow-pop animate-slide-up',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b-2 border-[#241f1a]/[0.08] bg-butter-50 shrink-0">
          <h3 className="font-bold text-ink text-[15px]">{title}</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-ink-mute hover:bg-butter-200 hover:text-ink transition-colors"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto grow">{children}</div>
        {footer && (
          <div className="px-5 py-3 border-t-2 border-[#241f1a]/[0.08] flex justify-end gap-2 shrink-0 bg-butter-50">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/* ---------------- Form fields ---------------- */
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label?: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('block', className)}>
      {label && <span className="block text-[13px] font-semibold text-ink mb-1.5">{label}</span>}
      {children}
      {hint && <span className="block text-xs text-ink-mute mt-1 leading-relaxed">{hint}</span>}
    </label>
  )
}

const inputBase =
  'w-full h-11 px-3.5 rounded-2xl border-2 border-[#241f1a]/[0.12] bg-white text-sm text-ink placeholder:text-ink-mute/70 ' +
  'transition-colors focus:border-tangerine-400 focus:ring-4 focus:ring-tangerine-100 focus:outline-none'

export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputBase, className)} {...rest} />
}

export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputBase, 'h-auto py-2.5 leading-relaxed resize-y', className)} {...rest} />
}

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(inputBase, 'pr-9 cursor-pointer', className)} {...rest}>
      {children}
    </select>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: ReactNode
  hint?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        {label && <div className="text-sm font-semibold text-ink">{label}</div>}
        {hint && <div className="text-xs text-ink-mute mt-0.5 leading-relaxed">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative shrink-0 w-12 h-7 rounded-full transition-colors mt-0.5 border-2',
          checked
            ? 'bg-tangerine-500 border-tangerine-600/30'
            : 'bg-ink/[0.14] border-ink/[0.06]',
        )}
      >
        {/* 必须显式给 left:绝对定位元素不写 left 时会落在静态位置,圆钮会跑到右边 */}
        <span
          className={cn(
            'absolute left-[2px] top-[2px] w-[22px] h-[22px] bg-white rounded-full shadow-sm transition-transform',
            checked ? 'translate-x-[22px]' : 'translate-x-0',
          )}
        />
      </button>
    </div>
  )
}

/* ---------------- Badge ---------------- */
export function Badge({
  children,
  color,
  className,
}: {
  children: ReactNode
  color?: string
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold leading-5 whitespace-nowrap',
        className,
      )}
      style={
        color
          ? { background: `${color}1f`, color, border: `1.5px solid ${color}45` }
          : { background: '#fbeaa4', color: '#5B5249', border: '1.5px solid rgba(36,31,26,.10)' }
      }
    >
      {children}
    </span>
  )
}

/* ---------------- Empty ---------------- */
export function Empty({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="text-center py-12 px-6">
      {icon && <div className="mb-3 flex justify-center">{icon}</div>}
      <p className="text-ink font-bold">{title}</p>
      {description && (
        <p className="text-[13px] text-ink-mute mt-1.5 max-w-sm mx-auto leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/* ---------------- Segmented ---------------- */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode }[]
  className?: string
}) {
  return (
    <div className={cn('inline-flex bg-butter-100 rounded-full p-1 gap-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'px-3.5 h-8 rounded-full text-[13px] font-semibold transition-all whitespace-nowrap',
            value === o.value
              ? 'bg-white text-ink shadow-sticker-sm'
              : 'text-ink-soft hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ---------------- Toast ---------------- */
export interface ToastItem {
  id: string
  text: string
  type: 'info' | 'success' | 'error'
}

export function ToastHost({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: string) => void }) {
  return createPortal(
    <div className="fixed z-[100] bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 flex flex-col gap-2 items-center pointer-events-none px-4">
      {items.map((t) => (
        <button
          key={t.id}
          onClick={() => onDismiss(t.id)}
          className={cn(
            'pointer-events-auto max-w-md px-4 py-2.5 rounded-full text-sm font-semibold shadow-pop animate-slide-up text-left border-2',
            t.type === 'success' && 'bg-grass-500 text-white border-grass-600',
            t.type === 'error' && 'bg-cherry-500 text-white border-cherry-600',
            t.type === 'info' && 'bg-ink text-white border-ink',
          )}
        >
          {t.text}
        </button>
      ))}
    </div>,
    document.body,
  )
}

/* ---------------- Tabs ---------------- */
export function Tabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; count?: number }[]
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'px-4 py-2 text-[13.5px] font-bold transition-all whitespace-nowrap flex items-center gap-1.5 rounded-full border-2',
            value === o.value
              ? 'bg-ink text-white border-ink shadow-sticker-sm'
              : 'bg-white text-ink-soft border-[#241f1a]/10 hover:border-tangerine-300',
          )}
        >
          {o.label}
          {o.count !== undefined && (
            <span
              className={cn(
                'text-[11px] px-1.5 rounded-full',
                value === o.value ? 'bg-white/20 text-white' : 'bg-butter-100 text-ink-soft',
              )}
            >
              {o.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/* ---------------- 图片上传按钮 ---------------- */
export function ImagePicker({
  onFiles,
  multiple = true,
  accept = 'image/*',
  className,
  label = '添加图片',
}: {
  onFiles: (files: File[]) => void
  multiple?: boolean
  accept?: string
  className?: string
  label?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length) onFiles(files)
          e.target.value = ''
        }}
      />
      <Button variant="secondary" size="sm" className={className} onClick={() => ref.current?.click()}>
        {label}
      </Button>
    </>
  )
}

/* ---------------- 图片缩略图(按 id 渲染,可删除) ---------------- */

/**
 * 按 blob id 渲染缩略图。
 *
 * 为什么不用「数组下标」:解析失败/缺失的图片会被过滤掉,
 * 一旦下标和 id 错位,点第 2 张的 × 实际删掉的是第 3 张。
 * 这里始终以 id 为准,并在卸载时 revoke objectURL(原来从不回收)。
 */
export function AttachmentThumbs({
  ids,
  onRemove,
  size = 80,
}: {
  ids: string[]
  onRemove?: (id: string) => void
  size?: number
}) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    let alive = true
    const created: string[] = []
    Promise.all(
      ids.map(async (id) => {
        const u = await blobUrl(id)
        if (u) created.push(u)
        return [id, u ?? ''] as const
      }),
    ).then((pairs) => {
      if (!alive) return
      const next: Record<string, string> = {}
      for (const [id, u] of pairs) if (u) next[id] = u
      setUrls(next)
    })
    return () => {
      alive = false
      for (const u of created) URL.revokeObjectURL(u)
    }
  }, [ids])

  if (!ids.length) return null
  return (
    <div className="flex flex-wrap gap-2">
      {ids.map((id) => (
        <div key={id} className="relative">
          {urls[id] ? (
            <img
              src={urls[id]}
              alt=""
              style={{ width: size, height: size }}
              className="object-cover rounded-lg border border-ink/10"
            />
          ) : (
            <div
              style={{ width: size, height: size }}
              className="rounded-lg border border-ink/10 bg-butter-100 grid place-items-center text-[11px] text-ink-mute"
            >
              图片缺失
            </div>
          )}
          {onRemove && (
            <button
              type="button"
              aria-label="移除图片"
              onClick={() => onRemove(id)}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-ink text-white text-[11px] grid place-items-center"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

/* ---------------- 折叠面板 ---------------- */
export function Collapse({
  title,
  children,
  defaultOpen = false,
  right,
}: {
  title: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  right?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-2 border-[#241f1a]/10 rounded-2xl overflow-hidden bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-butter-50 transition-colors"
      >
        <span className="text-sm font-bold text-ink">{title}</span>
        <span className="flex items-center gap-2">
          {right}
          <span className={cn('text-ink-mute transition-transform text-xs', open && 'rotate-180')}>▼</span>
        </span>
      </button>
      {open && <div className="px-4 pb-4 pt-1 border-t-2 border-[#241f1a]/[0.08]">{children}</div>}
    </div>
  )
}
