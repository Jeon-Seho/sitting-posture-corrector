// Public MediaPipe portrait fixture, transformed on a canvas; no user's camera.
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.POSEGOOD_PLAYWRIGHT_PATH||'playwright');
const server=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),mode:'face-lab',server:{host:'127.0.0.1',port:0}});
await server.listen();
const browser=await chromium.launch({executablePath:process.env.POSEGOOD_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
let page;
try {
  page=await browser.newPage({viewport:{width:1280,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const data=(await readFile('artifacts/face-lab/portrait.jpg')).toString('base64');
  await page.addInitScript(({data})=>{
    let x=0;
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
      const ctx=canvas.getContext('2d'),image=new Image();image.src='data:image/jpeg;base64,'+data;await image.decode();
      // Full fixture: portrait has a face and shoulders. It is only a tracking smoke test.
      setInterval(()=>{ctx.fillStyle='#ece8df';ctx.fillRect(0,0,640,480);ctx.drawImage(image,160+x,0,320,480)},33);
      window.__faceSmokeMove=()=>{x=65};
      return canvas.captureStream(30);
    }});
  },{data});
  await page.goto(server.resolvedUrls.local[0]);
  await page.getByRole('button',{name:'고개 회전',exact:true}).waitFor();
  await page.getByRole('button',{name:'카메라 연결',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelectorAll('button')[1].disabled,{},{timeout:45000});
  await page.waitForFunction(()=>document.querySelector('.face-camera span').textContent.startsWith('얼굴'),{},{timeout:30000});
  await page.waitForTimeout(8500);
  await page.waitForFunction(()=>!!document.querySelector('.face-status details'),{},{timeout:30000});
  const before=await page.locator('.face-status').innerText();
  const beforeScore=await page.locator('.face-score').innerText();
  await page.evaluate(()=>window.__faceSmokeMove());
  await page.waitForTimeout(6000);
  const after=await page.locator('.face-status').innerText();
  assert.equal(await page.locator('.face-score').innerText(),beforeScore,'Position shift must not deduct score');
  await page.screenshot({path:'artifacts/face-lab/browser-preview.png',fullPage:true});
  assert.deepEqual(errors,[]);assert.equal(await page.locator('[role=alert]').count(),0);
  const summary={public_fixture:true,not_human_accuracy:true,faceObserved:true,positionShiftScorePreserved:true,before,after,errors};
  await mkdir('artifacts/face-lab',{recursive:true});await writeFile('artifacts/face-lab/browser-smoke.json',JSON.stringify(summary,null,2));
  console.log(JSON.stringify(summary,null,2));
} catch(e) {console.log(await page?.locator('body').innerText());throw e} finally {await browser.close();await server.close()}
