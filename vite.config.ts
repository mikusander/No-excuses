import { existsSync, readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const httpsEnabled = process.env.VITE_DEV_HTTPS === 'true'
const httpsKeyPath = process.env.VITE_DEV_HTTPS_KEY
const httpsCertPath = process.env.VITE_DEV_HTTPS_CERT

const httpsConfig = httpsEnabled && httpsKeyPath && httpsCertPath && existsSync(httpsKeyPath) && existsSync(httpsCertPath)
  ? {
      key: readFileSync(httpsKeyPath),
      cert: readFileSync(httpsCertPath),
    }
  : undefined

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
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
