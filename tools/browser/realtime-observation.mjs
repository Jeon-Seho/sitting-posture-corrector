/**
 * Real-time observation 4.0 run: real Chrome, FE, API, inference and DB; only the camera is synthetic.
 * Frames are paced in real time; the server judges and sends each interval as it arrives (plan 0084 1단계).
 * Writes the WS timeline, screen samples and a criteria report; creates one example.invalid account.
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchChrome } from './chrome.mjs'
import { delay, until } from './cdp.mjs'

const TICK_MS = 250
const PASSWORD = 'Synthetic-test-1234!'
const ALTERNATE = Array.from({ length: 15 }, (_, i) => (i % 2 ? 'deviation' : 'normal'))
/** normal → deviation → recovery → unmeasurable → normal → alternating boundary. */
export const PHASES = [
  { name: 'normal', seconds: 15, kinds: ['normal'] },
  { name: 'deviation', seconds: 15, kinds: ['deviation'] },
  { name: 'recovery', seconds: 15, kinds: ['normal'] },
  { name: 'poor', seconds: 5, kinds: ['poor'] },
  { name: 'normal-again', seconds: 5, kinds: ['normal'] },
  { name: 'alternate', seconds: 15, kinds: ALTERNATE },
]

/**
 * A custom run instead of PHASES, e.g. POSEGOOD_REALTIME_PHASES="normal:3,deviation:3,normal:1.5":
 * synthetic kind and seconds per step (multiples of 0.25 s). Steps get numbered names (1-normal …).
 */
export function customPhases(spec) {
  if (!spec) return null
  return spec.split(',').map((part, i) => {
    const [kind, seconds] = part.trim().split(':')
    assert.ok(['normal', 'deviation', 'poor', 'absent'].includes(kind), `unknown kind: ${kind}`)
    assert.ok(Number(seconds) > 0 && (Number(seconds) * 1000) % TICK_MS === 0, `seconds must be a multiple of ${TICK_MS / 1000}: ${part}`)
    return { name: `${i + 1}-${kind}`, seconds: Number(seconds), kinds: [kind] }
  })
}

// Counts alert chimes; headless audio may stay blocked, so toasts and WS alerts are checked too.
const SOUND_PROBE = `(() => {
  const proto = window.BaseAudioContext?.prototype
  if (!proto) return
  const create = proto.createOscillator
  proto.createOscillator = function () { window.__realtimeObservationSounds = (window.__realtimeObservationSounds ?? 0) + 1; return create.call(this) }
})()`

const SAMPLE = `function() {
  const pill = document.querySelector('.stage-top .pill:not(.small)');
  return {
    title: document.querySelector('.page-title')?.textContent.trim() ?? null,
    tone: pill ? [...pill.classList].find(c => c !== 'pill') ?? null : null,
    alertStage: !!document.querySelector('.stage.is-alert'),
    nudge: document.querySelector('.nudge-title')?.textContent.trim() ?? null,
    toast: !!document.querySelector('.toast'),
    gauge: document.querySelector('.nudge .meter > span')?.style.width ?? null,
    sounds: window.__realtimeObservationSounds ?? 0,
  };
}`

export async function runRealtimeObservation(browser, base, phases = PHASES) {
  const c = browser.cdp
  const e = expression => c.evaluate(expression)
  const t0 = Date.now()
  const now = () => Date.now() - t0
  const messages = []
  const samples = []
  let socketId, phase = 'setup'
  c.on('Network.webSocketCreated', ({ requestId, url }) => {
    if (new URL(url).pathname === '/api/v2/realtime') socketId = requestId
  })
  c.on('Network.webSocketFrameReceived', ({ requestId, response }) => {
    if (requestId !== socketId || response.opcode !== 1) return
    messages.push({ t: now(), phase, ...JSON.parse(response.payloadData) })
  })
  const find = type => messages.find(m => m.type === type)
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
  await c.call('Page.addScriptToEvaluateOnNewDocument', { source: SOUND_PROBE })
  await c.call('Page.navigate', { url: url.href })
  await until(() => e('!!window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__ && !!document.querySelector("input[name=email]")'), 'synthetic browser-smoke entry')
  const email = await c.invoke(`async function(password) {
    const { createAccountClient } = await import('/src/features/auth/accountClient.ts');
    const { allAgreed, consentPayload } = await import('/src/features/auth/consents.ts');
    const client = createAccountClient({ channel: false });
    const email = 'realtime-observation-' + crypto.randomUUID() + '@example.invalid';
    await client.register({ email, password, profile: { name: '합성 3초 묶음' }, consents: consentPayload(allAgreed()) });
    await client.logout();
    return email;
  }`, PASSWORD)
  await fill('email', email)
  await fill('password', PASSWORD)
  await click('로그인')
  await until(() => e('!!document.querySelector(".shell")'), 'signed-in app')
  const userId = await e('(async () => (await import("/src/features/platform/serverAuth.ts")).getServerAuth()?.userId)()')
  assert.ok(userId, 'authenticated test account')

  await click('측정하기')
  await click('카메라 켜기')
  await until(async () => (await e('window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.snapshot()')).camera.connected
    && await e('document.querySelector(".webcam-preview")?.readyState >= 2'), 'synthetic camera preview connected')
  // Baseline registration (3 s average → B1) and S1/WS ready; the synthetic clock may run fast here.
  for (let i = 0; i < 120 && !find('ready'); i++) {
    await e('window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.frame(250, "normal")')
    await delay(40)
  }
  const ready = find('ready')
  assert.ok(ready, 'baseline registration and real S1/WS ready completed')
  const setupErrors = browser.errors.length

  const phaseStarts = {}
  let tick = 0
  const startedAt = Date.now()
  for (const step of phases) {
    phase = step.name
    phaseStarts[step.name] = now()
    const ticks = step.seconds * 1000 / TICK_MS
    for (let i = 0; i < ticks; i++, tick++) {
      const kind = step.kinds[Math.floor(i * TICK_MS / 1000) % step.kinds.length]
      await c.invoke('function(kind) { window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.frame(250, kind) }', kind)
      samples.push({ t: now(), phase, kind, ...await c.invoke(SAMPLE) })
      await delay(Math.max(0, startedAt + (tick + 1) * TICK_MS - Date.now()))
    }
  }
  phase = 'ending'
  phaseStarts.ending = now()
  await click('측정 종료')
  await until(() => find('closed'), 'real WS closed', 20_000)
  const record = await until(() => c.invoke(`async function(userId, id) {
    const { fetchServerRecords } = await import('/src/features/storage/serverRecords.ts');
    return (await fetchServerRecords(userId)).find(record => record.id === id) ?? null;
  }`, userId, ready.session_id), 'ended record in real R1 history')
  await browser.screenshot('realtime-observation-ended')
  // The next measurement is blocked until R1 clears this device's pending result (sync every 15 s).
  const pendingCleared = await until(() => c.invoke(`function(userId) {
    return (localStorage.getItem('posegood.account.v3.' + userId + '.pending-results') ?? '[]') === '[]';
  }`, userId), 'pending result cleared by R1', 20_000).catch(() => false)
  // Login/camera start errors are kept apart: this run checks the measurement, not sign-in.
  return {
    email, ready, phaseStarts, messages, samples, record, pendingCleared,
    setupErrors: browser.errors.slice(0, setupErrors), errors: browser.errors.slice(setupErrors),
  }
}

/** Criteria and delay numbers, computed from the timeline only. */
export function report({ ready, phaseStarts, messages, samples, record, pendingCleared, setupErrors, errors }) {
  const of = (type, phase) => messages.filter(m => m.type === type && (!phase || m.phase === phase))
  const firstAfter = (list, t) => list.find(m => m.t >= t)
  const observations = of('observation')
  const gaps = observations.slice(1).map((m, i) => m.t - observations[i].t)
  const decisions = of('decision').map(m => ({ t: m.t, phase: m.phase, kind: m.event?.kind }))
  const deviationAt = phaseStarts.deviation
  const recoveryAt = phaseStarts.recovery
  const firstBad = observations.find(m => m.t >= deviationAt && m.observation?.posture === 'bad')
  const confirmed = decisions.find(d => d.t >= deviationAt && d.kind === 'collapse_confirmed')
  // The observation sent right before the confirming decision is for the same interval.
  const confirmedHold = confirmed ? observations.findLast(m => m.t <= confirmed.t) : null
  const recovered = decisions.find(d => d.t >= recoveryAt && d.kind === 'recovery_confirmed')
  const deviationSamples = samples.filter(s => s.phase === 'deviation')
  const firstCaution = deviationSamples.find(s => s.tone === 'caution')
  const firstCollapse = deviationSamples.find(s => s.tone === 'collapse')
  const cautionQuiet = samples.filter(s => s.tone === 'caution').every(s => !s.alertStage && !s.toast)
  const firstObservation = firstAfter(observations, 0)
  const toneChanges = samples.filter(s => s.phase === 'alternate').filter((s, i, list) => i && s.tone !== list[i - 1].tone).length
  const poorStart = phaseStarts.poor
  const poorUnknown = samples.find(s => s.phase === 'poor' && s.title === '자세를 확인할 수 없어요')
  const closed = firstAfter(of('closed'), phaseStarts.ending)
  const byPhase = Object.fromEntries(Object.keys(phaseStarts).map(name => {
    const list = observations.filter(m => m.phase === name).map(m => m.observation)
    const probabilities = list.filter(o => o?.valid).map(o => o.collapse_probability)
    return [name, {
      observations: list.length,
      posture: list.reduce((count, o) => ({ ...count, [o?.posture ?? 'null']: (count[o?.posture ?? 'null'] ?? 0) + 1 }), {}),
      collapse_probability: probabilities.length ? [Math.min(...probabilities), Math.max(...probabilities)] : null,
      invalid_reasons: [...new Set(list.filter(o => !o?.valid).map(o => o?.invalid_reason))],
    }]
  }))
  const checks = {
    // No server batch: one result per interval, so the score moves several times a second.
    'score updates per interval (median gap under 250 ms)': gaps.length > 5 && median(gaps) < 250,
    'observation 4.0 shape (sequence, posture, hold_ms)': observations.length > 0 && observations.every(m =>
      Number.isInteger(m.observation?.sequence) && 'posture' in m.observation && Number.isFinite(m.observation?.hold_ms)),
    'not-judgeable results carry no score': observations.filter(m => m.observation?.valid === false).every(m => m.observation.collapse_probability === null),
    'sequences only go up': observations.every((m, i) => !i || m.observation.sequence > observations[i - 1].observation.sequence),
    'hold_ms reaches the policy hold time when the collapse is confirmed': !!confirmedHold && confirmedHold.observation.hold_ms >= 3000,
    'deviation produces posture bad': !!firstBad,
    'caution shown before collapse': !!firstCaution && (!firstCollapse || firstCaution.t <= firstCollapse.t),
    'caution has no alert stage or toast': cautionQuiet,
    'collapse confirmed then recovery confirmed': !!confirmed && !!recovered,
    'unmeasurable shown within 0.5 s': !!poorUnknown && poorUnknown.t - poorStart <= 500,
    'closed received': !!closed,
    // R1 carries the server's own model_version; the app only stops writing one itself.
    'R1 record confirmed with the server summary': !!record && record.server?.confirmed === true
      && record.server.view?.summary?.total_ms > 0 && Math.abs(record.total - record.server.view.summary.total_ms / 1000) < 1e-5,
    'pending result cleared so the next measurement can start': pendingCleared,
    'no browser errors while measuring': errors.length === 0,
  }
  return {
    server: { session_id: ready.session_id, started_at: ready.started_at },
    checks,
    numbers: {
      first_observation_ms: firstObservation ? firstObservation.t - (of('ready')[0]?.t ?? 0) : null,
      observation_gap_ms: gaps.length ? { median: median(gaps), max: Math.max(...gaps) } : null,
      deviation_to_bad_ms: firstBad ? firstBad.t - deviationAt : null,
      deviation_to_caution_screen_ms: firstCaution ? firstCaution.t - deviationAt : null,
      deviation_to_confirmed_ms: confirmed ? confirmed.t - deviationAt : null,
      bad_to_confirmed_ms: firstBad && confirmed ? confirmed.t - firstBad.t : null,
      recovery_to_confirmed_ms: recovered ? recovered.t - recoveryAt : null,
      end_to_closed_ms: closed ? closed.t - phaseStarts.ending : null,
      stalled: of('stalled').length,
      head_turn: observations.filter(m => m.observation?.invalid_reason === 'head_turn').length,
      alternate_tone_changes: toneChanges,
      alerts: of('alert').length,
      sounds: samples.at(-1)?.sounds ?? 0,
      r1_model_version: record?.server?.modelVersion ?? null,
      setup_errors: setupErrors.length,
    },
    by_phase: byPhase,
    decisions,
  }
}

/** Per step of a custom run: what the server sent and what the screen showed, times from the step start. */
export function stepReport({ phaseStarts, messages, samples, setupErrors, errors, record, pendingCleared }) {
  const names = Object.keys(phaseStarts).filter(name => name !== 'ending')
  const observations = messages.filter(m => m.type === 'observation')
  const gaps = observations.slice(1).map((m, i) => m.t - observations[i].t)
  const steps = names.map((name, i) => {
    const start = phaseStarts[name]
    const end = phaseStarts[names[i + 1]] ?? phaseStarts.ending
    const inStep = list => list.filter(m => m.t >= start && m.t < end)
    const obs = inStep(observations).map(m => m.observation)
    const shown = inStep(samples)
    return {
      step: name,
      observations: obs.length,
      posture: obs.reduce((count, o) => ({ ...count, [o?.posture ?? 'null']: (count[o?.posture ?? 'null'] ?? 0) + 1 }), {}),
      hold_ms_max: obs.length ? Math.max(...obs.map(o => o?.hold_ms ?? 0)) : null,
      recovery_ms_max: obs.length ? Math.max(...obs.map(o => o?.recovery_ms ?? 0)) : null,
      boxes: [...new Set(shown.map(s => s.nudge).filter(Boolean))],
      decisions: inStep(messages.filter(m => m.type === 'decision')).map(m => `${m.event?.kind} +${m.t - start}ms`),
      alerts: inStep(messages.filter(m => m.type === 'alert')).length,
      screen_tones: [...new Set(shown.map(s => s.tone))],
      gauge_max: shown.reduce((max, s) => Math.max(max, parseFloat(s.gauge ?? '0') || 0), 0) + '%',
      alert_stage: shown.some(s => s.alertStage),
    }
  })
  return {
    steps,
    checks: {
      'observation 4.0 shape (sequence, posture, hold_ms, recovery_ms)': observations.length > 0 && observations.every(m =>
        Number.isInteger(m.observation?.sequence) && 'posture' in m.observation && Number.isFinite(m.observation?.hold_ms)
        && Number.isFinite(m.observation?.recovery_ms)),
      'sequences only go up': observations.every((m, i) => !i || m.observation.sequence > observations[i - 1].observation.sequence),
      'score updates per interval (median gap under 250 ms)': gaps.length > 5 && median(gaps) < 300,
      'R1 record confirmed with the server summary': !!record && record.server?.confirmed === true,
      'pending result cleared so the next measurement can start': pendingCleared,
      'no browser errors while measuring': errors.length === 0,
    },
    numbers: { observation_gap_ms: gaps.length ? { median: median(gaps), max: Math.max(...gaps) } : null, setup_errors: setupErrors.length },
  }
}

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

async function main() {
  const [base, executable, artifacts = '.cache/browser-realtime-observation'] = process.argv.slice(2)
  if (!base || !executable) throw Error('Usage: node tools/browser/realtime-observation.mjs <browser-smoke Vite URL> "<Chrome executable>" [artifacts directory]')
  const artifactFolder = resolve(artifacts)
  await mkdir(artifactFolder, { recursive: true })
  const profileRoot = join(tmpdir(), 'posegood-realtime-observation-')
  const profile = await mkdtemp(profileRoot)
  const listener = createServer()
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port
  await new Promise(resolve => listener.close(resolve))
  let browser
  try {
    browser = await launchChrome({ executable, port, profile, artifactFolder })
    const custom = customPhases(process.env.POSEGOOD_REALTIME_PHASES)
    const run = await runRealtimeObservation(browser, base, custom ?? PHASES)
    const result = custom ? stepReport(run) : report(run)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await writeFile(join(artifactFolder, `run-${stamp}.json`), JSON.stringify({ ...run, report: result }, null, 2))
    console.log(JSON.stringify(result, null, 2))
    const failed = Object.entries(result.checks).filter(([, ok]) => !ok).map(([name]) => name)
    console.log(failed.length ? `FAIL ${failed.length}: ${failed.join(' / ')}` : 'PASS realtime observation: all criteria')
    process.exitCode = failed.length ? 1 : 0
  } catch (error) {
    await browser?.screenshot('realtime-observation-failure').catch(() => {})
    console.error(await browser?.cdp.evaluate('document.body.innerText').catch(() => 'page unavailable'))
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
