import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Web 模式开发服务器：/api 与 /ws 代理到 iris-creation-server（127.0.0.1:8765）。
// 构建产物由 iris-creation-server 直接托管（同源，无需代理）。
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 1421,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8765', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:8765', ws: true },
    },
  },
})
