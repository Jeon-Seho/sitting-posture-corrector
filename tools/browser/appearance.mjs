import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchChrome } from './chrome.mjs'
import { until, delay } from './cdp.mjs'
const [base, executable, artifactFolder] = process.argv.slice(2)
if (!artifactFolder) throw Error('Usage: appearance.mjs <app URL> <Chrome path> <artifacts folder>')
await mkdir(artifactFolder, { recursive: true })
const profile = await mkdtemp(join(tmpdir(), 'posegood-theme-'))
const browser = await launchChrome({ executable, port: 19450, profile, artifactFolder })
const c = browser.cdp
const evalJS = s => c.evaluate(s)
const body = () => evalJS('document.body.innerText')
const click = label => evalJS(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}); if(!b)throw Error('Missing button'); b.click(); })()`)
const fill = (name, value) => evalJS(`(() => { const e=document.querySelector('input[name="${name}"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true})); })()`)
const mode = expected => until(async () => await evalJS('document.documentElement.dataset.theme') === expected, expected+' mode')
try {
  await c.call('Emulation.setEmulatedMedia', { features: [{ name:'prefers-color-scheme', value:'light' }] })
  await c.call('Page.navigate', { url: base })
  await until(async () => (await body()).includes('비밀번호 재설정'), 'login')
  await fill('email','admin'); await fill('password','1234'); await click('로그인')
  await until(async () => (await body()).includes('개발자 계정'), 'developer entry')
  await click('설정')
  await until(async () => (await body()).includes('화면 꾸미기'), 'appearance settings')
  for (const palette of ['green', 'peach', 'blue', 'teal', 'charcoal', 'black', 'discord']) {
    await evalJS(`document.querySelector('.theme-preset-${palette}').click()`)
    await until(async () => await evalJS('document.documentElement.dataset.palette') === palette, palette+' selection')
    await until(async () => await evalJS('[...document.querySelectorAll(".theme-preset-art img")].every(i=>i.complete && i.naturalWidth>0)'), 'theme assets loaded')
    await delay(250)
    await browser.screenshot('preset-'+palette)
  }
  await evalJS('document.querySelector(".theme-preset-black").click()')
  await click('기록')
  await until(async () => await evalJS('!!document.querySelector(".combo-bar")'), 'example chart')
  await delay(350)
  const chart = await evalJS(`(async () => {
    const { contrast } = await import('/src/features/appearance/theme.ts');
    const b = document.querySelector('.combo-bar');
    const card = b.closest('.card');
    const root = getComputedStyle(document.documentElement);
    const bg = '#202020';
    return { bar: getComputedStyle(b).fill, background: getComputedStyle(card).backgroundColor,
      barContrast: contrast(root.getPropertyValue('--chart-bar').trim(), bg),
      lineContrast: contrast(root.getPropertyValue('--chart-line').trim(), bg) };
  })()`)
  assert.ok(chart.barContrast >= 3, JSON.stringify(chart))
  assert.ok(chart.lineContrast >= 4.5, JSON.stringify(chart))
  await evalJS('document.querySelector(".combo").scrollIntoView({block:"center"})')
  await delay(250)
  await browser.screenshot('black-chart-visible')
  await click('설정')
  await evalJS('document.querySelector(".theme-preset-discord").click()')
  await click('측정하기')
  await until(async () => await evalJS('!!document.querySelector("img[src*=discord-camera]")'), 'camera illustration follows theme')
  await click('설정')
  await evalJS('document.querySelector(".appearance-custom").open=true');
  await fill('themeHex','#6750a4'); await click('색상 적용')
  assert.equal(await evalJS('getComputedStyle(document.documentElement).getPropertyValue("--primary").trim()'),'#6750a4')
  await delay(250); await browser.screenshot('appearance-light')
  await click('그레이'); await mode('gray')
  await delay(250); await browser.screenshot('appearance-gray')
  await click('다크'); await mode('dark')
  assert.equal(await evalJS('getComputedStyle(document.body).backgroundColor'),'rgb(19, 25, 32)')
  await delay(250); await browser.screenshot('appearance-dark')
  await fill('themeHex','#ffff00'); await click('색상 적용')
  await until(async () => await evalJS('getComputedStyle(document.querySelector(".appearance-preview .btn-primary")).color') === 'rgb(0, 0, 0)', 'contrasting button foreground')
  await fill('themeHex','oops')
  assert.equal(await evalJS('[...document.querySelectorAll("button")].find(b=>b.textContent==="색상 적용").disabled'),true)
  await click('시스템 설정')
  await c.call('Emulation.setEmulatedMedia', { features: [{ name:'prefers-color-scheme', value:'dark' }] })
  await mode('dark')
  await c.call('Emulation.setEmulatedMedia', { features: [{ name:'prefers-color-scheme', value:'light' }] })
  await mode('light')
  await click('다크')
  await c.call('Page.reload')
  await until(async () => (await body()).includes('비밀번호 재설정'), 'reload')
  await mode('dark')
  assert.equal(await evalJS('getComputedStyle(document.documentElement).getPropertyValue("--primary").trim()'),'#ffff00')
  await delay(250); await browser.screenshot('appearance-login-dark')
  await fill('email','admin');await fill('password','1234');await click('로그인')
  await until(async () => (await body()).includes('개발자 계정'), 're-entry');await click('설정')
  await c.call('Emulation.setDeviceMetricsOverride',{ width:390,height:844,deviceScaleFactor:1,mobile:false })
  await delay(250); await browser.screenshot('appearance-mobile')
  assert.equal(await evalJS('document.documentElement.scrollWidth <= innerWidth'),true,'mobile horizontal overflow')
  await click('화면 기본값으로 되돌리기');await mode('light')
  assert.equal(browser.errors.length,0,browser.errors.join('\n'))
  console.log('PASS appearance: seven palettes and images, black chart contrast, gray mode, custom HEX, dark/light/system changes, readable bright colors, invalid input, reload, mobile width, reset')
  console.log('Screenshots: '+artifactFolder)
} catch (error) {
  console.error(await body(), browser.errors)
  await delay(250); await browser.screenshot('appearance-failure')
  throw error
} finally { await browser.stop() }
