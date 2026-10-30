// Synthetic blank-frame inference only: no camera, account server or real landmarks.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer as netServer } from 'node:net'
import { createServer } from 'vite'
import { launchChrome } from '../../tools/browser/chrome.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const artifacts = fileURLToPath(new URL('../../.cache/cpu-worker-smoke/', import.meta.url))
await mkdir(artifacts, { recursive: true })
const profile = await mkdtemp(artifacts + '/profile-')
const portServer = netServer()
await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve))
const port = portServer.address().port
await new Promise(resolve => portServer.close(resolve))
const server = await createServer({ root, server: { port: 0, strictPort: false }, plugins: [{ name: 'synthetic-cpu-page', configureServer(server) { server.middlewares.use('/__cpu-smoke', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Synthetic CPU test</title>') }) } }] })
await server.listen()
let browser
try {
  browser = await launchChrome({ executable: process.env.POSEGOOD_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', port, profile, artifactFolder: artifacts })
  const { cdp } = browser
  await cdp.call('Page.navigate', { url: server.resolvedUrls.local[0] + '__cpu-smoke' })
  const result = await cdp.evaluate(`(async () => {
    const { createCpuWorker } = await import('/src/features/camera/cpuWorker.ts');
    const detector = await createCpuWorker({ baseOptions: { modelAssetPath: location.origin + '/mediapipe/pose_landmarker_lite.task', delegate: 'CPU' }, runningMode: 'VIDEO', numPoses: 1 });
    try {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      canvas.getContext('2d').fillRect(0, 0, 640, 480);
      let ticks = 0; const timer = setInterval(() => ticks++, 5); const start = performance.now();
      try { const pose = await detector.detectForVideo(canvas, 1); return { ticks, ms: performance.now() - start, poses: pose.landmarks.length }; }
      finally { clearInterval(timer); }
    } finally { detector.close(); }
  })()`)
  assert.equal(result.poses, 0)
  assert.ok(result.ticks > 0, 'main-thread events must run during worker inference')
  const info = 'INFO: Created TensorFlow Lite XNNPACK delegate for CPU.'
  assert.ok(browser.errors.filter(message => message === info).length <= 1)
  assert.deepEqual(browser.errors.filter(message => message !== info), [])
  console.log('PASS: CPU worker blank-frame inference, responsive UI timer, no unexpected errors', result)
} finally { await browser?.stop(); await server.close() }
