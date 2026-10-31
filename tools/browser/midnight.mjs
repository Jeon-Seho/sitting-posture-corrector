/** Real Chrome, FE and test API/DB; only camera input and elapsed time are synthetic. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchChrome } from './chrome.mjs'
import { delay, until } from './cdp.mjs'

export async function verifyMidnight(browser, base, { email, password }) {
  const c = browser.cdp
  const e = expression => c.evaluate(expression)
  const snapshot = () => e('window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.snapshot()')
  let socketId, ready, summary, closed
  c.on('Network.webSocketCreated', ({ requestId, url }) => {
    if (new URL(url).pathname === '/api/v2/realtime') socketId = requestId
  })
  c.on('Network.webSocketFrameReceived', ({ requestId, response }) => {
    if (requestId !== socketId || response.opcode !== 1) return
    const message = JSON.parse(response.payloadData)
    if (message.type === 'ready') ready = message
    if (message.summary) summary = message.summary
    if (message.type === 'closed') closed = message
  })
  const click = label => c.invoke(`function(label) {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label && !b.disabled && b.getClientRects().length);
    if (!button) throw Error('Missing enabled button: ' + label);
    button.click();
  }`, label)
  const fill = (name, value) => c.invoke(`function(name, value) {
    const input = [...document.querySelectorAll('input')].find(input => input.name === name);
    if (!input) throw Error('Missing input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }`, name, value)
  const url = new URL(base)
  assert.ok(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname), 'use a loopback browser-smoke Vite server')
  url.searchParams.set('synthetic', '1')
  url.searchParams.set('preview', '1')
  await c.call('Page.navigate', { url: url.href })
  await until(() => e('!!window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__ && !!document.querySelector("input[name=email]")'), 'synthetic browser-smoke entry')
  await fill('email', email)
  await fill('password', password)
  await click('로그인')
  await until(() => e('!!document.querySelector(".shell")'), 'signed-in app')
  const userId = await e('(async () => (await import("/src/features/platform/serverAuth.ts")).getServerAuth()?.userId)()')
  assert.ok(userId, 'authenticated test account')
  const pending = () => c.invoke(`function(userId) {
    return JSON.parse(localStorage.getItem('posegood.account.v3.' + userId + '.pending-results') ?? '[]');
  }`, userId)
  const history = () => c.invoke(`async function(userId) {
    const { fetchServerRecords } = await import('/src/features/storage/serverRecords.ts');
    return fetchServerRecords(userId);
  }`, userId)
  await click('측정하기')
  await click('카메라 켜기')
  await until(async () => (await snapshot()).camera.connected && await e('document.querySelector(".webcam-preview")?.readyState >= 2'), 'synthetic camera preview connected')
  for (let i = 0; i < 100 && !ready; i++) {
    await e('window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.frame(250, "normal")')
    await delay(40)
  }
  assert.ok(ready, 'baseline registration and real S1/WS ready completed')
  const id = ready.session_id
  const startedAt = Date.parse(ready.started_at)
  const previousDay = new Date(startedAt + 9 * 3600_000).toISOString().slice(0, 10)
  const midnight = Date.parse(previousDay + 'T00:00:00+09:00') + 86400_000
  const currentDay = new Date(midnight + 9 * 3600_000).toISOString().slice(0, 10)
  assert.ok(midnight - startedAt > 0 && midnight - startedAt <= 10_000,
    'test API ready.started_at must be within 10 seconds before KST midnight; browser time cannot replace server time')
  await e('window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.frame(0, "normal")')
  for (let i = 0; i < 52; i++) {
    await e('window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.frame(250, "normal")')
    await delay(70)
  }
  await until(() => summary?.total_ms >= 13_000, 'server measurement beyond midnight')
  const camera = await snapshot()
  assert.equal(camera.permissionCalls, 0, 'actual webcam was never requested')
  assert.equal(camera.camera.connected, true, 'camera remains connected across midnight')
  assert.equal(ready.session_id, id, 'daily display partition keeps its source session')
  assert.equal(closed, undefined, 'measurement remains running after midnight')
  assert.ok(summary.valid_ms > 0, 'synthetic coordinates are measurable')
  const checkpoint = await until(async () => (await pending()).find(record => record.id === id && record.days?.length === 2), 'current per-account checkpoint for both dates')
  assert.deepEqual(checkpoint.days.map(day => day.date), [previousDay, currentDay])
  for (const field of ['total', 'valid', 'good']) {
    assert.ok(Math.abs(checkpoint.days.reduce((sum, day) => sum + day[field], 0) - checkpoint[field]) < 1e-5, `daily ${field} conserved`)
  }
  assert.equal(checkpoint.events.length, 0, 'midnight introduces no posture alert')
  await click('측정 종료')
  await until(() => closed, 'real WS closed')
  const record = await until(async () => (await history()).find(record => record.id === id), 'ended record in real R1 history')
  assert.equal(record.id, id)
  assert.equal(record.server.confirmed, true)
  assert.ok(Math.abs(record.total - summary.total_ms / 1000) < 1e-5, 'persisted total matches the server summary')
  assert.equal(record.events.length, 0)
  assert.equal((await snapshot()).camera.connected, false, 'ending stops the synthetic camera')
  await click('오늘')
  await until(() => c.invoke(`function(day) {
    return !!document.querySelector('.history-record') && document.body.innerText.includes(day);
  }`, currentDay), 'today record displayed')
  const current = checkpoint.days.find(day => day.date === currentDay)
  assert.equal(await e('document.querySelector("[data-stat=valid] .records-stat-value").textContent.trim()'), `${Math.round(current.valid)}초`)
  await browser.screenshot('midnight-today')
  await click('기록')
  await until(() => e('!!document.querySelector(".calendar-grid")'), 'calendar')
  await c.invoke(`function(label) {
    const day = [...document.querySelectorAll('[role="gridcell"]')].find(d => d.getAttribute('aria-label')?.startsWith(label));
    if (!day) throw Error('Missing previous date');
    day.click();
  }`, `${Number(previousDay.slice(-2))}일 `)
  await until(() => e('!!document.querySelector(".calendar-day-record .history-record")'), 'previous date record displayed')
  const previous = checkpoint.days.find(day => day.date === previousDay)
  assert.ok((await e('document.querySelector(".day-summary-main").textContent')).startsWith(`${Math.round(previous.valid)}초 측정`))
  await browser.screenshot('midnight-previous-day')
  assert.deepEqual(browser.errors, [])
  console.log('PASS midnight browser: real S1/WS/R1, camera continuity, daily checkpoints and today/calendar UI')
}

async function main() {
  const [base, executable, artifacts] = process.argv.slice(2)
  if (!base || !executable || !artifacts) throw Error('Usage: node tools/browser/midnight.mjs <browser-smoke Vite URL> "<Chrome executable>" "<artifacts directory>"')
  const email = process.env.POSEGOOD_MIDNIGHT_EMAIL
  const password = process.env.POSEGOOD_MIDNIGHT_PASSWORD
  assert.ok(email?.endsWith('@example.invalid') && password, 'set POSEGOOD_MIDNIGHT_EMAIL (@example.invalid test account) and POSEGOOD_MIDNIGHT_PASSWORD')
  const artifactFolder = resolve(artifacts)
  await mkdir(artifactFolder, { recursive: true })
  const profileRoot = join(tmpdir(), 'posegood-midnight-')
  const profile = await mkdtemp(profileRoot)
  assert.ok(profile.startsWith(profileRoot), 'isolated temporary Chrome profile')
  const listener = createServer()
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port
  await new Promise(resolve => listener.close(resolve))
  let browser
  try {
    browser = await launchChrome({ executable, port, profile, artifactFolder })
    await verifyMidnight(browser, base, { email, password })
  } catch (error) {
    await browser?.screenshot('midnight-failure').catch(() => {})
    console.error(await browser?.cdp.evaluate('document.body.innerText').catch(() => 'page unavailable'))
    console.error(await browser?.cdp.evaluate(`JSON.stringify({
      camera: window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__?.snapshot().camera,
      permissionCalls: window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__?.snapshot().permissionCalls,
      requests: window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__?.snapshot().trace.map(({ path, method, status }) => ({ path, method, status })),
    })`).catch(() => 'state unavailable'))
    if (browser?.errors.length) console.error(browser.errors)
    throw error
  } finally {
    try { await browser?.stop() }
    finally { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main()
}
