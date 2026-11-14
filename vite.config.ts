import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // 用相对路径:dist 丢到任何子目录(如 GitHub Pages 的 /coursedesk/)也能跑
  base: './',
  define: {
    // 构建号:每构建一次变一次,设置页里显示,用来分辨版本新旧
    __BUILD_ID__: JSON.stringify(
      (() => {
        const d = new Date()
        const p = (n: number) => String(n).padStart(2, '0')
        return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
      })(),
    ),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // 用 .json 后缀:静态托管/CDN 才认得出这是 JSON(manifest.webmanifest 会被当成二进制流),
      // iOS「添加到主屏幕」对这个更敏感
      manifestFilename: 'manifest.json',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      workbox: {
        // 新 SW 立刻接管,不等旧 SW 退出。
        // 不开这个的话,换部署包后旧 SW 会一直用旧的 index.html,
        // 页面引用的资源文件名已经被新包删掉 → PDF 导入报 404。
        skipWaiting: true,
        clientsClaim: true,
        // 字体(.woff2)要进预缓存 —— 它是首屏就需要的
        // .mjs 也得进:PDF.js 的 worker 虽然用了固定文件名,但旧版本包里的
        // pdf.worker.min-<hash>.mjs 曾经被缓存过,一并留着能避免换包后断裂
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,woff2}'],
        // OCR 的 wasm 核心虽然叫 .wasm.js,会被上面的 *.js 匹配上,
        // 但它有 3.9MB,预缓存会拖慢首次安装 —— 交给下面的运行时缓存按需下载
        globIgnores: ['**/tesseract/**'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // OCR 的 worker / wasm 核心 / 语言包共约 12MB,
            // 放运行时缓存而不是预缓存:首次打开不必等这一堆,
            // 第一次用 OCR 时下载并缓存,之后离线照样能识别。
            urlPattern: ({ url }: { url: URL }) => url.pathname.includes('/tesseract/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ocr-assets',
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // PDF.js 的 worker:固定文件名,离线时也要能拿到
            urlPattern: ({ url }: { url: URL }) => url.pathname.endsWith('.mjs'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'pdf-worker',
              expiration: { maxEntries: 6, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: '课程桌 · CourseDesk',
        short_name: '课程桌',
        description: '大学生电子桌面课程表：课表、作业、备忘录、AI 知识库与智能提醒',
        theme_color: '#0f172a',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: './',
        start_url: './',
        lang: 'zh-CN',
        categories: ['education', 'productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: '今日课程', short_name: '今日', url: './#/today' },
          { name: '待交作业', short_name: '作业', url: './#/homework' },
          { name: '备忘录', short_name: '备忘', url: './#/notes' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  worker: { format: 'es' },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'zustand', 'dexie', 'dexie-react-hooks'],
          markdown: ['react-markdown', 'remark-gfm'],
          ocr: ['tesseract.js'],
          sheet: ['xlsx'],
        },
      },
    },
  },
})
