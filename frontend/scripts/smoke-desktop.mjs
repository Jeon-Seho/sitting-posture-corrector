// 실제 EXE를 숨긴 창·독립 프로필·합성 카메라로 실행한다.
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import assert from 'node:assert/strict'

const server = createServer()
await new Promise(r => server.listen(0, '127.0.0.1', r))
const port = server.address().port
await new Promise(r => server.close(r))
const profile = await mkdtemp(join(tmpdir(), 'posegood-desktop-smoke-'))
const started = Date.now()
const child = spawn(resolve('PoseGood.exe'), [
  '--posegood-smoke-hidden',
  `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1',
  `--user-data-dir=${profile}`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
], { windowsHide: true, stdio: 'ignore' })
let socket
try {
  const deadline = Date.now() + 120000
  let page
  while (Date.now() < deadline) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      page = pages.find(p => p.type === 'page' && p.url.startsWith('app://posegood/'))
      if (page) break
    } catch {}
    await new Promise(r => setTimeout(r, 500))
  }
  assert.ok(page, 'Packaged app did not open')
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, reject) => { socket.onopen = r; socket.onerror = reject })
  let id = 0
  const pending = new Map()
  socket.onclose = () => {
    for (const done of pending.values()) done({ error: new Error('App closed') })
    pending.clear()
  }
  socket.onmessage = event => {
    const value = JSON.parse(event.data)
    if (pending.has(value.id)) {
      pending.get(value.id)(value)
      pending.delete(value.id)
    }
  }
  const call = (method, params = {}) => new Promise((r, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 90000)
    const key = ++id
    pending.set(key, value => { clearTimeout(timer); value.error ? reject(value.error) : r(value.result) })
    socket.send(JSON.stringify({ id: key, method, params }))
  })
  const result = await call('Runtime.evaluate', {
    awaitPromise: true, returnByValue: true,
    expression: `(async () => {
      for (let i = 0; i < 100 && !document.querySelector('#root')?.textContent; i++)
        await new Promise(r => setTimeout(r, 100));
      const info = await window.posegoodDesktop.getLaunchInfo();
      const readyAt = Date.now();
      const files = ['/mediapipe/wasm/vision_wasm_internal.wasm', '/mediapipe/pose_landmarker_lite.task'];
      const assets = await Promise.all(files.map(async path => {
        const r = await fetch(path); return { path, status: r.status, bytes: (await r.arrayBuffer()).byteLength };
      }));
      const media = await navigator.mediaDevices.getUserMedia({ video: true });
      const camera = media.getVideoTracks().length; media.getTracks().forEach(t => t.stop());
      location.hash = 'collection';
      await new Promise(r => setTimeout(r, 500));
      [...document.querySelectorAll('button')].find(b => b.textContent.includes('카메라 켜기'))?.click();
      let modelReady = false;
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 500));
        modelReady = [...document.querySelectorAll('button')].some(b => b.textContent.includes('카메라 끄기'));
        if (modelReady) break;
      }
      const videoWidth = document.querySelector('video')?.videoWidth || 0;
      [...document.querySelectorAll('button')].find(b => b.textContent.includes('카메라 끄기'))?.click();
      return { readyAt, url: location.href, text: document.body.innerText, info, assets, camera, modelReady, videoWidth,
        secure: isSecureContext, locks: !!navigator.locks };
    })()`,
  })
  assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
  const value = result.result.value
  value.startupMs = value.readyAt - started
  delete value.readyAt
  assert.ok(value.text.includes('측정'))
  assert.equal(value.info.packaged, true)
  assert.equal(value.info.launchAtLoginSupported, true)
  assert.equal(value.secure, true)
  assert.equal(value.locks, true)
  assert.equal(value.camera, 1)
  assert.equal(value.modelReady, true, value.text)
  assert.ok(value.videoWidth > 0)
  for (const asset of value.assets) { assert.equal(asset.status, 200); assert.ok(asset.bytes > 1000) }
  console.log(JSON.stringify({ ...value, text: value.text.slice(0, 250) }, null, 2))
  await call('Runtime.evaluate', { expression: 'window.close()' }).catch(() => {})
} finally {
  socket?.close()
  if (child.exitCode === null) await new Promise(r => { child.once('exit', r); setTimeout(r, 5000) })
  if (child.exitCode === null) child.kill()
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
}
