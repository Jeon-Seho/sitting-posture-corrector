// GP-0125: real POSEGOOD package, isolated profile and public-photo camera fixture.
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url)
const version=JSON.parse(await readFile('frontend/package.json','utf8')).version
const faceOnly=process.argv.includes('--face-only')
const {_electron}=require(process.env.POSEGOOD_PLAYWRIGHT_PATH||'playwright')
const profile=await mkdtemp(join(tmpdir(),'posegood-face-service-smoke-'))
const executable=resolve(process.argv[2]||'frontend/release/win-unpacked/PoseGood.exe')
let application,context,page,pid
try{
  application=await _electron.launch({executablePath:executable,args:['--posegood-smoke-hidden',`--user-data-dir=${profile}`],timeout:60000})
  pid=application.process().pid;context=application.context();page=await application.firstWindow()
  await page.waitForURL('app://posegood/**',{timeout:30000})
  await page.locator('.cover-page').waitFor()
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  const photo=(await readFile('artifacts/face-lab/portrait.jpg')).toString('base64')
  await page.addInitScript(({photo,faceOnly})=>{
    // Real face/pose detector, with an extra observation inside the sampler's
    // interval. In 0.2.0 this repeatedly replaced a ready prediction with a hold.
    const NativeWorker=window.Worker
    window.Worker=class extends NativeWorker {
      get onmessage(){return this.receiver??null}
      set onmessage(receiver){
        this.receiver=receiver
        super.onmessage=event=>{
          if(window.__faceMissing&&event.data.type==='frame')event=new MessageEvent('message',{data:{...event.data,observation:null,overlay:[],shoulderLine:[]}})
          if(window.__faceShouldersMissing&&event.data.type==='frame'&&event.data.observation){
            event=new MessageEvent('message',{data:{...event.data,observation:{...event.data.observation,shoulders:null}}})
          }
          receiver?.call(this,event)
          if(window.__faceTimingJitter&&event.data.type==='frame'&&event.data.observation){
            const observation={...event.data.observation,timeMs:event.data.observation.timeMs+1}
            receiver?.call(this,new MessageEvent('message',{data:{...event.data,observation}}))
          }
        }
      }
    }
    window.__faceShouldersMissing=faceOnly
    localStorage.setItem('posegood.v2.profile',JSON.stringify({name:'합성 패키지 검증',age:23,occupation:'합성 테스트'}))
    let x=0
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480
      const ctx=canvas.getContext('2d'),image=new Image();image.src='data:image/jpeg;base64,'+photo;await image.decode()
      setInterval(()=>{ctx.fillStyle='#ece8df';ctx.fillRect(0,0,640,480);ctx.drawImage(image,160+x,0,320,480)},33)
      window.__faceServiceMove=()=>{x=65};return canvas.captureStream(30)
    }})
  },{photo,faceOnly})
  await page.goto('app://posegood/index.html')
  await page.getByText(`POSEGOOD v${version} · 얼굴 모델 적용`,{exact:true}).waitFor()
  await page.getByRole('button',{name:'내 프로필로 시작',exact:true}).click()
  await page.locator('.nav-item').filter({hasText:'측정'}).click()
  await page.getByRole('button',{name:'카메라 켜기',exact:true}).click()
  await page.getByRole('button',{name:'측정 종료',exact:true}).waitFor({timeout:60000})
  await page.evaluate(()=>{window.__faceTimingJitter=true})
  await page.waitForFunction(faceOnly=>document.body.innerText.includes(faceOnly?'머리 각도 기준 범위 · 상체 제외':'기준 범위 · 상체 관측'),faceOnly,{timeout:30000})
  await page.waitForTimeout(6000)
  const before=await page.getByRole('region',{name:'자세 점수'}).innerText().catch(()=>page.locator('[aria-label="자세 점수"]').innerText())
  assert.ok(before.includes('100'),before)
  await page.evaluate(()=>window.__faceServiceMove());await page.waitForTimeout(6000)
  const after=await page.locator('[aria-label="자세 점수"]').innerText();assert.ok(after.includes('100'),after)
  await page.getByText('얼굴 분석 상태 확인',{exact:true}).click()
  const diagnostics=await page.getByText('얼굴 분석 상태 확인',{exact:true}).locator('..').innerText()
  assert.ok(/모델 실행 [1-9][0-9]*회/.test(diagnostics),diagnostics)
  assert.ok(diagnostics.includes('입력 40/40'),diagnostics)
  assert.ok((await page.locator('body').innerText()).includes('얼굴 모델 적용'))
  const nativeWindow=await application.browserWindow(page)
  // Use main-process reads throughout: renderer automation can activate a page.
  const minimized=await nativeWindow.evaluate(async window=>{
    const count=async()=>Number((await window.webContents.executeJavaScript('document.body.innerText')).match(/모델 실행 (\d+)회/)?.[1]??0)
    window.minimize();const before=window.isMinimized(),start=await count()
    await new Promise(resolve=>setTimeout(resolve,10000))
    const after=window.isMinimized(),end=await count()
    window.hide()
    const popupResult=await window.webContents.executeJavaScript("window.posegoodDesktop.showAlert({title:'POSEGOOD 자동 검증',body:'백그라운드 알림 전달 검증입니다.'})")
    return {before,after,start,end,popupResult}
  })
  assert.ok(minimized.before&&minimized.after,'Native window did not stay minimized')
  const minimizedStart=minimized.start,minimizedEnd=minimized.end
  assert.ok(minimizedEnd>minimizedStart+10,'Minimized inference did not advance')
  assert.equal(await page.getByRole('button',{name:'측정 재개',exact:true}).count(),0)
  const popupResult=minimized.popupResult
  assert.equal(popupResult,'popup')
  const popup=context.pages().find(p=>p.url().endsWith('/alert-popup.html'))
  assert.ok(popup,'Popup page missing')
  await popup.evaluate(()=>window.posegoodPopup.close(true))
  await page.evaluate(()=>{window.__faceMissing=true});await page.waitForTimeout(5000)
  assert.equal(await page.getByRole('button',{name:'측정 재개',exact:true}).count(),0,'Face loss paused the session')
  const lostScore=await page.locator('[aria-label="자세 점수"]').innerText();assert.ok(lostScore.includes('100'),lostScore)
  const reacquiredAt=Date.now();await page.evaluate(()=>{window.__faceMissing=false})
  await page.waitForFunction(()=>document.body.innerText.includes('머리 각도 기준 범위 · 상체 제외'),{},{timeout:2500})
  const reacquisitionMs=Date.now()-reacquiredAt
  await page.waitForTimeout(5000)
  await page.getByRole('button',{name:'잠시 쉬기',exact:true}).click();await page.waitForTimeout(400)
  const paused=await page.locator('[aria-label="자세 점수"]').innerText();assert.ok(paused.includes('100'));assert.ok(paused.includes('판단 보류'))
  await page.getByRole('button',{name:'측정 재개',exact:true}).click()
  await page.evaluate(()=>{window.__faceShouldersMissing=true})
  await page.waitForFunction(()=>document.body.innerText.includes('머리 각도 기준 범위 · 상체 제외'),{},{timeout:30000})
  await page.waitForTimeout(5000)
  const headScore=await page.locator('[aria-label="자세 점수"]').innerText();assert.ok(headScore.includes('100'),headScore)
  await page.getByRole('button',{name:'측정 종료',exact:true}).click()
  await page.waitForTimeout(1000)
  const records=await page.evaluate(()=>JSON.parse(localStorage.getItem('posegood.v2.records')||'[]'))
  assert.equal(records.length,1);assert.equal(records[0].mode,'camera');assert.equal(records[0].events.length,0);assert.ok(records[0].valid>=8,JSON.stringify(records[0]))
  assert.ok(records[0].evaluationCounts?.head.valid>=3,JSON.stringify(records[0]))
  assert.ok(faceOnly?records[0].evaluationCounts.upper_body.valid===0:records[0].evaluationCounts.upper_body.valid>=8,JSON.stringify(records[0]))
  const assets=await page.evaluate(async()=>Promise.all(['/face-model.json','/face-build.json','/face-detector.js'].map(async path=>{const r=await fetch(path);return {path,status:r.status}})))
  assert.ok(assets.every(a=>a.status===200));assert.deepEqual(errors,[])
  await page.goto('app://posegood/index.html')
  await page.getByRole('link',{name:'프로필 없이 자세 데이터 수집',exact:true}).click()
  await page.locator('.face-lab').waitFor()
  await page.getByRole('button',{name:'POSEGOOD으로 돌아가기',exact:true}).click()
  await page.getByRole('button',{name:'내 프로필로 시작',exact:true}).waitFor()
  await mkdir('artifacts/face-lab',{recursive:true})
  const nonEvaluatedSeconds=records[0].total-records[0].valid
  assert.ok(nonEvaluatedSeconds>=4,JSON.stringify(records[0]))
  const summary={executable,appVersion:version,not_human_accuracy:true,faceOnlyBaseline:faceOnly,missingShouldersFixture:true,versionVisible:true,faceModelConnected:true,shortIntervalObservations:true,minimizedInferenceCounts:[minimizedStart,minimizedEnd],minimizedPopupTransport:popupResult,faceLossDidNotPause:true,reacquisitionMs,nonEvaluatedSeconds,diagnostics,validSeconds:records[0].valid,evaluationCounts:records[0].evaluationCounts,positionShiftScorePreserved:true,pauseScorePreserved:true,resultSaved:true,faceCollectionEntry:true,assets,errors}
  await writeFile(`artifacts/face-lab/posegood-face-service-smoke${faceOnly?'-head-only':''}.json`,JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2))
}catch(e){console.log(String(e));console.log(await page?.locator('body').innerText({timeout:3000}).catch(()=>'<page unavailable>'));throw e}
finally{if(pid)spawnSync('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await application?.close().catch(()=>{})}
