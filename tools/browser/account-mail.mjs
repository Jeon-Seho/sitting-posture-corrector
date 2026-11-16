import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { launchChrome } from './chrome.mjs'
import { until, delay } from './cdp.mjs'
// Synthetic responses only: this script never sends mail or connects an external identity.
// Start Vite with VITE_EMAIL_VERIFICATION_ENABLED=true and VITE_PASSWORD_RESET_ENABLED=true.
const [base,executable,artifactFolder]=process.argv.slice(2)
if(!artifactFolder)throw Error('Usage: node tools/browser/account-mail.mjs <Vite URL> <Chrome path> <artifacts folder>')
const artifacts=resolve(artifactFolder)
await mkdir(artifacts,{recursive:true})
const profile=await mkdtemp(artifacts+sep+'profile-')
const browser=await launchChrome({executable,port:19458,profile,artifactFolder:artifacts})
const c=browser.cdp
let registerCount=0,verified=false,linked=false,linkVerified=false,resetDone=false
const calls=[]
const view={user_id:'89',email:'synthetic@example.test',profile:{name:'합성 계정',age:30,occupation:'합성 시험'},today:'2026-11-16',access_token:'synthetic-access-token',token_type:'Bearer',expires_in:1800}
c.on('Fetch.requestPaused',async({requestId,request})=>{
 try{
 const path=new URL(request.url).pathname
 const body=request.postData ? JSON.parse(request.postData) : null
 calls.push({path,method:request.method,body})
 let code=200,value={}
 if(path.endsWith('/refresh')){code=401;value={code:'UNAUTHENTICATED',message:'authentication required'}}
 else if(path.endsWith('/email-verification/requests'))code=202
 else if(path.endsWith('/email-verification/confirm')){code=body.token==='123456'?204:410;verified=code===204}
 else if(path.endsWith('/password-reset/requests'))code=202
 else if(path.endsWith('/password-reset/validate'))code=body.token==='synthetic-link-code'?204:410
 else if(path.endsWith('/password-reset/confirm')){code=body.new_password==='synthetic-old-password'?400:204;value={code:'PASSWORD_REUSED'};resetDone=code===204}
 else if(path.endsWith('/register')){assert.equal(verified,true);registerCount++;value=view}
 else if(path.endsWith('/pending-link/verify')){linkVerified=true;code=204}
 else if(path.endsWith('/pending-link/confirm')){assert.equal(linkVerified,true);linked=true;value=view}
 else if(path.endsWith('/pending-link'))value={provider:'discord',email:view.email,verified:linkVerified}
 else if(path.endsWith('/workspace'))value={profile:view.profile,rules:{holdSeconds:3,recoverSeconds:3,realertSeconds:60,threshold:0.7},preferences:{alerts_on:true},consents:{optional_profile:true}}
 else if(path.endsWith('/records'))value={today:view.today,records:[]}
 else if(path.endsWith('/me'))value=view
 else if(path.endsWith('/baselines/current')){code=404;value={code:'NOT_FOUND'}}
 else if(path.endsWith('/logout'))code=204
 else throw Error('Unexpected API '+path)
 await c.call('Fetch.fulfillRequest',{requestId,responseCode:code,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Cache-Control',value:'no-store'}],body:Buffer.from(code===204?'':JSON.stringify(value)).toString('base64')}).catch(error=>{if(!error.message.includes('Invalid InterceptionId'))throw error})
 }catch(error){browser.errors.push(error.message);await c.call('Fetch.failRequest',{requestId,errorReason:'Aborted'}).catch(()=>{})}
})
await c.call('Fetch.enable',{patterns:[{urlPattern:'*/api/*',requestStage:'Request'}]})
const text=()=>c.evaluate('document.body.innerText')
const click=label=>c.invoke(`function(label){const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label);if(!b)throw Error('Missing button: '+label);b.click()}`,label)
const fill=(name,value)=>c.invoke(`function(name,value){const i=document.querySelector('input[name="'+name+'"]');if(!i)throw Error('Missing input: '+name);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,value);i.dispatchEvent(new Event('input',{bubbles:true}))}`,name,value)
const wait=s=>until(async()=>(await text()).includes(s),s)
const submit=()=>c.evaluate('document.querySelector("button[type=submit]").click()')
const navigate=async hash=>{await c.call('Page.navigate',{url:'about:blank'});await c.call('Page.navigate',{url:new URL(hash||'.',base).href});await delay(500)}
try{
 await navigate('')
 await wait('비밀번호 찾기')
 await click('회원가입');await click('전체 동의');await submit();await wait('계정 정보')
 await fill('email',view.email);await fill('password','synthetic-new-password');await fill('name',view.profile.name);await fill('age','30');await fill('occupation','합성 시험');await submit()
 await wait('회원가입 · 이메일 인증');assert.equal(registerCount,0)
 await browser.screenshot('signup-email-request')
 await submit();await wait('6자리 인증 코드');await fill('mail-token','000000');await submit();await wait('만료')
 await fill('mail-token','123456');await submit();await wait('이메일 인증이 완료');assert.equal(registerCount,0)
 await click('회원가입 계속하기');await wait('계정 정보');await submit();await wait('자세 등록');assert.equal(registerCount,1)
 console.log('PASS browser: registration waits for email verification; failed code cannot continue')
 await navigate('#password-reset?token=synthetic-link-code');await wait('기존 비밀번호와 다른')
 assert.equal(await c.evaluate('location.hash'),'')
 await fill('new-password','synthetic-new-password');await fill('password-again','mismatched-password');await submit();await wait('서로 달라요');assert.equal(resetDone,false)
 await fill('new-password','synthetic-old-password');await fill('password-again','synthetic-old-password');await submit();await wait('기존 비밀번호와 다른 새 비밀번호를 입력해')
 await fill('new-password','synthetic-new-password');await fill('password-again','synthetic-new-password');await submit();await wait('비밀번호를 재설정했어요');assert.equal(resetDone,true)
 console.log('PASS browser: link validation, URL removal, password mismatch and reuse rejection, reset completion')
 await navigate('#social-link');await wait('이미 가입된 계정이 있어요');await browser.screenshot('discord-account-collision');await submit();await wait('기존 계정으로 본인 확인');await fill('link-password','synthetic-password');await submit();await wait('Discord 계정을 연결할까요?');assert.equal(linked,false)
 await browser.screenshot('discord-link-confirmation');await submit();await wait('합성 계정');assert.equal(linked,true)
 console.log('PASS browser: Discord collision requires password and explicit approval before sign-in')
 await navigate('');await click('비밀번호 찾기');await wait('비밀번호 찾기 메일 받기')
 for(const [width,theme] of [[390,'light'],[690,'dark'],[1360,'light']]){
  await c.call('Emulation.setDeviceMetricsOverride',{width,height:860,deviceScaleFactor:1,mobile:false})
  await c.invoke(`function(theme){document.documentElement.dataset.theme=theme}`,theme)
  await delay(100)
  assert.equal(await c.evaluate('document.documentElement.scrollWidth<=innerWidth'),true)
  await browser.screenshot('password-find-'+width+'-'+theme)
 }
 assert.equal(await c.evaluate(`Object.values(localStorage).some(v=>v.includes('synthetic-new-password')||v.includes('synthetic-link-code'))`),false)
 assert.equal(browser.errors.length,0,browser.errors.join('\n'))
 console.log('PASS browser: light/dark, 390/690/1360 widths, no secret persistence or unexpected console errors')
}finally{
 await browser.stop()
 assert.ok(profile.startsWith(artifacts+sep+'profile-'))
 await rm(profile,{recursive:true,force:true})
}
