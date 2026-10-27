import assert from 'node:assert/strict'
import { delay, until } from './cdp.mjs'

/** Fresh isolated synthetic profile only: exercise real registration, measurement and storage across KST midnight. */
export async function verifyMidnight(browser, base) {
  const e = expression => browser.cdp.evaluate(expression)
  const click = label => e(`(() => {
    const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled);
    if (!b) throw new Error('Missing button: ' + ${JSON.stringify(label)}); b.click();
  })()`)
  await browser.cdp.call('Page.navigate', { url: `${base}/?synthetic=1&preview=1` })
  await until(() => e(`!!window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__`), 'explicit synthetic input', 30_000)
  await e(`localStorage.clear(); localStorage.setItem('posegood.synthetic-browser-clock', JSON.stringify({ epoch: Date.parse('2026-10-26T23:59:50+09:00'), elapsed: 0 }))`)
  const previousOrigin = await e('performance.timeOrigin')
  await browser.cdp.call('Page.reload')
  await until(() => e(`performance.timeOrigin !== ${previousOrigin} && !![...document.querySelectorAll('button')].find(b => b.textContent.trim() === '로그인')`), 'midnight fixture login')
  await click('로그인')
  await until(() => e(`!!document.querySelector('.shell')`), 'signed-in measurement screen')
  await click('카메라 켜기')
  await until(() => e(`window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.snapshot().camera.connected && document.querySelector('.webcam-preview')?.readyState >= 2`), 'synthetic midnight camera')
  for (let i = 0; i < 32; i++) {
    await e(`window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.frame(250, 'normal')`)
    await delay(80)
    if (await e(`!![...document.querySelectorAll('button')].find(b => b.textContent.trim() === '측정 종료')`)) break
  }
  assert.equal(await e(`!![...document.querySelectorAll('button')].find(b => b.textContent.trim() === '측정 종료')`), true, 'automatic registration starts measurement before midnight')
  for (let i = 0; i < 52; i++) {
    await e(`window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.frame(250, 'normal')`)
    await delay(70)
  }
  const before = await e(`window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.snapshot()`)
  assert.equal(before.permissionCalls, 0)
  assert.equal(before.camera.connected, true)
  assert.deepEqual(before.draft.days.map(d => d.date), ['2026-10-26', '2026-10-27'])
  const id = before.draft.id
  await click('측정 종료')
  const saved = await until(() => e(`window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.snapshot().records[0]`), 'midnight record saved')
  assert.equal(saved.id, id, 'midnight keeps one continuous source session')
  assert.deepEqual(saved.days.map(d => d.date), ['2026-10-26', '2026-10-27'])
  for (const field of ['total', 'valid', 'good']) assert.ok(Math.abs(saved.days.reduce((n, d) => n + d[field], 0) - saved[field]) < 1e-5, `daily ${field} conserved`)
  assert.equal(saved.events.length, 0, 'midnight does not introduce a posture alert')
  await click('오늘')
  await until(() => e(`!!document.querySelector('.history-record')`), 'new-day record displayed')
  assert.equal(await e(`document.body.innerText.includes('2026-10-27')`), true)
  await browser.screenshot('forest-midnight-record')
  await click('기록')
  await until(() => e(`!!document.querySelector('.calendar-grid')`), 'calendar grid')
  await e(`(() => { const day = [...document.querySelectorAll('[role="gridcell"]')].find(d => d.getAttribute('aria-label')?.startsWith('26일 ')); if (!day) throw new Error('Previous date not in calendar'); day.click() })()`)
  await until(() => e(`!!document.querySelector('.calendar-day-record .history-record')`), 'previous-day portion displayed')
  await browser.screenshot('forest-midnight-previous-day')
  console.log('PASS: browser KST midnight keeps capture and session, persists both dates, conserves counters, and displays both date portions')
  await e('localStorage.clear()')
  return 8
}
