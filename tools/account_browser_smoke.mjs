import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { launchChrome } from './browser/chrome.mjs'
import { runAccountScenarios } from './browser/accounts.mjs'

const [base, executable, port, profile, artifactFolder] = process.argv.slice(2)
if (!artifactFolder) throw new Error('Account browser launcher arguments are required')
await mkdir(artifactFolder, { recursive: true })
const browser = await launchChrome({ executable, port: Number(port), profile, artifactFolder })
let checks
try {
  const tag = randomUUID().replaceAll('-', '')
  checks = await runAccountScenarios(browser, base, tag)
  assert.equal(browser.errors.length, 0, browser.errors.join('\n'))
} catch (error) {
  await browser.screenshot('failure').catch(() => {})
  const body = await browser.cdp.evaluate('document.body.innerText').catch(() => null)
  // Never save request traces: account requests contain test passwords and CSRF tokens.
  await writeFile(`${artifactFolder}/failure.json`, JSON.stringify({ body, errors: browser.errors }, null, 2))
  console.error(error.stack)
  process.exitCode = 1
} finally {
  await browser.stop()
}
if (process.exitCode !== 1) console.log(`PASS: account browser checks ${checks}`)
