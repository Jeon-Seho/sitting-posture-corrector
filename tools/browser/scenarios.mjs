import assert from 'node:assert/strict'
import { delay, until } from './cdp.mjs'
import { verifyArchiveDialog, verifyWithdrawalDialog } from './dialogs.mjs'

const BRIDGE = 'window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__'
const visible = `(element) => !!element.getClientRects().length && !element.closest('[hidden]')`
const charMap = {
  '<': '\\u003C',
  '>': '\\u003E',
  '/': '\\u002F',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\0': '\\0',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
}

function escapeUnsafeChars(str) {
  return str.replace(/[<>\/\\\b\f\n\r\t\0\u2028\u2029]/g, (x) => charMap[x])
}

function recordMatchesView(record, view) {
  return (
    JSON.stringify(record.server.view) === JSON.stringify(view) &&
    record.valid === view.summary.valid_ms / 1000 &&
    record.good === view.summary.normal_ms / 1000 &&
    record.total === view.summary.total_ms / 1000 &&
    record.events.length === view.summary.collapse_count
  )
}

function duration(seconds) {
  const rounded = Math.round(seconds)
  if (rounded < 60) return `${rounded}초`
  const minutes = Math.floor(rounded / 60)
  if (minutes < 60) return rounded % 60 ? `${minutes}분 ${rounded % 60}초` : `${minutes}분`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 ? `${hours}시간 ${minutes % 60}분` : `${hours}시간`
}
/** User actions use the rendered application. The bridge supplies only input/time/faults. */

class AppDriver {
  constructor(browser, base) {
    this.browser = browser
    this.cdp = browser.cdp
    this.base = base
    this.checks = 0
  }

  evaluate(expression) {
    return this.cdp.evaluate(expression)
  }

  snapshot() {
    return this.evaluate(`${BRIDGE}.snapshot()`)
  }

  check(description, condition) {
    assert.ok(condition, description)
    this.checks++
    console.log(`PASS: browser ${description}`)
  }

  async click(label) {
    await until(
      () =>
        this.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('button')].filter(${visible});
      const button = buttons.find((item) => item.textContent.trim() === ${JSON.stringify(label)} && !item.disabled);
      if (!button) return false;
      button.click(); return true;
    })()`),
      `enabled visible button ${label}`,
    )
  }

  async checkbox(label) {
    await until(
      () =>
        this.evaluate(`(() => {
      const label = [...document.querySelectorAll('label')].filter(${visible}).find((item) => item.textContent.includes(${escapeUnsafeChars(JSON.stringify(label))}));
      const input = label?.querySelector('input[type=checkbox]');
      if (!input || input.disabled) return false;
      if (!input.checked) input.click(); return true;
    })()`),
      `checkbox ${label}`,
    )
  }

  /** Advanced options live in collapsed <details>; open them like a user would. */
  async openMore() {
    await this.evaluate(`document.querySelectorAll('details.more').forEach((item) => { item.open = true })`)
  }

  async text(text) {
    return until(
      () => this.evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`),
      `visible text ${text}`,
    )
  }

  async settled() {
    return until(async () => {
      const snapshot = await this.snapshot()
      return snapshot.draft?.server?.view && !snapshot.draft.server.pending ? snapshot : null
    }, 'durable server acknowledgement')
  }

  async frame(milliseconds = 1000, kind = 'deviation') {
    const previous = await this.snapshot()
    await this.evaluate(`${BRIDGE}.frame(${milliseconds}, ${JSON.stringify(kind)})`)
    if (milliseconds === 0) return this.snapshot() // The first frame anchors the next real interval.
    return until(async () => {
      const snapshot = await this.snapshot()
      return snapshot.draft?.server?.view?.last_sequence >
        previous.draft.server.view.last_sequence && !snapshot.draft.server.pending
        ? snapshot
        : null
    }, 'accepted synthetic adjacent-frame interval')
  }

  async frames(count, kind = 'deviation', milliseconds = 1000) {
    let last
    for (let i = 0; i < count; i++) last = await this.frame(milliseconds, kind)
    return last
  }

  async startSession() {
    await this.click('측정하기')
    await this.text('카메라를 켜 볼까요?')
    await this.click('카메라 켜기')
    await this.click('편하게 앉아서 기준 등록 시작')
    await this.openMore()
    await this.checkbox('서버 판정 사용')
    await this.click('측정 시작')
    let snapshot = await until(async () => {
      const state = await this.snapshot()
      if (state.draft?.server?.view && !state.draft.server.pending) return state
      const coldFailure =
        state.draft?.server?.pending?.kind === 'create' &&
        state.trace.some((entry) => entry.status === 502) &&
        (await this.evaluate(`document.body.innerText.includes('서버 요청에 실패했습니다 (502)') &&
          document.querySelector('.stage .pill')?.textContent.trim() === '쉬는 중' &&
          [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '같은 서버 요청 다시 시도' && !button.disabled)`))
      return coldFailure ? { coldFailure: state } : null
    }, 'created session or explicit retryable cold-create failure')
    if (snapshot.coldFailure) {
      const failed = snapshot.coldFailure
      const payload = failed.draft.server.pending.body
      const path = `/api/v1/sessions/${failed.draft.id}`
      const previousAttempts = failed.trace.filter((entry) => entry.method === 'PUT')
      assert.ok(
        previousAttempts.every(
          (entry) => entry.path === path && JSON.stringify(entry.body) === JSON.stringify(payload),
        ),
      )
      await this.click('같은 서버 요청 다시 시도')
      snapshot = await this.settled()
      const retries = snapshot.trace.filter((entry) => entry.method === 'PUT')
      this.check(
        'cold create 502 is recovered by one explicit same-UUID/body retry',
        snapshot.draft.id === failed.draft.id &&
          retries.length === previousAttempts.length + 1 &&
          retries.every(
            (entry) =>
              entry.path === path && JSON.stringify(entry.body) === JSON.stringify(payload),
          ) &&
          (await this.evaluate(`document.body.innerText.includes('쉬는 중')`)),
      )
      await this.click('측정 재개')
    }
    this.check(
      'session create uses the fixed 3/2/60 policy',
      JSON.stringify(snapshot.draft.server.view.policy) ===
        JSON.stringify({
          hold_ms: 3000,
          recovery_ms: 2000,
          reminder_ms: 60000,
          threshold: 0.7,
        }),
    )
    await this.frame(0)
    return snapshot.draft.id
  }

  async knownRest() {
    const previous = await this.snapshot()
    await this.evaluate(`${BRIDGE}.advance(500)`)
    return until(async () => {
      const snapshot = await this.snapshot()
      return snapshot.draft.server.view.summary.rest_ms >
        previous.draft.server.view.summary.rest_ms && !snapshot.draft.server.pending
        ? snapshot
        : null
    }, 'known rest heartbeat')
  }

  async reload() {
    await this.cdp.call('Page.reload', { ignoreCache: true })
    await until(
      () =>
        this.evaluate(
          `!!${BRIDGE} && [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '내 프로필로 시작')`,
        ),
      'reload login and explicit synthetic adapter',
    )
    await this.click('내 프로필로 시작')
    await this.click('이어하기')
  }

  async getSession(id) {
    const response = await fetch(`${this.base}/api/v1/sessions/${id}`)
    assert.equal(response.status, 200)
    return response.json()
  }

  async verifyHistory(records) {
    const total = records.reduce((sum, record) => sum + record.valid, 0)
    const good = records.reduce((sum, record) => sum + record.good, 0)
    const alerts = records.reduce(
      (sum, record) => sum + record.events.reduce((n, event) => n + event.alerts, 0),
      0,
    )
    const displayed = await this.evaluate(`(() => {
      const tile = (key) => document.querySelector('main [data-stat="' + key + '"]');
      return {
        rate: tile('rate')?.querySelector('.records-stat-value')?.textContent,
        valid: tile('valid')?.querySelector('.records-stat-value')?.textContent,
        alerts: tile('alerts')?.querySelector('.records-stat-value')?.textContent,
        count: tile('count')?.textContent,
      };
    })()`)
    const rate = total ? `${Math.round((good / total) * 100)}%` : '—'
    this.check(
      'history rate/time/alert/session totals match acknowledged records',
      displayed.rate === rate &&
        displayed.valid === duration(total) &&
        displayed.alerts === `${alerts}회` &&
        displayed.count === `${records.length}`,
    )
    const details = await this.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('button')].filter(${visible}).filter((item) => ['자세히', '닫기'].includes(item.textContent.trim()) && item.classList.contains('history-detail-button'));
      for (const button of buttons) if (button.getAttribute('aria-expanded') !== 'true') button.click();
      return buttons.length;
    })()`)
    assert.equal(details, records.length)
    await this.text('서버가 확인한 사건 이력')
    this.check(
      'record details expose preserved server events and frozen policy',
      await this.evaluate(
        `document.body.innerText.includes('3초') && document.body.innerText.includes('60초')`,
      ),
    )
  }
}

export async function runScenarios(browser, base, restartApi) {
  const app = new AppDriver(browser, base)
  await app.cdp.call('Page.navigate', { url: `${base}/?synthetic=1` })
  await until(
    () => app.evaluate(`!!${BRIDGE} && document.querySelectorAll('button').length > 0`),
    'React bootstrap',
  )
  await browser.screenshot('synthetic-login')
  app.check(
    'page is rendered without a Vite error overlay or JavaScript errors',
    (await app.evaluate(
      `!!document.querySelector('#root').textContent.trim() && !document.querySelector('vite-error-overlay')`,
    )) && browser.errors.length === 0,
  )
  await app.click('내 프로필로 시작')
  await app.text('카메라를 켜 볼까요?')
  app.check(
    'synthetic input is visibly disclosed and camera permissions remain unused',
    (await app.evaluate(`document.body.innerText.includes('명시적 합성 브라우저 검증')`)) &&
      (await app.snapshot()).permissionCalls === 0,
  )
  const firstId = await app.startSession()
  let snapshot = await app.frames(5, 'deviation', 500)
  app.check(
    '2.5 seconds has no confirmed episode',
    snapshot.draft.server.view.summary.collapse_count === 0,
  )
  snapshot = await app.frame(500)
  app.check(
    'first episode confirms at exactly 3 seconds',
    snapshot.draft.server.view.summary.collapse_count === 1 &&
      snapshot.draft.server.view.events[0].timestamp_ms === 3000,
  )
  await app.text('자세를 확인해 주세요')
  snapshot = await app.frames(59)
  app.check(
    'same episode does not remind before 60 seconds',
    snapshot.draft.server.view.summary.alert_count === 1,
  )
  snapshot = await app.frame()
  app.check(
    'same episode reminds at exactly 60 seconds after confirmation',
    snapshot.draft.server.view.summary.alert_count === 2 &&
      snapshot.draft.server.view.events.at(-1).kind === 'reminder' &&
      snapshot.draft.server.view.events.at(-1).timestamp_ms === 63000,
  )
  snapshot = await app.frame(1000, 'normal')
  app.check(
    '1 second normal input does not complete recovery',
    !snapshot.draft.server.view.events.some((event) => event.kind === 'recovery_confirmed'),
  )
  snapshot = await app.frame(1000, 'normal')
  app.check(
    '2 seconds normal input confirms recovery',
    snapshot.draft.server.view.events.at(-1).kind === 'recovery_confirmed' &&
      snapshot.draft.server.view.events.at(-1).timestamp_ms === 65000,
  )
  snapshot = await app.frames(3)
  app.check(
    'new episode gets its first alert after its own 3 seconds',
    snapshot.draft.server.view.summary.collapse_count === 2 &&
      snapshot.draft.server.view.summary.alert_count === 3,
  )
  await app.click('잠시 쉬기')
  const validBeforeRest = snapshot.draft.server.view.summary.valid_ms
  snapshot = await app.knownRest()
  app.check(
    'manual pause interrupts the episode and excludes rest',
    snapshot.draft.server.view.events.at(-1).kind === 'interrupted' &&
      snapshot.draft.server.view.events.at(-1).reason === 'rest' &&
      snapshot.draft.server.view.summary.valid_ms === validBeforeRest,
  )
  await app.click('측정 재개')
  await app.frame(0)
  snapshot = await app.frames(2)
  app.check(
    'resumption starts a new 3-second accumulation',
    snapshot.draft.server.view.summary.collapse_count === 2,
  )
  snapshot = await app.frame()
  app.check(
    'post-rest episode confirms independently',
    snapshot.draft.server.view.summary.collapse_count === 3 &&
      snapshot.draft.server.view.summary.alert_count === 4,
  )
  // Since 2026-10-06 opening another tab keeps the measurement running.
  const restBeforeRecords = snapshot.draft.server.view.summary.rest_ms
  const validBeforeRecords = snapshot.draft.server.view.summary.valid_ms
  await app.click('기록')
  snapshot = await app.frames(2, 'normal')
  app.check(
    'internal navigation keeps measuring without recording rest',
    snapshot.draft.server.view.summary.valid_ms === validBeforeRecords + 2000 &&
      snapshot.draft.server.view.summary.rest_ms === restBeforeRecords,
  )
  await app.click('측정하기')
  app.check(
    'returning to measurement needs no resume',
    await app.evaluate(
      `[...document.querySelectorAll('button')].filter(${visible}).some((b) => b.textContent.trim() === '잠시 쉬기')`,
    ),
  )
  snapshot = await app.frames(2, 'normal')
  const validBeforePoor = snapshot.draft.server.view.summary.valid_ms
  snapshot = await app.frame(500, 'poor')
  app.check(
    'poor measurement is excluded and displayed as unmeasurable',
    snapshot.draft.server.view.summary.valid_ms === validBeforePoor &&
      snapshot.draft.server.view.summary.unknown_ms === 500 &&
      (await app.evaluate(`document.querySelector('.stage .pill').textContent.trim() === '자세를 확인할 수 없어요'`)),
  )
  await app.frame(500, 'normal')
  snapshot = await app.frame(500, 'normal')
  app.check(
    'valid measurement resumes only after both adjacent endpoints are valid',
    snapshot.draft.server.view.summary.valid_ms === validBeforePoor + 500,
  )
  await app.evaluate(`${BRIDGE}.holdNext('end')`)
  await app.click('측정 종료')
  await until(async () => (await app.snapshot()).held?.kind === 'end', 'held real end response')
  snapshot = await app.snapshot()
  const actualEnded = await app.getSession(firstId)
  app.check(
    'end acknowledgement must arrive before a final record is written',
    actualEnded.ended &&
      snapshot.records.length === 0 &&
      snapshot.draft.server.pending.kind === 'end',
  )
  await app.evaluate(`${BRIDGE}.release()`)
  snapshot = await until(async () => {
    const value = await app.snapshot()
    return value.records.length === 1 && !value.draft && !value.camera.connected ? value : null
  }, 'confirmed final record and camera stop')
  app.check(
    'final record equals the real end response and stops input',
    snapshot.records[0].server.confirmed &&
      recordMatchesView(snapshot.records[0], actualEnded) &&
      !snapshot.camera.connected,
  )
  await app.click('기록')
  await app.verifyHistory(snapshot.records)
  await app.click('오늘')
  await app.verifyHistory(snapshot.records)
  await browser.screenshot('confirmed-dashboard')
  const reloadId = await app.startSession()
  await app.frames(2)
  await app.evaluate(`${BRIDGE}.holdNext('features')`)
  await app.evaluate(`${BRIDGE}.frame(1000, 'deviation')`)
  await until(
    async () => (await app.snapshot()).held?.kind === 'features',
    'held accepted feature response',
  )
  const uncertain = (await app.snapshot()).draft.server.pending.body
  const beforeReload = await app.getSession(reloadId)
  assert.equal(beforeReload.last_sequence, uncertain.sequence)
  assert.equal(beforeReload.summary.collapse_count, 1)
  assert.equal(beforeReload.events.at(-1).kind, 'collapse_confirmed')
  await app.reload()
  snapshot = await app.settled()
  const retried = snapshot.trace.find(
    (entry) => entry.method === 'POST' && entry.path.endsWith('/features'),
  )
  app.check(
    'reload retries the exact durable payload without duplicate server statistics',
    JSON.stringify(retried.body) === JSON.stringify(uncertain) &&
      JSON.stringify(snapshot.draft.server.view) === JSON.stringify(beforeReload),
  )
  app.check(
    'reload stays paused without replaying historical notifications',
    (await app.evaluate(`!document.querySelector('.toast')`)) && !snapshot.camera.connected,
  )
  await app.click('측정 종료')
  snapshot = await until(async () => {
    const value = await app.snapshot()
    return value.records.length === 2 && !value.draft ? value : null
  }, 'restored session end acknowledgement')
  app.check(
    'restored session can finish without reopening a camera',
    snapshot.records.find((record) => record.id === reloadId).server.confirmed &&
      snapshot.permissionCalls === 0,
  )
  const lostId = await app.startSession()
  snapshot = await app.frames(3)
  const lastKnown = snapshot.draft.server.view
  await app.click('잠시 쉬기')
  await restartApi(lostId)
  await app.reload()
  await app.text('서버 세션 유실')
  snapshot = await app.snapshot()
  app.check(
    'real API memory loss is a 404 and never recreates the old UUID',
    snapshot.trace.some((entry) => entry.status === 404) &&
      !snapshot.trace.some((entry) => entry.method === 'PUT'),
  )
  await verifyArchiveDialog(app)
  snapshot = await until(async () => {
    const value = await app.snapshot()
    return value.records.length === 3 && !value.draft ? value : null
  }, 'unconfirmed local archive')
  const archive = snapshot.records.find((record) => record.id === lostId)
  app.check(
    'lost session archives only acknowledged facts with an unconfirmed remote end',
    !archive.server.confirmed &&
      !archive.server.view.ended &&
      recordMatchesView(archive, lastKnown) &&
      !snapshot.camera.connected &&
      !snapshot.trace.some((entry) => entry.path.endsWith('/end')),
  )
  await app.click('기록')
  await app.text('서버 종료 미확인')
  await app.verifyHistory(snapshot.records)
  await app.click('오늘')
  await app.verifyHistory(snapshot.records)
  await browser.screenshot('unconfirmed-dashboard')
  await app.evaluate(`document.querySelector('.history-record-details')?.scrollIntoView()`)
  await browser.screenshot('history-details')
  const featureRequests = browser.requests.filter((request) =>
    new URL(request.url).pathname.endsWith('/features'),
  )
  app.check(
    'all real browser feature requests across reloads contain deltas only',
    featureRequests.length > 0 &&
      snapshot.permissionCalls === 0 &&
      featureRequests.every(
        (request) =>
          request.postData &&
          JSON.parse(request.postData).feature_version === 'shoulder-relative-deltas-v1' &&
          !request.postData.match(/landmarks|video|image|participant/i),
      ),
  )
  const originalServerRecords = JSON.stringify(snapshot.records)
  await app.evaluate(`${BRIDGE}.appendLegacyFixture()`)
  await app.cdp.call('Page.reload', { ignoreCache: true })
  await app.click('내 프로필로 시작')
  await app.click('기록')
  await app.click('전체')
  await app.openMore()
  await app.text('비교에 포함된 기록의 조건')
  const comparison = await app.evaluate(
    `document.querySelector('[aria-label="기록 비교 조건"]').innerText`,
  )
  snapshot = await app.snapshot()
  app.check(
    'legacy synthetic record exposes mixed-source and unknown comparison conditions',
    comparison.includes('브라우저 판정') &&
      comparison.includes('서버 판정') &&
      comparison.includes('기록에 없음') &&
      comparison.includes('확인할 수 없음') &&
      comparison.includes('기준 ID가 기록에 없음') &&
      JSON.stringify(snapshot.records.slice(0, 3)) === originalServerRecords,
  )
  app.check(
    'insufficient comparison time stays marked as reference only',
    await app.evaluate(`document.body.innerText.includes('변화는 참고용')`),
  )
  await app.evaluate(`document.querySelector('[aria-label="기록 비교 조건"]').scrollIntoView()`)
  await browser.screenshot('comparison-conditions')
  await verifyWithdrawalDialog(app)
  app.check('browser flow has no runtime or compiler errors', browser.errors.length === 0)
  return app.checks
}

export async function verifyOrdinaryApp(browser, base) {
  const { cdp } = browser
  await cdp.call('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__cameraPermissionCalls = 0; navigator.mediaDevices.getUserMedia = async () => { window.__cameraPermissionCalls++; throw new Error('Unexpected real camera request during ordinary app verification.'); };`,
  })
  await cdp.call('Page.navigate', { url: `${base}/?synthetic=1` })
  await until(
    () =>
      cdp.evaluate(
        `!!document.querySelector('#root')?.textContent.trim() && document.querySelectorAll('button').length > 0`,
      ),
    'ordinary app rendering',
  )
  await browser.screenshot('ordinary-app')
  const ordinary = await cdp.evaluate(
    `({ bridge: !!${BRIDGE}, permissionCalls: window.__cameraPermissionCalls, overlay: !!document.querySelector('vite-error-overlay') })`,
  )
  assert.deepEqual(ordinary, {
    bridge: false,
    permissionCalls: 0,
    overlay: false,
  })
  console.log(
    'PASS: browser ordinary dev query cannot activate synthetic input and requests no camera permission',
  )
  const guarded = await cdp.evaluate(
    `(async () => { try { await import('/src/features/testing/bootstrap.ts'); return false; } catch { return !${BRIDGE}; } })()`,
  )
  assert.ok(guarded)
  console.log('PASS: browser direct testing module import is guarded in ordinary development')
  await delay(50)
}
