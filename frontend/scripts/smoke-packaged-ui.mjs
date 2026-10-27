// Real packaged EXE, isolated profile; no account server, SMTP or camera access.
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import assert from 'node:assert/strict'
import { Cdp, until } from '../../tools/browser/cdp.mjs'

const artifacts = resolve('../.cache/packaged-ui')
await mkdir(artifacts, { recursive: true })
const profile = await mkdtemp(join(artifacts, 'profile-'))
const server = createServer()
await new Promise(r => server.listen(0, '127.0.0.1', r))
const port = server.address().port
await new Promise(r => server.close(r))
const child = spawn(resolve('release/win-unpacked/PoseGood.exe'), [
  '--posegood-smoke-hidden', `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`,
], { windowsHide: true, stdio: 'ignore' })
let cdp
try {
  const page = await until(async () => {
    try { return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => p.type === 'page' && p.url.startsWith('app://posegood/')) }
    catch { return null }
  }, 'packaged main page', 45000)
  cdp = await Cdp.connect(page.webSocketDebuggerUrl)
  await until(() => cdp.evaluate(`document.body?.innerText.includes('비밀번호 재설정')`), 'packaged reset entry', 30000)
  const login = await cdp.evaluate(`(async()=>{await Promise.all([...document.images].map(i=>i.decode()));return {packaged:(await window.posegoodDesktop.getLaunchInfo()).packaged,hero:getComputedStyle(document.querySelector('.cover-hero')).backgroundColor,art:document.querySelector('.cover-art').getAttribute('src'),broken:[...document.images].filter(i=>!i.naturalWidth).length}})()`)
  assert.equal(login.packaged, true)
  assert.equal(login.hero, 'rgb(65, 107, 86)')
  assert.equal(login.art, '/illustrations/login-light.webp')
  assert.equal(login.broken, 0)
  assert.equal(await cdp.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--alert-soft').trim().toUpperCase()`), '#E5484D')
  const cameraAsset = await cdp.evaluate(`(async()=>{const image=new Image();image.src='/illustrations/ready-camera-matte.webp';await image.decode();return image.naturalWidth>0})()`)
  assert.equal(cameraAsset, true, 'current matte camera image included in package')
  await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='비밀번호 재설정').click()`)
  await until(() => cdp.evaluate(`document.body.innerText.includes('화면 준비 단계')`), 'honest unconfigured mail UI')
  await cdp.call('Page.navigate', { url: 'app://posegood/index.html#password-reset?token=synthetic-ui-token' })
  await until(() => cdp.evaluate(`document.querySelector('input[name=mail-token]')?.value==='synthetic-ui-token'`), 'packaged token landing')
  assert.equal(await cdp.evaluate(`location.hash.includes('token')`), false)
  // Isolated local preview account; forbid actual capture even if the demo regresses.
  await cdp.evaluate(`localStorage.setItem('posegood.v2.profile', JSON.stringify({name:'합성 패키지 검사'}))`)
  await cdp.call('Page.navigate', { url: 'app://posegood/index.html' })
  await until(() => cdp.evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='로그인')`), 'packaged login')
  await cdp.evaluate(`window.__cameraCalls=0; navigator.mediaDevices.getUserMedia=async()=>{window.__cameraCalls++;throw Error('Actual camera forbidden in package smoke')}; [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='로그인').click()`)
  await until(() => cdp.evaluate(`!!document.querySelector('.shell')`), 'packaged shell')
  await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='설정').click()`)
  await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='PiP 열기').click()`)
  await until(() => cdp.evaluate(`!!window.open('', 'posegood-camera')?.document.querySelector('.camera-window-demo')`), 'packaged camera-free PiP')
  assert.equal(await cdp.evaluate(`window.__cameraCalls`), 0)
  assert.equal(await cdp.evaluate(`document.querySelector('.capture-source').srcObject`), null)
  assert.equal(await cdp.evaluate(`!!document.querySelector('.camera-window-launch')`), false)
  await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='테스트 창 닫기').click()`)
  console.log('PASS: actual EXE camera-free PiP example, zero getUserMedia calls, capture stream null, no floating launcher')
  console.log('PASS: actual EXE, light hero and matte camera images decoded, reset entry, unconfigured mail notice, token landing and URL cleanup; no camera or SMTP')
} finally {
  if (cdp) await cdp.evaluate('window.close()').catch(() => {})
  cdp?.close()
  if (child.exitCode === null) await new Promise(r => { child.once('exit', r); setTimeout(r, 3000) })
  if (child.exitCode === null) child.kill()
}
