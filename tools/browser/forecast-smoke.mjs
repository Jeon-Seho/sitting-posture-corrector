// Isolated synthetic webcam UI regression with the local exported trained model.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { launchChrome } from './chrome.mjs'
import { until } from './cdp.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const folder = `${root}runs/panoptic/browser-forecast-smoke`
await mkdir(folder, { recursive: true })
const server = spawn(process.execPath, [fileURLToPath(new URL('../../frontend/node_modules/vite/bin/vite.js', import.meta.url)),
  '--host', '127.0.0.1', '--port', '5187', '--strictPort', '--mode', 'browser-smoke'],
  { cwd: `${root}frontend`, stdio: ['ignore', 'pipe', 'pipe'] })
let serverLog = ''; server.stdout.on('data', d => { serverLog += d }); server.stderr.on('data', d => { serverLog += d })
let browser
let checks = 0
const check = (condition, message) => { assert(condition, message); checks++; console.log(`PASS: ${message}`) }
try {
  await until(async () => { if (server.exitCode !== null) throw new Error(serverLog); try { return (await fetch('http://127.0.0.1:5187')).ok } catch { return false } }, 'forecast test server', 30000)
  browser = await launchChrome({ executable: process.env.POSEGOOD_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    port: 9347, profile: `${folder}/profile-${Date.now()}`, artifactFolder: folder })
  const { cdp } = browser
  await cdp.call('Page.navigate', { url: 'http://127.0.0.1:5187/?synthetic=1#forecast' })
  await until(() => cdp.evaluate(`document.body.textContent.includes('실험 기준 등록 (8초)') && !document.body.textContent.includes('학습 모델을 준비하고 있어요')`), 'forecast screen and model')
  const click = text => cdp.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(text)}); if (!b || b.disabled) throw new Error('Disabled/missing button'); b.click(); })()`)
  check(await cdp.evaluate(`window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.snapshot().permissionCalls === 0`), 'entry never requests camera automatically')
  await click('카메라 켜기')
  await until(() => cdp.evaluate(`window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.snapshot().camera.connected`), 'synthetic connection')
  await click('실험 기준 등록 (8초)')
  await cdp.evaluate(`(() => { for (let i=0;i<81;i++) window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.forecastFrame(100); })()`)
  await until(() => cdp.evaluate(`document.querySelector('[aria-label="실시간 예측 실험 결과"]').textContent.includes('기준 근처')`), 'complete 8-second reference')
  check(true, '8-second reference and actual LSTM ready')
  await cdp.evaluate(`(() => { for (let i=0;i<10;i++) window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.forecastFrame(100,.3); window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.forecastFrame(100); })()`)
  await until(() => cdp.evaluate(`document.querySelector('.forecast-metrics').textContent.includes('1회')`), 'short excursion return')
  check(true, 'brief excursion counted after return')
  await cdp.evaluate(`(() => { for (let i=0;i<52;i++) window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.forecastFrame(100,.3); })()`)
  await until(() => cdp.evaluate(`[...document.querySelectorAll('.forecast-result')].every(e => e.textContent.includes('지속된 자세 이탈 후보'))`), 'two persistence results')
  check(true, 'model+rule and rule-only show sustained deviation')
  await cdp.evaluate(`window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.forecastFrame(100,.3,true)`)
  await until(() => cdp.evaluate(`[...document.querySelectorAll('.forecast-result')].every(e => e.textContent.includes('측정 불가'))`), 'poor quality')
  check(true, 'poor quality clears prediction and accumulated duration')
  await cdp.evaluate(`(() => { const original=URL.createObjectURL; URL.createObjectURL = blob => { window.__syntheticForecastExport=blob.text();return original(blob) }; })()`)
  await click('실험 결과 내려받기')
  check(await cdp.evaluate(`(async () => { const p=JSON.parse(await window.__syntheticForecastExport); return p.domain_validated===false && p.predictor==='lstm' && p.readings.some(r=>r.error!==null) && !JSON.stringify(p).includes('worldLandmarks') && !JSON.stringify(p).includes('landmarks'); })()`), 'export has actual prediction diagnostics, no raw landmarks')
  for (const width of [1440, 390]) {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false })
    check(await cdp.evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`), `layout fits ${width}px`)
  }
  await browser.screenshot('forecast-mobile-synthetic')
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await browser.screenshot('forecast-desktop-synthetic')
  await click('카메라 끄기')
  await until(() => cdp.evaluate(`document.querySelector('.forecast-results').textContent.includes('카메라를 켜 주세요')`), 'camera stopped')
  check(true, 'camera stop clears displayed result')
  check(browser.errors.length===0 && browser.requests.length===0, 'no browser errors or service API calls')
  console.log(`PASS: ${checks} forecast browser checks`)
} finally { if (browser) await browser.stop(); server.kill('SIGTERM') }
