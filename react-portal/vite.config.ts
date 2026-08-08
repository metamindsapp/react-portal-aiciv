/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const testSetupFile = fileURLToPath(new URL('./src/test/setup.ts', import.meta.url))

export default defineConfig({
  plugins: [react()],
  base: '/react/',
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8097',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8097',
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // Vitest 4 may resolve relative setup paths against the workspace/repo root
    // rather than this nested frontend package. Anchor it to this config file so
    // `npm test` behaves identically locally and in GitHub Actions.
    setupFiles: [testSetupFile],
  },
})
