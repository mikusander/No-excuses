import { existsSync, readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import webpush from 'web-push'

const httpsEnabled = process.env.VITE_DEV_HTTPS === 'true'
const httpsKeyPath = process.env.VITE_DEV_HTTPS_KEY
const httpsCertPath = process.env.VITE_DEV_HTTPS_CERT

const httpsConfig = httpsEnabled && httpsKeyPath && httpsCertPath && existsSync(httpsKeyPath) && existsSync(httpsCertPath)
  ? {
      key: readFileSync(httpsKeyPath),
      cert: readFileSync(httpsCertPath),
    }
  : undefined

function pushDevServerPlugin(): Plugin {
  return {
    name: 'push-dev-server-plugin',
    configureServer(server) {
      const vapidPublicKey =
        process.env.VITE_VAPID_PUBLIC_KEY ||
        'BEWZ76lMUhZyU6voX38JPp08bzti_3y3aOYLs3nHExturpMD1-U0VvvGF2b72MHgw7DyAPf6HRP_jOpfyCHz4zE'
      const vapidPrivateKey =
        process.env.VAPID_PRIVATE_KEY ||
        'XxaWAWT1e4-GcDCdlBJov5xtSTRO3NaNe2bn0tVaeco'

      webpush.setVapidDetails(
        'mailto:support@no-excuses.app',
        vapidPublicKey,
        vapidPrivateKey
      )

      const cancelledTimers = new Set<string>()

      server.middlewares.use(async (req, res, next) => {
        if (req.url === '/api/schedule-push' && req.method === 'POST') {
          let body = ''
          req.on('data', (chunk) => {
            body += chunk
          })
          req.on('end', async () => {
            try {
              const data = JSON.parse(body)
              const { subscription, delaySeconds = 0, title, body: notificationBody, timerId } = data
              if (timerId) cancelledTimers.delete(timerId)

              const waitMs = Math.max(0, Math.round(Number(delaySeconds) * 1000))
              if (waitMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, waitMs))
              }

              if (timerId && cancelledTimers.has(timerId)) {
                cancelledTimers.delete(timerId)
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ cancelled: true }))
                return
              }

              const payload = JSON.stringify({
                title: title || '⏱️ Recupero Terminato!',
                body: notificationBody || 'È ora di iniziare la prossima serie!',
                tag: 'rest-timer',
                url: '/',
              })

              await webpush.sendNotification(subscription, payload)
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ success: true }))
            } catch (err: any) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: err.message }))
            }
          })
          return
        }

        if (req.url === '/api/cancel-push' && req.method === 'POST') {
          let body = ''
          req.on('data', (chunk) => {
            body += chunk
          })
          req.on('end', () => {
            try {
              const data = JSON.parse(body)
              if (data.timerId) cancelledTimers.add(data.timerId)
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ success: true }))
            } catch (err: any) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: err.message }))
            }
          })
          return
        }

        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    pushDevServerPlugin(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: null, // Registrazione manuale in main.tsx
      manifest: {
        name: 'No Excuses Workout',
        short_name: 'No Excuses',
        description: 'Allenamento e tracciamento schede palestra',
        start_url: '/',
        display: 'standalone',
        background_color: '#0a0a0a',
        theme_color: '#ff6b00',
        orientation: 'portrait',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  server: {
    https: httpsConfig,
  },
  preview: {
    https: httpsConfig,
  },
})
