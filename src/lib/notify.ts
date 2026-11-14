/**
 * 本地通知 + OCR + PDF 文本提取
 */

/* ---------------- 本地通知 ---------------- */

export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported'

export function notificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function currentPermission(): NotifyPermission {
  if (!notificationSupported()) return 'unsupported'
  return Notification.permission as NotifyPermission
}

export async function requestNotificationPermission(): Promise<NotifyPermission> {
  if (!notificationSupported()) return 'unsupported'
  try {
    const result = await Notification.requestPermission()
    return result as NotifyPermission
  } catch {
    return 'denied'
  }
}

export async function showNotification(
  title: string,
  body: string,
  options: { tag?: string; requireInteraction?: boolean; data?: unknown } = {},
): Promise<boolean> {
  if (currentPermission() !== 'granted') return false
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) {
      await reg.showNotification(title, {
        body,
        tag: options.tag,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        requireInteraction: options.requireInteraction ?? false,
        data: options.data,
        actions: [{ action: 'open', title: '查看' }],
      } as NotificationOptions)
      return true
    }
    new Notification(title, {
      body,
      tag: options.tag,
      icon: '/icons/icon-192.png',
    })
    return true
  } catch (err) {
    console.warn('[notify] 发送失败', err)
    return false
  }
}

/* ---------------- OCR ---------------- */

let workerPromise: Promise<any> | null = null
let workerLang = ''

/**
 * OCR 资源全部走应用自己的域名。
 *
 * tesseract.js 默认从 cdn.jsdelivr.net 拉 worker / wasm 核心,
 * 从 tessdata.projectnaptha.com 拉语言包 —— 这两个源国内都不稳,
 * 表现为「点了拍照识别,一直转圈」。
 *
 * 现在这些文件都打包进应用了(见 scripts/copy-ocr-assets.mjs):
 *   /tesseract/worker.min.js
 *   /tesseract/tesseract-core-simd-lstm.wasm.js
 *   /tesseract/{chi_sim,eng}.traineddata.gz
 *
 * 注意:worker 内部是拿不到 document.baseURI 的,
 * 所以路径必须在主线程算成绝对地址再传进去。
 */
function ocrAssetUrl(relative: string): string {
  try {
    return new URL(relative, document.baseURI).href
  } catch {
    return relative
  }
}

const OCR_DIR = ocrAssetUrl('./tesseract/')

/** 浏览器支不支持 WebAssembly SIMD(不支持的话换用非 SIMD 的核心) */
function hasWasmSimd(): boolean {
  try {
    return WebAssembly.validate(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253,
        15, 253, 98, 11,
      ]),
    )
  } catch {
    return false
  }
}

async function getWorker(lang: string, onProgress?: (p: number, status: string) => void) {
  if (workerPromise && workerLang === lang) return workerPromise
  if (workerPromise) {
    const old = await workerPromise.catch(() => null)
    if (old?.terminate) await old.terminate().catch(() => {})
  }
  workerLang = lang
  workerPromise = (async () => {
    const { createWorker } = await import('tesseract.js')
    return createWorker(lang, 1, {
      workerPath: `${OCR_DIR}worker.min.js`,
      corePath: hasWasmSimd()
        ? `${OCR_DIR}tesseract-core-simd-lstm.wasm.js`
        : `${OCR_DIR}tesseract-core-lstm.wasm.js`,
      langPath: OCR_DIR,
      logger: (m: any) => {
        if (onProgress && typeof m?.progress === 'number') onProgress(m.progress, m.status ?? '')
      },
    })
  })()
  return workerPromise
}

/**
 * 图片 OCR。语言包和 wasm 核心都随应用打包,首次使用不用下载任何东西,离线也能识别。
 */
export async function recognizeImage(
  image: File | Blob,
  lang = 'chi_sim+eng',
  onProgress?: (p: number, status: string) => void,
): Promise<string> {
  const worker = await getWorker(lang, onProgress)
  const { data } = await worker.recognize(image)
  return (data?.text ?? '').trim()
}

export async function terminateOcr() {
  if (!workerPromise) return
  try {
    const w = await workerPromise
    await w?.terminate?.()
  } catch {
    /* ignore */
  }
  workerPromise = null
  workerLang = ''
}

/* ---------------- PDF ---------------- */

/**
 * PDF 相关实现搬到了 ./pdfTable.ts(那边有完整的还原逻辑和单测)。
 * 这里转出去,保持原有 import 路径不变。
 */
export {
  extractPdf,
  extractPdfText,
  rowsFromPdfItems,
  textLinesFromPdfItems,
  looksLikeWeekdayLabel,
  looksLikePeriodLabel,
  looksLikeTimeLabel,
  PDF_WORKER_URL,
} from './pdfTable.ts'
