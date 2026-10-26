// Run against the explicit synthetic browser-smoke Vite server, never a real camera/account.
// node frontend/scripts/smoke-developer-tools.mjs http://127.0.0.1:5191
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createServer } from 'node:net'
import assert from 'node:assert/strict'
import { Cdp, until } from '../../tools/browser/cdp.mjs'

const base = process.argv[2]
assert.ok(base && new URL(base).hostname === '127.0.0.1', 'Explicit local synthetic server required')
const root = fileURLToPath(new URL('../../', import.meta.url))
const artifacts = resolve(root, '.cache/developer-camera-smoke')
await mkdir(artifacts, { recursive: true })
const profile = await mkdtemp(resolve(artifacts, 'profile-'))
const listener = createServer()
await new Promise(r => listener.listen(0, '127.0.0.1', r))
const port = listener.address().port
await new Promise(r => listener.close(r))
const executable = resolve(root, 'frontend/node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
const child = spawn(executable, [resolve(root, 'frontend/electron/main.cjs'), '--posegood-smoke-hidden', `--user-data-dir=${profile}`], {
  cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
  env: { ...process.env, POSEGOOD_DEV_URL: `${base}/?synthetic=1&preview=1`, POSEGOOD_DEBUG_PORT: String(port) },
})
let stderr = ''
child.stderr.on('data', data => { stderr = (stderr + data).slice(-4000) })
let cdp
try {
  const page = await until(async () => {
    if (child.exitCode !== null) throw new Error(`Electron exited: ${stderr}`)
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      return pages.find(page => page.type === 'page' && page.url.startsWith(base))
    } catch { return false }
  }, 'isolated Electron renderer', 30_000)
  cdp = await Cdp.connect(page.webSocketDebuggerUrl)
  await cdp.call('Runtime.enable')
  const evaluate = expression => cdp.evaluate(expression)
  const click = label => evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled);
    if (!button) throw new Error('Missing button: ' + ${JSON.stringify(label)});
    button.click();
  })()`)
  await until(() => evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='로그인'&&!b.disabled)`), 'login', 30_000)
  await click('로그인')
  await until(() => evaluate(`!!document.querySelector('.shell')`), 'shell')
  assert.equal(await evaluate(`window.posegoodDesktop.cameraWindow`), true)
  await click('카메라 켜기')
  await until(() => evaluate(`document.querySelector('.webcam-preview')?.readyState >= 2`), 'synthetic camera')
  await evaluate(`document.querySelector('.measure-panel details.more').open=true; [...document.querySelectorAll('.dev-group')].find(d=>d.querySelector('summary').textContent==='카메라·작은 창').open=true`)
  await click('PiP 열기')
  const popupReady = `!!window.open('', 'posegood-camera')?.document.querySelector('video')?.srcObject`
  // Inspect the named window, without requesting another camera or opening arbitrary content.
  await until(() => evaluate(popupReady), 'native portal video')
  assert.equal(await evaluate(`(() => {
    const popup = window.open('', 'posegood-camera');
    return popup.location.href === 'about:blank' &&
      popup.document.querySelector('video').srcObject === document.querySelector('.capture-source').srcObject &&
      !window.documentPictureInPicture?.window && !document.pictureInPictureElement &&
      window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.snapshot().permissionCalls === 0;
  })()`), true)
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  assert.equal(pages.filter(page => page.type === 'page' && page.url === 'about:blank').length, 1)
  // Wait for first-show painting/effects before interacting, as a user seeing the native window would.
  await evaluate(`new Promise(resolve => {
    const popup = window.open('', 'posegood-camera');
    popup.requestAnimationFrame(() => popup.requestAnimationFrame(resolve));
  })`)
  await until(()=>evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='PiP 접기'&&!b.disabled)`),'developer state')
  await click('PiP 접기')
  await until(() => evaluate(`(() => { const p = window.open('', 'posegood-camera'); return p.outerHeight < 100 && !p.document.querySelector('video'); })()`), 'compact native status bar')
  await click('PiP 펼치기')
  await until(() => evaluate(`(() => { const p = window.open('', 'posegood-camera'); return p.outerHeight >= 300 && !!p.document.querySelector('video')?.srcObject; })()`), 'native size and stream restored')
  const popupPage = pages.find(page => page.type === 'page' && page.url === 'about:blank')
  const popupCdp = await Cdp.connect(popupPage.webSocketDebuggerUrl)
  try {
    const { data } = await popupCdp.call('Page.captureScreenshot', { format: 'png' })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(resolve(artifacts, 'native-camera.png'), Buffer.from(data, 'base64'))
  } finally { popupCdp.close() }
  assert.equal(await evaluate(`window.open('https://example.com', 'other') === null`), true)
  await click('테스트 창 닫기')
  await until(() => evaluate(`!![...document.querySelectorAll('button')].find(b => b.textContent.trim() === '작은 창 열기')`), 'native close reflected in React')
  assert.equal(await evaluate(`document.querySelector('.capture-source').srcObject.getVideoTracks()[0].readyState`), 'live')
  await click('작은 창 열기')
  await until(() => evaluate(popupReady), 'native reopen')
  await until(() => evaluate(`!![...document.querySelectorAll('button')].find(b => b.textContent.trim() === '앱으로 복귀' && !b.disabled)`), 'return control')
  await click('앱으로 복귀')
  await until(() => evaluate(`!![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'PiP 접기' && b.disabled)`), 'returned to main window')
  await click('PiP 열기')
  await until(() => evaluate(popupReady), 'reopen after return')
  await click('테스트 창 닫기')
  await until(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    return !pages.some(page => page.type === 'page' && page.url === 'about:blank')
  }, 'native child cleanup')
  assert.equal(await evaluate(`document.querySelector('.capture-source').srcObject.getVideoTracks()[0].readyState`), 'live')
  console.log('PASS: developer PiP open/collapse/restore/return/close/reopen, native window shares stream, closing test preserves camera, no web PiP')
} catch (error) {
  if (cdp) console.error(await cdp.evaluate(`(() => {
    const child = window.open('', 'posegood-camera');
    return child && { width: child.outerWidth, height: child.outerHeight, body: child.document.body.innerText };
  })()`).catch(() => null))
  throw error
} finally {
  if (cdp) { await cdp.call('Browser.close').catch(() => {}); cdp.close() }
  if (child.exitCode === null) await new Promise(r => { child.once('exit', r); setTimeout(r, 5000) })
  if (child.exitCode === null) child.kill()
  child.stderr.destroy()
}
