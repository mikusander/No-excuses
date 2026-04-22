import { existsSync, readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
  ],
  server: {
    https: httpsConfig,
  },
  preview: {
    https: httpsConfig,
  },
})
