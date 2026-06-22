import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json'

// Capacitor(네이티브 앱)는 루트(/)에서 에셋을 서빙하므로 base를 '/'로 둬야 한다.
// GitHub Pages는 '/studymeter/' 하위 경로에서 서빙한다.
const base = process.env.BUILD_TARGET === 'capacitor' ? '/' : '/studymeter/'

// https://vite.dev/config/
export default defineConfig({
  base,
  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/firebase')) return 'vendor-firebase'
          if (id.includes('node_modules/framer-motion')) return 'vendor-framer'
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-') || id.includes('node_modules/victory-')) return 'vendor-charts'
          if (id.includes('node_modules/react-markdown') || id.includes('node_modules/remark') || id.includes('node_modules/unified') || id.includes('node_modules/hast') || id.includes('node_modules/mdast') || id.includes('node_modules/micromark')) return 'vendor-markdown'
          if (id.includes('node_modules/dexie')) return 'vendor-dexie'
          if (id.includes('node_modules/@iconify')) return 'vendor-iconify'
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/react-router')) return 'vendor-react'
        }
      }
    }
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true,
        type: 'module'
      },
      includeAssets: ['logo_chart.svg', 'logo.svg', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        id: base,
        name: 'StudyMeter',
        short_name: 'StudyMeter',
        description: '몰입형 공부 타이머 & 학습 분석 앱',
        theme_color: '#6366f1',
        background_color: '#f0f4f8',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // <== 365 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
})
