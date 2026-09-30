import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const polling = /^(1|true)$/i.test(process.env.CHOKIDAR_USEPOLLING ?? '')

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true, fs: { allow: ['..'] },
    // Explicitly disable native FSEvents when polling is requested on a restricted Mac host.
    watch: polling ? { usePolling: true, useFsEvents: false, interval: 1000 } : undefined,
  },
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
})
