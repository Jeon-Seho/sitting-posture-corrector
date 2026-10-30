// 실제 EXE를 숨긴 창·독립 프로필·합성 카메라로 실행한다.
import { spawn } from 'node:child_process'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import assert from 'node:assert/strict'
import { Cdp } from '../../tools/browser/cdp.mjs'

const modelFile = JSON.parse(await readFile(new URL('../model-asset.json', import.meta.url), 'utf8')).filename
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
      const setInput = (name, value) => {
        const input = document.querySelector('input[name="'+name+'"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setInput('email','admin'); setInput('password','1234');
      await new Promise(r=>setTimeout(r,100));
      [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='로그인').click();
      await new Promise(r=>setTimeout(r,200));
      [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='설정').click();
      await new Promise(r=>setTimeout(r,200));
      document.querySelector('.theme-preset-discord').click();
      await new Promise(r=>setTimeout(r,600));
      const invalidIcon = await window.posegoodDesktop.setThemeIcon({accent:'../bad',png:'not-png'});
      const alertDelivery = await window.posegoodDesktop.showAlert({title:'합성 테마 검증',body:'시험 알림',preview:true});
      const files = ['/mediapipe/wasm/vision_wasm_internal.wasm', ${JSON.stringify('/mediapipe/' + modelFile)}];
      const assets = await Promise.all(files.map(async path => {
        const r = await fetch(path); return { path, status: r.status, bytes: (await r.arrayBuffer()).byteLength };
      }));
      const media = await navigator.mediaDevices.getUserMedia({ video: true });
      const camera = media.getVideoTracks().length; media.getTracks().forEach(t => t.stop());
      [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='로그아웃').click();
      await new Promise(r=>setTimeout(r,200));
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
      return { readyAt, url: location.href, text: document.body.innerText, info, assets, camera, modelReady, videoWidth, invalidIcon, alertDelivery,
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
  assert.equal(value.invalidIcon, false)
  assert.equal(value.alertDelivery, 'popup')
  const savedIcon = JSON.parse(await readFile(join(profile, 'theme-icons', 'current.json'), 'utf8'))
  assert.equal(savedIcon.accent, '#5865f2')
  const ico = await readFile(join(profile, 'theme-icons', '5865f2.ico'))
  assert.equal(ico.readUInt16LE(2), 1)
  assert.equal(ico.readUInt32LE(18), 22)
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const popupPage = pages.find(p => p.url.includes('alert-popup.html'))
  assert.ok(popupPage, 'native popup target')
  const popupCdp = await Cdp.connect(popupPage.webSocketDebuggerUrl)
  try {
    const popupColors = await popupCdp.evaluate(`({background:getComputedStyle(document.documentElement).getPropertyValue('--snack').trim(),dark:document.documentElement.dataset.dark})`)
    assert.equal(popupColors.dark, 'true')
    assert.notEqual(popupColors.background, '#21332c', 'popup must follow selected theme, not fixed forest')
  } finally { popupCdp.close() }
  console.log('PASS packaged theme icon cache, invalid payload rejection, and native popup theme')
  console.log(JSON.stringify({ ...value, text: value.text.slice(0, 250) }, null, 2))
  await call('Runtime.evaluate', { expression: 'window.close()' }).catch(() => {})
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ id: 999999, method: 'Browser.close' }))
    await Promise.race([new Promise(resolve => socket.addEventListener('close', resolve, { once: true })), new Promise(resolve => setTimeout(resolve, 3000))])
  }
  socket?.close()
  if (child.exitCode === null) await new Promise(r => { child.once('exit', r); setTimeout(r, 5000) })
  if (child.exitCode === null) child.kill()
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
}
