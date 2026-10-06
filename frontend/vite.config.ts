import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const polling = /^(1|true)$/i.test(process.env.CHOKIDAR_USEPOLLING ?? '')
const apiTarget = process.env.POSEGOOD_API_URL ?? 'http://127.0.0.1:8090'
const apiPrefix = process.env.POSEGOOD_API_PREFIX ?? ''
if (!['', '/api'].includes(apiPrefix)) {
  throw new Error('개발 API 경로 접두사는 비어 있거나 /api여야 합니다.')
}
const apiUrl = new URL(apiTarget)
if (
  apiUrl.protocol !== 'http:' ||
  apiUrl.hostname !== '127.0.0.1' ||
  apiUrl.username ||
  apiUrl.password ||
  apiUrl.pathname !== '/' ||
  apiUrl.search ||
  apiUrl.hash
) {
  throw new Error('개발 API 주소는 127.0.0.1 HTTP 서버여야 합니다.')
}
const proxy = {
  '/api': {
    target: apiTarget,
    rewrite: (path: string) => apiPrefix + path.replace(/^\/api(?=\/)/, ''),
  },
}

export default defineConfig(({ command, mode, isPreview }) => ({
  plugins: [
    // This explicit serve mode replaces only ServiceApp's camera implementation.
    // Builds and ordinary development never receive the synthetic input adapter.
    ...(command === 'serve' && !isPreview && mode === 'browser-smoke'
      ? [{
          name: 'explicit-synthetic-browser-camera',
          enforce: 'pre' as const,
          resolveId(source: string, importer?: string) {
            if (source === '../hooks/useCamera' && importer?.replaceAll('\\', '/').endsWith('/src/app/ServiceApp.tsx')) {
              return fileURLToPath(new URL('./src/features/testing/useSyntheticCamera.ts', import.meta.url))
            }
          },
        }]
      : []),
    react(),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: { allow: ['..'] },
    // Explicitly disable native FSEvents when polling is requested on a restricted Mac host.
    watch: {
      ignored: ['**/release/**', '**/release-face/**', '**/release-lab/**', '**/dist-face/**', '**/dist-lab/**'],
      ...(polling ? { usePolling: true, useFsEvents: false, interval: 1000 } : {}),
    },
    proxy,
  },
  preview: { host: '127.0.0.1', proxy },
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
}))
