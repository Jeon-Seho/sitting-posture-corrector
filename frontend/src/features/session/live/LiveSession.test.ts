import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Landmark } from '../../../../../model/prototype/pose'
import { setServerAuth } from '../../platform/serverAuth'
import { LiveSession, type LiveState, type SocketLike } from './LiveSession'
import { EMPTY_SUMMARY } from './messages'

/** Synthetic server only: a stubbed fetch for S1·S4 and an in-memory socket. */
const SESSION = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90'
const BASELINE = '9b1c0e0a-2c4d-4f6a-8e1b-5a7c9d2e4f60'
const POLICY = { hold_ms: 3000, recovery_ms: 3000, reminder_ms: 60000, threshold: 0.7 }
const view = (patch: Record<string, unknown> = {}) => ({
  schema_version: '1.0',
  session_id: SESSION,
  policy: POLICY,
  timer_policy: 'legacy-interrupt-v1',
  ended: false,
  last_sequence: -1,
  summary: EMPTY_SUMMARY,
  events: [],
  ...patch,
})
const reply = (status: number, body: unknown = {}) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response
const points: Landmark[] = Array.from({ length: 33 }, (_, i) => ({ x: 0.5, y: i === 0 ? 0.25 : 0.5, z: 0, visibility: 0.95 }))

class FakeSocket implements SocketLike {
  readyState = 0
  sent: Record<string, unknown>[] = []
  onopen: SocketLike['onopen'] = null
  onmessage: SocketLike['onmessage'] = null
  onclose: SocketLike['onclose'] = null
  onerror: SocketLike['onerror'] = null
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    this.readyState = 3
  }
  open() {
    this.readyState = 1
    this.onopen?.({})
  }
  push(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
  drop() {
    this.readyState = 3
    this.onclose?.({})
  }
  features() {
    return this.sent.filter((m) => m.type === 'features').map((m) => (m.items as Record<string, unknown>[])[0])
  }
}

describe('server measurement over /v2/realtime (synthetic server only)', () => {
  let now = 0
  let fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>
  let socket: FakeSocket
  let states: LiveState[]
  let ended: LiveState[]
  let alerts: string[]
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }
  const make = () =>
    new LiveSession({
      sessionId: SESSION,
      policy: POLICY,
      baselineId: BASELINE,
      now: () => now,
      api: { fetch, retryDelayMs: 0 },
      openSocket: (url) => (socket = new FakeSocket(url)),
      onChange: (state) => states.push(state),
      onEnded: (state) => ended.push(state),
      onAlert: (kind) => alerts.push(kind),
    })
  /** S1 answered, socket open, `hello` sent; `ready` not yet. */
  const started = async () => {
    const live = make()
    await live.start()
    await flush()
    socket.open()
    return live
  }

  beforeEach(() => {
    vi.useFakeTimers()
    now = 1000
    states = []
    ended = []
    alerts = []
    fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(reply(200, view()))
    vi.stubGlobal('location', { protocol: 'https:', host: 'app.example.test' })
    setServerAuth({ userId: '7', csrfToken: async () => 'csrf' })
  })
  afterEach(() => {
    setServerAuth(null)
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('creates the session with S1, says hello and sends nothing before ready', async () => {
    await started()
    const [url, request] = fetch.mock.calls[0]
    const init = request!
    expect(url).toBe(`/api/v2/sessions/${SESSION}`)
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toEqual({ policy: POLICY, baseline_id: BASELINE })
    expect(init.headers).toMatchObject({ 'X-CSRF-TOKEN': 'csrf', 'X-PoseGood-User-Id': '7' })
    expect(socket.url).toBe('wss://app.example.test/api/v2/realtime')
    expect(socket.sent).toEqual([{ type: 'hello', schema_version: '2.0', purpose: 'measure', session_id: SESSION }])
  })

  it('sends S1 again with the same id and body when no answer came back', async () => {
    fetch.mockRejectedValueOnce(new TypeError('offline'))
    const live = make()
    const starting = live.start()
    await vi.advanceTimersByTimeAsync(100)
    await starting
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1][0]).toBe(fetch.mock.calls[0][0])
    expect(fetch.mock.calls[1][1]!.body).toBe(fetch.mock.calls[0][1]!.body)
    expect(live.state.phase).toBe('connecting')
  })

  it('does not connect when the measurement was ended while S1 was on its way', async () => {
    let answer: (value: Response) => void = () => {}
    fetch.mockReturnValueOnce(new Promise<Response>((resolve) => (answer = resolve)))
    const opened = vi.fn()
    const live = new LiveSession({
      sessionId: SESSION,
      policy: POLICY,
      baselineId: BASELINE,
      now: () => now,
      api: { fetch, retryDelayMs: 0 },
      openSocket: (url) => {
        opened()
        return new FakeSocket(url)
      },
      onChange: (state) => states.push(state),
      onEnded: (state) => ended.push(state),
    })
    const starting = live.start()
    live.end()
    answer(reply(200, view()))
    await starting
    expect(opened).not.toHaveBeenCalled()
    expect(live.state.phase).toBe('ended')
    expect(ended).toHaveLength(1)
  })

  it('sends one 0.5 s interval per message, those made before ready first and in order', async () => {
    const live = await started()
    for (let t = 0; t < 1200; t += 100) live.ingest(now + t, points, true)
    now += 1200
    live.tick()
    expect(socket.features()).toHaveLength(0)
    socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
    expect(live.state.phase).toBe('running')
    const sent = socket.features()
    expect(sent.map((b) => b.sequence)).toEqual([0, 1])
    expect(sent[0]).toMatchObject({
      schema_version: '3.0',
      feature_version: 'keypoints-9-v1',
      start_ms: 0,
      end_ms: 500,
      phase: 'running',
    })
    expect((sent[0].frames as unknown[]).length).toBe(5)
    expect(socket.sent.filter((m) => m.type === 'features').every((m) => (m.items as unknown[]).length === 1)).toBe(true)
  })

  it('marks frames the app cannot place and sends rest without frames while paused', async () => {
    const live = await started()
    socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
    live.ingest(now + 100, points, false)
    now += 300
    live.pause()
    expect(live.state.phase).toBe('paused')
    now += 600
    live.tick()
    live.resume()
    const [first, rest] = socket.features()
    expect(first).toMatchObject({ phase: 'running', end_ms: 300 })
    expect((first.frames as Record<string, unknown>[])[0].valid).toBe(false)
    expect(rest).toMatchObject({ phase: 'rest', start_ms: 300, end_ms: 800, frames: [] })
    expect(live.state.phase).toBe('running')
  })

  it('switches a rest to away when the camera stops (ABSENCE before PAUSE, DB V2.3)', async () => {
    const live = await started()
    socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
    live.pause()
    now += 400
    live.away()
    now += 500
    live.tick()
    const [rest, away] = socket.features()
    expect(rest).toMatchObject({ phase: 'rest', start_ms: 0, end_ms: 400 })
    expect(away).toMatchObject({ phase: 'away', start_ms: 400, end_ms: 900 })
    expect(live.state).toMatchObject({ phase: 'paused', sending: 'away' })
  })

  it('shows only what the server sent: observation, summary, confirmed alert and recovery', async () => {
    const live = await started()
    socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
    socket.push({
      type: 'observation',
      observation: {
        schema_version: '3.0', sequence: 0, start_ms: 0, end_ms: 500, phase: 'running', valid: true, valid_ms: 500,
        collapse_probability: 0.82, deviation_type: 'forward_slouch', invalid_reason: null, model_version: 'm',
      },
    })
    const summary = { ...EMPTY_SUMMARY, total_ms: 500, valid_ms: 500, deviation_ms: 500, collapse_count: 1, alert_count: 1, keep_rate: 0, events_per_hour: 7200 }
    const decision = { event_id: 1, kind: 'collapse_confirmed', timestamp_ms: 500, onset_ms: 0, onset_valid_ms: 0, deviation_type: 'forward_slouch', reason: null }
    socket.push({ type: 'decision', event: decision, summary })
    socket.push({ type: 'alert', event_id: 1, kind: 'collapse_confirmed', deviation_type: 'forward_slouch' })
    socket.push({ type: 'progress', last_sequence: 0, summary, paused_reason: null })
    expect(live.state.observation?.collapse_probability).toBe(0.82)
    expect(live.state.alerting).toBe(true)
    expect(live.state.lastSequence).toBe(0)
    expect(alerts).toEqual(['collapse_confirmed'])
    socket.push({ type: 'decision', event: { ...decision, event_id: 2, kind: 'recovery_confirmed' }, summary })
    expect(live.state.alerting).toBe(false)
    socket.push({ type: 'stalled', since_last_sequence: 0 })
    expect(live.state.stalled).toBe(true)
    socket.push({ type: 'something_new', x: 1 })
    expect(live.state.phase).toBe('running')
  })

  it('ends with end_ms and closed(ended), once', async () => {
    const live = await started()
    socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
    now += 1300
    live.end()
    expect(live.state.phase).toBe('ending')
    expect(socket.sent.at(-1)).toEqual({ type: 'end', end_ms: 1300 })
    expect(socket.features().at(-1)).toMatchObject({ start_ms: 1000, end_ms: 1300 })
    socket.push({ type: 'closed', reason: 'ended' })
    expect(live.state.phase).toBe('ended')
    expect(ended).toHaveLength(1)
    live.end()
    expect(ended).toHaveLength(1)
  })

  it('keeps the server start and end times from ready and closed (ADR 0029, BE-6)', async () => {
    const live = await started()
    socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION, started_at: '2026-10-26T01:00:00.000Z' })
    expect(live.state.startedAt).toBe('2026-10-26T01:00:00.000Z')
    live.end()
    socket.push({ type: 'closed', reason: 'ended', ended_at: '2026-10-26T01:30:00.000Z' })
    expect(live.state.endedAt).toBe('2026-10-26T01:30:00.000Z')
    expect(ended[0].endedAt).toBe('2026-10-26T01:30:00.000Z')
  })

  it('leaves the times empty when the server does not send them yet', async () => {
    const live = await started()
    socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION, started_at: 12 })
    expect(live.state.startedAt).toBeNull()
    live.end()
    socket.push({ type: 'closed', reason: 'ended' })
    expect(live.state.endedAt).toBeNull()
  })

  it('reads the saved result with S4 when closed does not come within 10 s', async () => {
    const live = await started()
    socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
    const saved = { ...EMPTY_SUMMARY, total_ms: 900, valid_ms: 900, normal_ms: 900, keep_rate: 1, events_per_hour: 0 }
    fetch.mockResolvedValueOnce(reply(200, view({ ended: true, last_sequence: 1, summary: saved })))
    live.end()
    await vi.advanceTimersByTimeAsync(10_000)
    await flush()
    expect(fetch.mock.calls[1][0]).toBe(`/api/v2/sessions/${SESSION}`)
    expect(live.state).toMatchObject({ phase: 'ended', lastSequence: 1 })
    expect(live.state.summary.total_ms).toBe(900)
  })

  it('reads S4 once, right away, when the socket closes while ending', async () => {
    const live = await started()
    socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
    fetch.mockResolvedValueOnce(reply(200, view({ ended: true, last_sequence: 0 })))
    live.end()
    socket.drop()
    await flush()
    expect(live.state).toMatchObject({ phase: 'ended', lastSequence: 0 })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('treats a dropped connection as the end; the server keeps what it received', async () => {
    const live = await started()
    socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
    socket.drop()
    expect(live.state).toMatchObject({ phase: 'ended', lost: true })
    expect(ended).toHaveLength(1)
  })

  it('fails without ready in 5 s, on S1 errors and on closed reasons that stop the measurement', async () => {
    const late = await started()
    await vi.advanceTimersByTimeAsync(5000)
    expect(late.state.phase).toBe('failed')

    fetch.mockResolvedValueOnce(reply(409, { code: 'BASELINE_REQUIRED' }))
    const noBaseline = make()
    await noBaseline.start()
    expect(noBaseline.state).toMatchObject({ phase: 'failed', message: '기준 자세가 없어요. 자세를 먼저 등록해 주세요.' })

    const signedOut = await started()
    socket.push({ type: 'closed', reason: 'unauthorized' })
    expect(signedOut.state).toMatchObject({ phase: 'failed', message: '로그인이 만료됐어요. 다시 로그인해 주세요.' })
  })
})
