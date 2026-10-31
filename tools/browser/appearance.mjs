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
const click = label => c.invoke(`function(label) {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label);
  if (!button) throw Error('Missing button');
  button.click();
}`, label)
const fill = (name, value) => c.invoke(`function(name, value) {
  const input = [...document.querySelectorAll('input')].find(input => input.name === name);
  if (!input) throw Error('Missing input');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}`, name, value)
const selectPalette = palette => c.invoke(`function(palette) {
  const button = [...document.querySelectorAll('.theme-preset')].find(b => b.classList.contains('theme-preset-' + palette));
  if (!button) throw Error('Missing palette');
  button.click();
}`, palette)
const mode = expected => until(async () => await evalJS('document.documentElement.dataset.theme') === expected, expected+' mode')
try {
  await c.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  await c.call('Page.navigate', { url: base })
  await until(async () => (await body()).includes('비밀번호 재설정'), 'login')
  await fill('email', 'admin'); await fill('password', '1234'); await click('로그인')
  await until(async () => (await body()).includes('개발자 계정'), 'developer entry')
  await click('설정')
  await until(async () => (await body()).includes('화면 꾸미기'), 'appearance settings')
  await selectPalette('green')
  await until(async () => await evalJS('document.documentElement.dataset.palette') === 'green', 'green selection')
  await until(async () => await evalJS('[...document.querySelectorAll(".theme-preset-art img")].every(i => i.complete && i.naturalWidth > 0)'), 'theme assets loaded')
  await click('라이트'); await mode('light')
  const lightBackground = await evalJS('getComputedStyle(document.body).backgroundColor')
  await evalJS('document.querySelector(".appearance-custom").open = true')
  await fill('themeHex', '#6750a4'); await click('색상 적용')
  assert.equal(await evalJS('getComputedStyle(document.documentElement).getPropertyValue("--primary").trim()'), '#6750a4')
  await browser.screenshot('appearance-light')
  await click('다크'); await mode('dark')
  assert.notEqual(await evalJS('getComputedStyle(document.body).backgroundColor'), lightBackground)
  await browser.screenshot('appearance-dark')
  await c.call('Page.reload')
  await until(async () => (await body()).includes('비밀번호 재설정'), 'reload')
  await mode('dark')
  assert.equal(await evalJS('document.documentElement.dataset.palette'), 'custom')
  assert.equal(await evalJS('getComputedStyle(document.documentElement).getPropertyValue("--primary").trim()'), '#6750a4')
  await fill('email', 'admin'); await fill('password', '1234'); await click('로그인')
  await until(async () => (await body()).includes('개발자 계정'), 're-entry')
  await click('설정')
  await c.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
  await delay(250)
  assert.equal(await evalJS('document.documentElement.scrollWidth <= innerWidth'), true, 'mobile horizontal overflow')
  await browser.screenshot('appearance-mobile')
  assert.equal(browser.errors.length, 0, browser.errors.join('\n'))
  console.log('PASS appearance: light/dark, images, one custom color, reload restoration and narrow layout')
  console.log('Screenshots: ' + artifactFolder)
} catch (error) {
  console.error(await body(), browser.errors)
  await browser.screenshot('appearance-failure').catch(() => {})
  throw error
} finally { await browser.stop() }
