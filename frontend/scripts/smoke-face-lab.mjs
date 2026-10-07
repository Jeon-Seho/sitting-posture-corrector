// Actual packaged EXE, isolated profile and fake camera; no real footage.
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import assert from 'node:assert/strict'
const listener = createServer()
await new Promise(r => listener.listen(0, '127.0.0.1', r))
const port = listener.address().port
await new Promise(r => listener.close(r))
const profile = await mkdtemp(join(tmpdir(), 'posegood-face-lab-smoke-'))
const version = JSON.parse(await readFile('frontend/package.json','utf8')).version
const expectedBuild = JSON.parse(await readFile('frontend/dist-face/face-build.json','utf8'))
const child = spawn(resolve(`frontend/release-face/PoseGood-Face-Lab-${version}.exe`), ['--lab-smoke-hidden', `--lab-profile=${profile}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'], { windowsHide: true, stdio: 'ignore' })
let socket
try {
  let page
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => p.type === 'page' && p.url.startsWith('lab://posegood/')); if (page) break } catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  assert.ok(page, 'Packaged lab did not start')
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, reject) => { socket.onopen = r; socket.onerror = reject })
  let id = 0
  const pending = new Map()
  socket.onmessage = e => { const v = JSON.parse(e.data); if (pending.has(v.id)) { pending.get(v.id)(v); pending.delete(v.id) } }
  const call = (method, params = {}) => new Promise((resolveCall, reject) => {
    const key = ++id, timer = setTimeout(() => reject(new Error(`Timeout ${method}`)), 60000)
    pending.set(key, v => { clearTimeout(timer); v.error ? reject(v.error) : resolveCall(v.result) })
    socket.send(JSON.stringify({ id: key, method, params }))
  })
  // Target URL becomes visible before the first navigation has committed.
  let ready = false
  for (let i = 0; i < 100; i++) {
    try {
      const result = await call('Runtime.evaluate', { returnByValue: true, expression: "document.readyState === 'complete' && !!document.querySelector('.face-lab')" })
      if (result.result?.value === true) { ready = true; break }
    } catch (e) { if (!String(e.message).includes('context')) throw e }
    await new Promise(r => setTimeout(r, 150))
  }
  assert.ok(ready, 'Lab UI did not render')
  const reply = await call('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
    const wait = ms => new Promise(r => setTimeout(r,ms));
    for(let i=0;i<100;i++){if([...document.querySelectorAll('button')].some(b=>b.textContent==='고개 회전'&&!b.disabled)) break; await wait(100)}
    const files=['/face-model.json','/face-build.json','/mediapipe/face_landmarker.task','/mediapipe/wasm/vision_wasm_internal.wasm','/mediapipe/pose_landmarker_lite.task'];
    const build=await (await fetch('/face-build.json')).json();
    const assets=await Promise.all(files.map(async path=>{const r=await fetch(path);return {path,status:r.status,bytes:(await r.arrayBuffer()).byteLength}}));
    const demos=[];
    for(const label of ['머무름','고개 회전','위치 이동','양손 들기','목 움직임']){[...document.querySelectorAll('button')].find(b=>b.textContent===label).click();await wait(150);demos.push(document.querySelector('.face-status h2').textContent)}
    [...document.querySelectorAll('button')].find(b=>b.textContent==='카메라 연결').click();
    let width=0,detectorReady=false;
    for(let i=0;i<130;i++){await wait(300);width=document.querySelector('video').videoWidth;detectorReady=[...document.querySelectorAll('button')].some(b=>b.textContent==='기준 다시 등록'&&!b.disabled);if(detectorReady)break;if(document.querySelector('[role=alert]'))break;}
    await wait(1200);
    const alerts=[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent);
    return {secure:isSecureContext,build,versionText:document.querySelector('.face-tag').textContent,assets,demos,width,detectorReady,alerts,text:document.body.innerText};
  })()` })
  assert.ok(!reply.exceptionDetails, JSON.stringify(reply.exceptionDetails))
  const result = reply.result.value
  if(!result.detectorReady) console.log(result.text)
  assert.equal(result.secure, true)
  assert.deepEqual(result.build,expectedBuild)
  assert.ok(result.versionText.includes(version))
  assert.ok(result.assets.every(a => a.status === 200 && a.bytes > 0))
  assert.ok(result.demos.every(v => v === '제작 시퀀스 분류 · 실카메라 아님')); assert.equal(result.detectorReady, true, 'Face worker must finish loading');
  assert.ok(result.width > 0, 'Fake camera not connected')
  assert.deepEqual(result.alerts, [])
  const folder = resolve('artifacts/face-lab')
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'desktop-smoke.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ ...result, text: undefined }, null, 2))
} finally {
  socket?.close()
  // Portable launchers have a child Electron process. Stop the test process tree.
  if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  else child.kill()
}
