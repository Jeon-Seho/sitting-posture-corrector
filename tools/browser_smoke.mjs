import { mkdir, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { launchChrome } from './browser/chrome.mjs'
import { runScenarios, verifyOrdinaryApp } from './browser/scenarios.mjs'
import { verifyCollectionPreview } from './browser/camera-preview.mjs'
const [base, ordinaryBase, executable, port, profile, artifactFolder] = process.argv.slice(2)
if (!artifactFolder) throw new Error('browser_smoke.mjs requires the launcher arguments.')
await mkdir(artifactFolder, { recursive: true })
const replies = createInterface({ input: process.stdin })
const control = (sessionId) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('API restart control timeout.')), 35_000)
  const onLine = (line) => {
    if (line !== 'api-restarted') return
    clearTimeout(timeout)
    replies.off('line', onLine)
    resolve()
  }
  replies.on('line', onLine)
  console.log(`CONTROL restart-api ${sessionId}`)
})
const browser = await launchChrome({
  executable,
  port: Number(port),
  profile,
  artifactFolder
})
const deadline = setTimeout(
  () => {
    console.error('FAIL: browser regression exceeded 180 seconds.')
    process.exit(1)
  },
  180_000
)
try {
  const previewCount = await verifyCollectionPreview(browser, base)
  const count = await runScenarios(browser, base, control)
  await verifyOrdinaryApp(browser, ordinaryBase)
  if (browser.errors.length) throw new Error(`Browser console errors: ${browser.errors.join('\n')}`)
  console.log(`PASS: ${count + previewCount + 2} browser regression checks; real React/API/inference/CEP, explicit synthetic input only`)
} catch (error) {
  await browser.screenshot('failure').catch(() => { })
  const diagnostic = await browser.cdp.evaluate(`({ body: document.body.innerText, state: window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__?.snapshot() })`).catch(() => null)
  await writeFile(`${artifactFolder}/failure.json`, JSON.stringify({
    diagnostic,
    errors: browser.errors
  }, null, 2))
  console.error(error.stack)
  process.exitCode = 1
} finally {
  clearTimeout(deadline)
  replies.close()
  await browser.stop()
}
