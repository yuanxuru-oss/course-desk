#!/usr/bin/env node
/**
 * 把 OCR 需要的运行时资源从 node_modules 复制到 public/tesseract/
 *
 * 为什么不用 CDN 默认地址:
 *   tesseract.js 默认从 cdn.jsdelivr.net 拉 worker/core、从 tessdata.projectnaptha.com
 *   拉语言包 —— 国内这两个源都不稳,OCR 会一直卡着。
 *   现在全部走应用自己的域名,离线也能用。
 *
 * 资源清单:
 *   worker.min.js                 124KB  tesseract.js 的 worker
 *   tesseract-core-simd-lstm.wasm.js  3.9MB  wasm 核心(支持 SIMD 的浏览器)
 *   tesseract-core-lstm.wasm.js        3.9MB  兜底(不支持 SIMD 的老浏览器)
 *   chi_sim.traineddata.gz        1.7MB  中文简体(随仓库存放,不走网络)
 *   eng.traineddata.gz            2.0MB  英文
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'public', 'tesseract')
const PUB = path.join(ROOT, 'public')

const FILES = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  // PDF.js 的 worker —— 特意用**不带哈希的固定文件名**。
  // Vite 默认会把它打包成 pdf.worker.min-<hash>.mjs,
  // 一旦换部署包,Service Worker 缓存的旧 index.html 就会指向一个
  // 已经被删掉的旧文件名 → PDF 导入报「Failed to fetch dynamically imported module」。
]

/**
 * PDF.js 的 worker —— 特意用**不带哈希的固定文件名**,放 public/ 根下。
 *
 * Vite 默认会把它打包成 pdf.worker.min-<hash>.mjs,
 * 一旦换部署包,Service Worker 缓存里的旧 index.html 就会指向一个
 * 已经被删掉的旧文件名 → PDF 导入报「Failed to fetch dynamically imported module」。
 * 固定文件名 + 进预缓存,换包后也不会断。
 */
const PDF_WORKER = ['node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'pdf.worker.min.mjs']

fs.mkdirSync(OUT, { recursive: true })

let ok = true
for (const [src, dst] of FILES) {
  const from = path.join(ROOT, src)
  const to = path.join(OUT, dst)
  if (!fs.existsSync(from)) {
    console.error(`  ✗ 缺少依赖文件:${src}(先跑 npm install)`)
    ok = false
    continue
  }
  fs.copyFileSync(from, to)
  const kb = Math.round(fs.statSync(to).size / 1024)
  console.log(`  ✓ ${dst.padEnd(38)} ${kb} KB`)
}

// PDF worker:固定文件名,直接放 public/ 根下
{
  const [src, dst] = PDF_WORKER
  const from = path.join(ROOT, src)
  const to = path.join(PUB, dst)
  if (!fs.existsSync(from)) {
    console.error(`  ✗ 缺少依赖文件:${src}(先跑 npm install)`)
    ok = false
  } else {
    fs.copyFileSync(from, to)
    const kb = Math.round(fs.statSync(to).size / 1024)
    console.log(`  ✓ ${dst.padEnd(38)} ${kb} KB  (固定文件名,放 public/ 根)`)
  }
}

// 语言包随仓库走,不在这里下载
for (const f of ['chi_sim.traineddata.gz', 'eng.traineddata.gz']) {
  const p = path.join(OUT, f)
  if (fs.existsSync(p)) {
    console.log(`  ✓ ${f.padEnd(38)} ${Math.round(fs.statSync(p).size / 1024)} KB`)
  } else {
    console.error(`  ✗ 缺少语言包:${f}`)
    ok = false
  }
}

if (!ok) process.exit(1)
