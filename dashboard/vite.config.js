import { defineConfig, createLogger, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const logger = createLogger()
const originalError = logger.error.bind(logger)
logger.error = (msg, opts) => {
  if (typeof msg === 'string' && msg.includes('proxy') && msg.includes('socket error')) return
  originalError(msg, opts)
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const dispatchApiKey = env.DISPATCH_API_KEY || ''

  return {
    plugins: [react(), tailwindcss()],
    customLogger: logger,
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3747',
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (dispatchApiKey) proxyReq.setHeader('X-API-Key', dispatchApiKey)
            })
            proxy.on('error', () => {})
          },
        },
        '/ws': {
          target: 'ws://localhost:3747',
          ws: true,
          configure: (proxy) => {
            proxy.on('proxyReqWs', (proxyReq) => {
              if (dispatchApiKey) proxyReq.setHeader('X-API-Key', dispatchApiKey)
            })
            proxy.on('error', () => {})
          },
        },
      },
    },
  }
})
