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
  let rolled: LiveState[]
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
      onRolledOver: (state) => rolled.push(state),
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
    rolled = []
    fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(reply(200, view()))
    vi.stubGlobal('location', { protocol: 'https:', host: 'app.example.test' })
    setServerAuth({ userId: '7', accessToken: async () => 'access' })
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
    expect(init.headers).toMatchObject({ Authorization: 'Bearer access', 'X-PoseGood-User-Id': '7' })
    expect(socket.url).toBe('wss://app.example.test/api/v2/realtime')
    expect(socket.sent).toEqual([
      { type: 'hello', schema_version: '2.0', purpose: 'measure', session_id: SESSION, access_token: 'access' },
    ])
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

  it('sends one frame per message, those made before ready first and in order', async () => {
    const live = await started()
    for (let t = 0; t < 1200; t += 100) live.ingest(now + t, points, true)
    now += 1200
    live.tick()
    expect(socket.features()).toHaveLength(0)
    socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
    expect(live.state.phase).toBe('running')
    const sent = socket.features()
    // 12 frames: each interval ends when the next frame arrives, the last one is still open.
    expect(sent.map((b) => b.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(sent[0]).toMatchObject({
      schema_version: '3.0',
      feature_version: 'keypoints-9-v1',
      start_ms: 0,
      end_ms: 100,
      phase: 'running',
    })
    expect(sent.every((b) => (b.frames as unknown[]).length === 1)).toBe(true)
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
      observation: { schema_version: '4.0', sequence: 0, valid: true, posture: 'bad', collapse_probability: 0.82, hold_ms: 500, invalid_reason: null },
    })
    // The momentary `posture: 'bad'` is only a caution on screen: no alert until the server confirms.
    expect(live.state.observation?.posture).toBe('bad')
    expect(live.state.alerting).toBe(false)
    expect(alerts).toEqual([])
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

  it('never lets an older result replace the one on screen (4.0 sequence)', async () => {
    const live = await started()
    socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
    const observation = (sequence: number, collapse_probability: number) => ({
      type: 'observation',
      observation: { schema_version: '4.0', sequence, valid: true, posture: 'good', collapse_probability, hold_ms: 0, invalid_reason: null },
    })
    socket.push(observation(5, 0.2))
    socket.push(observation(4, 0.9))
    socket.push(observation(5, 0.9))
    expect(live.state.observation?.collapse_probability).toBe(0.2)
    socket.push(observation(6, 0.3))
    expect(live.state.observation).toMatchObject({ sequence: 6, collapse_probability: 0.3 })
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

  it('reads the saved result with S4 when closed does not come within 5 s', async () => {
    const live = await started()
    socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
    const saved = { ...EMPTY_SUMMARY, total_ms: 900, valid_ms: 900, normal_ms: 900, keep_rate: 1, events_per_hour: 0 }
    fetch.mockResolvedValueOnce(reply(200, view({ ended: true, last_sequence: 1, summary: saved })))
    live.end()
    await vi.advanceTimersByTimeAsync(5_000)
    await flush()
    expect(fetch.mock.calls[1][0]).toBe(`/api/v2/sessions/${SESSION}`)
    expect(live.state).toMatchObject({ phase: 'ended', lastSequence: 1 })
    expect(live.state.summary.total_ms).toBe(900)
  })

  it('keeps the progress result when S4 knows less than the app already saw', async () => {
    const live = await started()
    socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
    const seen = { ...EMPTY_SUMMARY, total_ms: 1800, valid_ms: 1800, normal_ms: 1800, keep_rate: 1, events_per_hour: 0 }
    socket.push({ type: 'progress', last_sequence: 3, summary: seen })
    // kafka mode: the API's memory engine never got the intervals.
    fetch.mockResolvedValueOnce(reply(200, view()))
    live.end()
    await vi.advanceTimersByTimeAsync(5_000)
    await flush()
    expect(live.state).toMatchObject({ phase: 'ended', lastSequence: 3, late: true })
    expect(live.state.summary.total_ms).toBe(1800)
    expect(ended).toHaveLength(1)
  })

  it('keeps the decisions it saw when S4 answers with the summary only (kafka mode memory, BE 11/11)', async () => {
    const live = await started()
    socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
    const seen = { ...EMPTY_SUMMARY, total_ms: 1800, valid_ms: 1800, normal_ms: 1800, keep_rate: 1, events_per_hour: 0 }
    const collapse = { event_id: 1, kind: 'collapse_confirmed', timestamp_ms: 500, onset_ms: 0, onset_valid_ms: 0, deviation_type: 'forward_slouch', reason: null }
    socket.push({ type: 'decision', event: collapse, summary: seen })
    fetch.mockResolvedValueOnce(reply(200, view({ last_sequence: 3, summary: seen })))
    live.end()
    await vi.advanceTimersByTimeAsync(5_000)
    await flush()
    expect(live.state).toMatchObject({ phase: 'ended', late: true })
    expect(live.state.events.map((e) => e.kind)).toEqual(['collapse_confirmed'])
  })

  it('is not late when closed comes in time', async () => {
    const live = await started()
    socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
    live.end()
    socket.push({ type: 'closed', reason: 'ended' })
    expect(live.state).toMatchObject({ phase: 'ended', late: false })
  })

  it('takes an S4 view rebuilt from the DB even though it says last_sequence -1', async () => {
    const live = await started()
    socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
    const seen = { ...EMPTY_SUMMARY, total_ms: 1800, valid_ms: 1800, normal_ms: 1800, keep_rate: 1, events_per_hour: 0 }
    socket.push({ type: 'progress', last_sequence: 3, summary: seen })
    const stored = { ...seen, total_ms: 2000, valid_ms: 2000, normal_ms: 2000 }
    const sessionEnded = {
      event_id: 1, kind: 'session_ended', timestamp_ms: 2000, onset_ms: 2000, onset_valid_ms: 2000,
      deviation_type: 'none', reason: 'ended',
    }
    fetch.mockResolvedValueOnce(reply(200, view({ ended: true, last_sequence: -1, summary: stored, events: [sessionEnded] })))
    live.end()
    await vi.advanceTimersByTimeAsync(5_000)
    await flush()
    expect(live.state).toMatchObject({ phase: 'ended', lastSequence: 3 })
    expect(live.state.summary.total_ms).toBe(2000)
    expect(live.state.events.map((e) => e.kind)).toEqual(['session_ended'])
  })

  describe('kafka mode order (ack first, alert on its own topic)', () => {
    const summary = { ...EMPTY_SUMMARY, total_ms: 500, valid_ms: 500, deviation_ms: 500, collapse_count: 1, alert_count: 1, interval_count: 1, keep_rate: 0, events_per_hour: 0 }
    const collapse = { event_id: 1, kind: 'collapse_confirmed', timestamp_ms: 500, onset_ms: 0, onset_valid_ms: 0, deviation_type: 'forward_slouch', reason: null }
    const alert = { type: 'alert', event_id: 1, kind: 'collapse_confirmed', deviation_type: 'forward_slouch' }

    it('rings for an alert that comes before its decision', async () => {
      const live = await started()
      socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
      socket.push({ type: 'ack', last_sequence: 0 })
      socket.push(alert)
      socket.push({ type: 'decision', event: collapse, summary })
      expect(alerts).toEqual(['collapse_confirmed'])
      expect(live.state.alerting).toBe(true)
    })

    it('stays quiet for an alert that comes after the episode recovered', async () => {
      const live = await started()
      socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
      socket.push({ type: 'decision', event: collapse, summary })
      socket.push({ type: 'decision', event: { ...collapse, event_id: 2, kind: 'recovery_confirmed' }, summary })
      socket.push(alert)
      expect(alerts).toEqual([])
      expect(live.state.alerting).toBe(false)
    })

    it('stays quiet for an alert after 「측정 종료」', async () => {
      const live = await started()
      socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
      socket.push({ type: 'decision', event: collapse, summary })
      live.end()
      socket.push(alert)
      expect(alerts).toEqual([])
    })
  })

  it('reads S4 at once when the server says the save is late (stalled after end, kafka 3 s)', async () => {
    const live = await started()
    socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
    const seen = { ...EMPTY_SUMMARY, total_ms: 1800, valid_ms: 1800, normal_ms: 1800, keep_rate: 1, events_per_hour: 0 }
    socket.push({ type: 'progress', last_sequence: 3, summary: seen })
    fetch.mockResolvedValueOnce(reply(200, view({ last_sequence: 3, summary: seen })))
    live.end()
    socket.push({ type: 'stalled', since_last_sequence: 3 })
    await flush()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(live.state).toMatchObject({ phase: 'ended', late: true })
    // The 5 s timer was cancelled: no second S4.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('takes an ended S4 whole even with fewer events than the screen saw', async () => {
    const live = await started()
    socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
    const summary = { ...EMPTY_SUMMARY, total_ms: 2000, valid_ms: 2000, normal_ms: 2000, keep_rate: 1, events_per_hour: 0 }
    const collapse = { event_id: 1, kind: 'collapse_confirmed', timestamp_ms: 500, onset_ms: 0, onset_valid_ms: 0, deviation_type: 'forward_slouch', reason: null }
    socket.push({ type: 'decision', event: collapse, summary })
    socket.push({ type: 'decision', event: { ...collapse, event_id: 2, kind: 'reminder', timestamp_ms: 900 }, summary })
    const ended = { event_id: 3, kind: 'session_ended', timestamp_ms: 2000, onset_ms: 2000, onset_valid_ms: 2000, deviation_type: 'none', reason: 'ended' }
    fetch.mockResolvedValueOnce(reply(200, view({ ended: true, last_sequence: -1, summary, events: [ended] })))
    live.end()
    await vi.advanceTimersByTimeAsync(5_000)
    await flush()
    expect(live.state.events.map((e) => e.kind)).toEqual(['session_ended'])
  })

  it('ends marked missing when S4 answers 404 (error page, nothing kept here)', async () => {
    const live = await started()
    socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
    const seen = { ...EMPTY_SUMMARY, total_ms: 1800, valid_ms: 1800, normal_ms: 1800, keep_rate: 1, events_per_hour: 0 }
    socket.push({ type: 'progress', last_sequence: 3, summary: seen })
    fetch.mockResolvedValueOnce(reply(404, { code: 'SESSION_LOST' }))
    live.end()
    await vi.advanceTimersByTimeAsync(5_000)
    await flush()
    // Still `ended` (not `failed`) so the record is kept as this device's pending record.
    expect(live.state).toMatchObject({ phase: 'ended', late: true, resultMissing: true })
    expect(live.state.summary.total_ms).toBe(1800)
  })

  it('reads S4 once, right away, when the socket closes while ending', async () => {
    const live = await started()
    socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
    fetch.mockResolvedValueOnce(reply(200, view({ ended: true, last_sequence: 0 })))
    live.end()
    socket.drop()
    await flush()
    expect(live.state).toMatchObject({ phase: 'ended', lastSequence: 0 })
    await vi.advanceTimersByTimeAsync(5_000)
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
    // No connection to measure with: the same 「cannot start」 page as a server error.
    expect(late.state).toMatchObject({ phase: 'failed', serverDown: true })

    const dropped = await started()
    socket.drop()
    expect(dropped.state).toMatchObject({ phase: 'failed', serverDown: true })

    fetch.mockResolvedValueOnce(reply(409, { code: 'BASELINE_REQUIRED' }))
    const noBaseline = make()
    await noBaseline.start()
    expect(noBaseline.state).toMatchObject({ phase: 'failed', message: '기준 자세가 없어요. 자세를 먼저 등록해 주세요.' })

    const signedOut = await started()
    socket.push({ type: 'closed', reason: 'unauthorized' })
    expect(signedOut.state).toMatchObject({ phase: 'failed', message: '로그인이 만료됐어요. 다시 로그인해 주세요.' })
    expect(signedOut.state.serverDown).toBe(false)
  })

  it('cannot start when the server cannot open the measurement (kafka mode: Kafka down)', async () => {
    const kafkaDown = await started()
    socket.push({ type: 'closed', reason: 'session_lost' })
    expect(kafkaDown.state).toMatchObject({ phase: 'failed', serverDown: true, lost: false })

    fetch.mockResolvedValue(reply(503, { code: 'UNAVAILABLE' }))
    const s1Down = make()
    const starting = s1Down.start()
    await vi.advanceTimersByTimeAsync(10_000)
    await starting
    expect(s1Down.state).toMatchObject({ phase: 'failed', serverDown: true })

    fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    const s1Unreachable = make()
    const reaching = s1Unreachable.start()
    await vi.advanceTimersByTimeAsync(20_000)
    await reaching
    expect(s1Unreachable.state).toMatchObject({ phase: 'failed', serverDown: true })
  })

  it('knows its own 「판정 불가」 at once, without waiting for the server (10/27)', async () => {
    const live = await started()
    socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
    expect(live.state.placeable).toBe(true)
    live.ingest(now + 100, points, false)
    expect(live.state.placeable).toBe(false)
    live.ingest(now + 200, [], true)
    expect(live.state.placeable).toBe(false)
    live.ingest(now + 300, points, true)
    expect(live.state.placeable).toBe(true)
  })

  it('keeps the record when the server closes a running measurement it already stored (BE 10/27)', async () => {
    const reasons: [string, boolean, string][] = [
      ['unmeasurable_timeout', false, '자세를 확인할 수 없는 상태가 30분 이어져'],
      ['day_changed', false, '자정이 지나 측정을 마쳤어요'],
      ['unauthorized', true, '비밀번호 변경이나 탈퇴로 로그인이 끝나'],
      ['bad_message', true, '측정을 이어갈 수 없어 마쳤어요'],
      ['some_new_reason', true, '측정을 이어갈 수 없어 마쳤어요'],
    ]
    for (const [reason, lost, message] of reasons) {
      const live = await started()
      socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
      socket.push({ type: 'closed', reason, ended_at: lost ? null : '2026-10-27T01:05:00.000Z' })
      expect(live.state.phase).toBe('ended')
      expect(live.state.lost).toBe(lost)
      expect(live.state.message).toContain(message)
    }
  })

  describe('KST midnight session_rollover (BE api-spec 11.3)', () => {
    const NEXT = '5d0b8f3a-1c2e-4a6b-9d7f-0e1a2b3c4d5e'
    const day1 = { ...EMPTY_SUMMARY, total_ms: 1000, valid_ms: 1000, normal_ms: 1000, keep_rate: 1, events_per_hour: 0 }
    const sessionEnded = {
      event_id: 1, kind: 'session_ended', timestamp_ms: 1000, onset_ms: 1000, onset_valid_ms: 1000,
      deviation_type: 'none', reason: 'ended',
    }
    const rollover = {
      type: 'session_rollover',
      ended: { session_id: SESSION, ended_at: '2026-10-26T14:59:59.000Z', summary: day1 },
      session_id: NEXT,
      started_at: '2026-10-26T15:00:00Z',
      at_ms: 1000,
    }
    const measuring = async () => {
      const live = await started()
      socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION, started_at: '2026-10-26T14:59:58.000Z' })
      for (let t = 0; t <= 1000; t += 250) live.ingest(1000 + t, points, true)
      socket.push({ type: 'progress', last_sequence: 3, summary: day1, paused_reason: null })
      socket.push({ type: 'decision', event: sessionEnded, summary: day1 })
      return live
    }

    it('hands over the stored day and goes on as the server-made session', async () => {
      const live = await measuring()
      socket.push(rollover)
      expect(rolled).toHaveLength(1)
      expect(rolled[0]).toMatchObject({
        sessionId: SESSION, phase: 'ended', summary: day1,
        startedAt: '2026-10-26T14:59:58.000Z', endedAt: '2026-10-26T14:59:59.000Z',
      })
      expect(rolled[0].events.map((e) => e.kind)).toEqual(['session_ended'])
      expect(live.state).toMatchObject({
        sessionId: NEXT, phase: 'running', startedAt: '2026-10-26T15:00:00Z', endedAt: null,
        summary: EMPTY_SUMMARY, events: [], alerting: false,
      })
      expect(ended).toHaveLength(0)
    })

    it('keeps sending on the connection axis; the server converts times and sequences', async () => {
      const live = await measuring()
      const before = socket.features().at(-1)!
      socket.push(rollover)
      live.ingest(2250, points, true)
      const after = socket.features().at(-1)!
      expect(after.sequence).toBe((before.sequence as number) + 1)
      expect(after.start_ms).toBe(before.end_ms)
      expect(socket.sent.filter((m) => m.type === 'hello')).toHaveLength(1)
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('reads S4 for the new session when closed does not come after end', async () => {
      const live = await measuring()
      socket.push(rollover)
      fetch.mockResolvedValueOnce(reply(200, view({ session_id: NEXT, ended: true, last_sequence: 5 })))
      live.end()
      await vi.advanceTimersByTimeAsync(5_000)
      await flush()
      expect(fetch.mock.calls[1][0]).toBe(`/api/v2/sessions/${NEXT}`)
      expect(live.state).toMatchObject({ sessionId: NEXT, phase: 'ended' })
    })

    it('stays ending when the user ended it before the server rolled over', async () => {
      const live = await started()
      socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
      live.ingest(1500, points, true)
      live.end()
      socket.push({ type: 'decision', event: sessionEnded, summary: day1 })
      socket.push(rollover)
      expect(rolled).toHaveLength(1)
      expect(live.state).toMatchObject({ sessionId: NEXT, phase: 'ending' })
    })

    it('ignores a rollover it cannot read or that comes before ready', async () => {
      const live = await started()
      socket.push(rollover)
      expect(rolled).toHaveLength(0)
      socket.push({ type: 'ready', purpose: 'measure', session_id: SESSION })
      socket.push({ ...rollover, at_ms: 'x' })
      socket.push({ ...rollover, ended: { ...rollover.ended, summary: {} } })
      expect(rolled).toHaveLength(0)
      expect(live.state.sessionId).toBe(SESSION)
    })
  })
})
