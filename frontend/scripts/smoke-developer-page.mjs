// Actual packaged EXE with an isolated profile. No real camera or account is used.
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { Cdp, until } from '../../tools/browser/cdp.mjs'
const root=fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]$/, '')
const artifacts=root+'/.cache/repackage-verification'
await mkdir(artifacts,{recursive:true})
const profile=await mkdtemp(artifacts+'/profile-')
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r))
const child=spawn(root+'/frontend/release/win-unpacked/PoseGood.exe',['--posegood-smoke-hidden',`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`],{windowsHide:true,stdio:'ignore'})
let cdp
try {
 const page=await until(async()=>{try{return(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p=>p.type==='page'&&p.url.startsWith('app://posegood/'))}catch{return null}},'packaged app',30000)
 cdp=await Cdp.connect(page.webSocketDebuggerUrl)
 const errors=[]
 cdp.on('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails.exception?.description??e.exceptionDetails.text))
 await cdp.call('Runtime.enable')
 await until(()=>cdp.evaluate(`!!document.querySelector('input[name=email]')`),'login')
 assert.equal(await cdp.evaluate(`window.posegoodDesktop.getLaunchInfo().then(i=>i.packaged)`),true)
 await cdp.evaluate(`window.cameraCalls=0;navigator.mediaDevices.getUserMedia=async()=>{window.cameraCalls++;throw Error('Camera forbidden during smoke')}`)
 const assets=await cdp.evaluate(`Promise.all(['/pose-cpu-worker.js','/mediapipe/vision_bundle.js','/mediapipe/pose_landmarker_lite.task'].map(async p=>{const r=await fetch(p);return {p,status:r.status,bytes:(await r.arrayBuffer()).byteLength}}))`)
 for(const asset of assets){assert.equal(asset.status,200);assert.ok(asset.bytes>100)}
 await cdp.evaluate(`(()=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [name,value]of [['email','admin'],['password','1234']]){const input=document.querySelector('input[name='+name+']');set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))}})()`)
 await cdp.evaluate(`document.querySelector('form').requestSubmit()`)
 await until(()=>cdp.evaluate(`!!document.querySelector('.shell')`),'admin login')
 assert.deepEqual(await cdp.evaluate(`[...document.querySelectorAll('.nav-item')].map(b=>b.textContent).slice(-2)`),['설정','개발자 도구'])
 await cdp.evaluate(`[...document.querySelectorAll('.nav-item')].find(b=>b.textContent==='개발자 도구').click()`)
 await until(()=>cdp.evaluate(`document.querySelector('h1')?.textContent==='개발자 도구'`),'developer tools')
 assert.equal(await cdp.evaluate(`document.querySelector('[aria-label="발표용 예시 기록 표시"]').getAttribute('aria-pressed')`),'false')

 assert.equal(await cdp.evaluate(`document.querySelectorAll('.dev-section').length`),5)
 assert.equal(await cdp.evaluate(`document.querySelectorAll('.dev-group').length`),0)
 assert.equal(await cdp.evaluate(`document.querySelectorAll('.dev-jump-nav button').length`),5)
 assert.equal(await cdp.evaluate(`getComputedStyle(document.querySelector('.dev-code-mark'),'::before').content`),'"DeV"')
 assert.equal(await cdp.evaluate(`document.querySelector('.dev-data-banner').compareDocumentPosition(document.querySelector('.dev-jump-nav')) & Node.DOCUMENT_POSITION_FOLLOWING`),4)
 const shot=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
 const {writeFile}=await import('node:fs/promises');await writeFile(artifacts+'/developer-tools-final.png',Buffer.from(shot.data,'base64'))
 for(const [label,result]of [['GPU 실패 → CPU 성공','카메라가 준비됐어요'],['GPU·CPU 모두 실패','카메라를 준비하지 못했어요'],['준비 시간 초과','카메라 준비가 오래 걸려요'],['전환 중 취소','카메라 준비를 취소했어요']]){
  const key = { 'GPU 실패 → CPU 성공': 'fallback', 'GPU·CPU 모두 실패': 'failed', '준비 시간 초과': 'timeout', '전환 중 취소': 'cancel' }[label]
  await cdp.evaluate(`(()=>{const select=document.querySelector('[aria-label="복구 테스트 시나리오"]');select.value=${JSON.stringify(key)};select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='선택한 흐름 재현').click()`)
  assert.equal(await cdp.evaluate(`document.querySelector('.camera-fault-preview').matches(':modal')`),true)
  assert.equal(await cdp.evaluate(`document.querySelector('.fault-preview-stage').getAttribute('aria-busy')`),'true')
  if(label.startsWith('GPU 실패')){
   await until(()=>cdp.evaluate(`!!document.querySelector('dialog[role=alertdialog][open]')`),'CPU notice')
   assert.equal(await cdp.evaluate(`document.querySelectorAll('dialog:modal').length`),2)
   await cdp.evaluate(`document.querySelector('dialog[role=alertdialog] button').click()`)
  }
  await until(()=>cdp.evaluate(`document.querySelector('.fault-preview-state h3')?.textContent===${JSON.stringify(result)}`),'visible scenario '+label)
  await cdp.evaluate(`[...document.querySelectorAll('.camera-fault-preview button')].find(b=>b.textContent==='테스트 종료').click()`)
  await until(()=>cdp.evaluate(`!document.querySelector('dialog[open]')`),'close scenario')
 }
 await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='오류 화면 열기').click()`)
 await until(()=>cdp.evaluate(`document.querySelector('.fault-preview-state p')?.textContent.includes('카메라 권한이 꺼져')`),'camera permission user screen')
 await cdp.evaluate(`[...document.querySelectorAll('.camera-fault-preview button')].find(b=>b.textContent==='미리보기 닫기').click()`)

 for (const [key,expected] of [['unsupported','이 브라우저에서는 카메라'],['preparationTimeout','카메라 준비가 오래'],['videoUnavailable','카메라 화면을 준비하지'],['disconnected','카메라 연결이 끊겼어요'],['trackingFailed','자세 추적을 이어갈'],['permissionDenied','카메라 권한이 꺼져'],['deviceMissing','연결된 카메라가 없어요'],['deviceBusy','다른 앱이 카메라'],['deviceUnavailable','고른 카메라'],['preparationFailed','카메라나 자세 추적 모델']]) {
  await cdp.evaluate(`(()=>{const select=document.querySelector('[aria-label="카메라 오류 상황"]');select.value=${JSON.stringify(key)};select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='오류 화면 열기').click()`)
  assert.equal(await cdp.evaluate(`document.querySelector('.fault-preview-stage').getAttribute('aria-busy')`),'true')
  await until(()=>cdp.evaluate(`document.querySelector('.fault-preview-stage').getAttribute('aria-busy')==='false' && document.querySelector('.fault-preview-state p').textContent.includes(${JSON.stringify(expected)})`),'injected error '+key)
  await cdp.evaluate(`[...document.querySelectorAll('.camera-fault-preview button')].find(b=>b.textContent==='테스트 종료').click()`)
 }
 for (const key of ['limited','unknown']) {
  await cdp.evaluate(`(()=>{const select=document.querySelector('[aria-label="성능 안내 상황"]');select.value=${JSON.stringify(key)};select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='안내 팝업 열기').click()`)
  assert.equal(await cdp.evaluate(`!!document.querySelector('dialog[role=alertdialog][open]')`),false)
  await until(()=>cdp.evaluate(`!!document.querySelector('dialog[role=alertdialog][open]')`),'injected graphics '+key)
  await cdp.evaluate(`document.querySelector('dialog[role=alertdialog] button').click()`)
  await cdp.evaluate(`[...document.querySelectorAll('.camera-fault-preview button')].find(b=>b.textContent==='테스트 종료').click()`)
 }
 console.log('PASS: 10 media/model/frame failure injections and 2 WebGL probe injections through shared production handlers')
 await cdp.evaluate(`[...document.querySelectorAll('.dev-jump-nav button')].find(b=>b.textContent==='화면·모션').click()`)
 assert.equal(await cdp.evaluate(`document.activeElement.id`),'dev-heading-appearance')
 await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='화면·모션 미리보기 열기').click()`)
 await until(()=>cdp.evaluate(`!!document.querySelector('dialog:modal .dev-interaction')`),'motion dialog')
 await cdp.evaluate(`[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='준비 단계 넘기기').click()`)
 await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
 await until(()=>cdp.evaluate(`!document.querySelector('dialog[open]')`),'Escape returns to page')
 await cdp.evaluate(`[...document.querySelectorAll('.dev-jump-nav button')].find(b=>b.textContent==='알림·연결').click()`)
 assert.equal(await cdp.evaluate(`document.activeElement.id`),'dev-heading-alerts')
 await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='자세 알림').click()`)
 await until(()=>cdp.evaluate(`!!document.querySelector('.toast')`),'actual-position posture toast')
 console.log('PASS: five expanded sections, anchor navigation and focus, user-flow modals, nested CPU notice, camera permission screen, motion dialog and actual-position alert')
 await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='끊김 화면 확인').click()`)
 await until(()=>cdp.evaluate(`!![...document.querySelectorAll('dialog button')].find(b=>b.textContent==='테스트 종료')`),'connection preview')
 await cdp.evaluate(`[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='테스트 종료').click()`)
 await until(()=>cdp.evaluate(`!document.querySelector('dialog[open]')`),'preview dismissal')


 await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='앱 밖 알림창').click()`)
 const popup=await until(async()=> (await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p=>p.url.includes('alert-popup.html')),'native alert window')
 assert.ok(popup)
 await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='PiP 열기').click()`)
 await until(()=>cdp.evaluate(`!!window.open('', 'posegood-camera')?.document.querySelector('.camera-window-demo')`),'actual native camera preview')
 await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='테스트 창 닫기').click()`)
 console.log('PASS: actual native alert and camera preview windows')
 await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='예시 오늘 화면 열기').click()`)
 await until(()=>cdp.evaluate(`!!document.querySelector('.history-example')||document.body.innerText.includes('발표용 예시 기록 · 실제 측정 기록이 아니에요')`),'actual example record screen')
 await cdp.evaluate(`[...document.querySelectorAll('.nav-item')].find(b=>b.textContent==='개발자 도구').click()`)
 await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='화면 꾸미기 열기').click()`)
 await until(()=>cdp.evaluate(`!!document.querySelector('.theme-presets')`),'actual appearance settings')
 assert.equal(await cdp.evaluate('window.cameraCalls'),0)
 assert.deepEqual(errors,[])
 console.log('PASS: repackaged developer page, demo OFF, dismissible connection preview, zero camera calls and zero uncaught exceptions')
} finally {
 if(cdp){await cdp.evaluate('window.posegoodDesktop.quit()').catch(()=>{});cdp.close()}
 if(child.exitCode===null)await new Promise(r=>{child.once('exit',r);setTimeout(r,3000)})
 if(child.exitCode===null)child.kill()
}
