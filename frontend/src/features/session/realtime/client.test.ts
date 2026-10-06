import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DecisionEvent, ServerSummary } from '../server/contracts'
import { frameRequest, SESSION_ID } from '../server/testFixtures'
import { RealtimeClient, type RealtimeHandlers, type SocketLike } from './client'

/** A synthetic gateway socket: records what the app sends and lets the test speak for the server. */
class FakeSocket implements SocketLike {
  readyState = 0
  sent: { type: string; [key: string]: unknown }[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  closedByApp = false
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    this.closedByApp = true
    this.readyState = 3
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  server(message: object) {
    this.onmessage?.({ data: JSON.stringify({ session_id: SESSION_ID, ...message }) })
  }
  drop() {
    this.readyState = 3
    this.onclose?.()
  }
}

const summary = { collapse_count: 1 } as unknown as ServerSummary
function event(event_id: number, kind: DecisionEvent['kind'] = 'collapse_confirmed'): DecisionEvent {
  return {
    schema_version: '1.0',
    session_id: SESSION_ID,
    event_id,
    kind,
    timestamp_ms: event_id * 1000,
    onset_ms: 0,
    onset_valid_ms: 0,
    deviation_type: 'left_lean',
    reason: null,
  }
}

function setup(handlers: RealtimeHandlers = {}, lastEventId?: number) {
  const sockets: FakeSocket[] = []
  const client = new RealtimeClient({
    url: 'ws://synthetic.invalid/realtime',
    sessionId: SESSION_ID,
    createSocket: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
    handlers,
    lastEventId,
    capacity: 4,
    reconnectMs: { initial: 100, max: 400 },
  })
  client.start()
  return { client, sockets, current: () => sockets.at(-1)! }
}

describe('realtime client against a synthetic gateway', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('says hello with the resume point and sends one batch per 0.5 s', () => {
    const { client, current } = setup({}, 7)
    current().open()
    expect(current().sent[0]).toEqual({
      type: 'hello',
      schema_version: '1.0',
      session_id: SESSION_ID,
      last_event_id: 7,
    })
    client.push(frameRequest(0, 0, 100))
    client.push(frameRequest(1, 100, 200))
    expect(current().sent).toHaveLength(1)
    vi.advanceTimersByTime(500)
    expect(current().sent[1]).toMatchObject({ type: 'features', items: [{ sequence: 0 }, { sequence: 1 }] })
  })

  it('keeps intervals until acknowledged and refuses input beyond the window', () => {
    const onAck = vi.fn()
    const { client, current } = setup({ onAck })
    current().open()
    for (let sequence = 0; sequence < 4; sequence++)
      expect(client.push(frameRequest(sequence, sequence * 100, sequence * 100 + 100))).toBe(true)
    expect(client.push(frameRequest(4, 400, 500))).toBe(false)
    current().server({ type: 'ack', last_sequence: 1 })
    expect(onAck).toHaveBeenCalledWith(1)
    expect(client.pendingCount).toBe(2)
    expect(client.push(frameRequest(4, 400, 500))).toBe(true)
    // A stale or repeated ack never moves the window backwards.
    current().server({ type: 'ack', last_sequence: 0 })
    expect(client.pendingCount).toBe(3)
  })

  it('rejects an interval that does not advance the sequence', () => {
    const { client } = setup()
    expect(client.push(frameRequest(3, 300, 400))).toBe(true)
    expect(client.push(frameRequest(3, 300, 400))).toBe(false)
    expect(client.push(frameRequest(2, 200, 300))).toBe(false)
  })

  it('reconnects with back-off, resumes events and resends every unacknowledged interval', () => {
    const onStatus = vi.fn()
    const onDecision = vi.fn()
    const { client, sockets, current } = setup({ onStatus, onDecision })
    current().open()
    client.push(frameRequest(0, 0, 100))
    client.push(frameRequest(1, 100, 200))
    vi.advanceTimersByTime(500)
    current().server({ type: 'ack', last_sequence: 0 })
    current().server({ type: 'decision', event: event(1), summary })
    current().drop()
    expect(onStatus).toHaveBeenLastCalledWith('reconnecting')
    vi.advanceTimersByTime(99)
    expect(sockets).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(sockets).toHaveLength(2)
    current().open()
    expect(current().sent[0]).toMatchObject({ type: 'hello', last_event_id: 1 })
    expect(current().sent[1]).toMatchObject({ type: 'features', items: [{ sequence: 1 }] })
    // The gateway replays event 1 after hello; the screen must not see it twice.
    current().server({ type: 'decision', event: event(1), summary })
    current().server({ type: 'decision', event: event(2, 'recovery_confirmed'), summary })
    expect(onDecision.mock.calls.map(([value]) => value.event_id)).toEqual([1, 2])
  })

  it('doubles the reconnect delay up to the maximum', () => {
    const { sockets, current } = setup()
    current().drop()
    vi.advanceTimersByTime(100)
    current().drop()
    vi.advanceTimersByTime(199)
    expect(sockets).toHaveLength(2)
    vi.advanceTimersByTime(1)
    current().drop()
    vi.advanceTimersByTime(400)
    current().drop()
    vi.advanceTimersByTime(400)
    expect(sockets).toHaveLength(5)
  })

  it('delivers live observations and each alert once, only after its decision', () => {
    const onObservation = vi.fn()
    const onAlert = vi.fn()
    const { current } = setup({ onObservation, onAlert })
    current().open()
    current().server({ type: 'observation', observation: { sequence: 0, valid: true } })
    expect(onObservation).toHaveBeenCalledTimes(1)
    const alert = { type: 'alert', event_id: 1, kind: 'collapse_confirmed', deviation_type: 'left_lean' }
    current().server(alert)
    expect(onAlert).not.toHaveBeenCalled()
    current().server({ type: 'decision', event: event(1), summary })
    current().server(alert)
    current().server(alert)
    expect(onAlert).toHaveBeenCalledTimes(1)
  })

  it('ignores frames for another session, nested events of another session and malformed data', () => {
    const onDecision = vi.fn()
    const onObservation = vi.fn()
    const { current } = setup({ onDecision, onObservation })
    current().open()
    current().onmessage?.({ data: 'not json' })
    current().server({ type: 'observation', session_id: '00000000-0000-4000-8000-0000000000ff' })
    current().server({ type: 'decision', event: { ...event(1), session_id: 'other' }, summary })
    expect(onObservation).not.toHaveBeenCalled()
    expect(onDecision).not.toHaveBeenCalled()
  })

  it('reports a stalled decision path without closing', () => {
    const onStalled = vi.fn()
    const onClosed = vi.fn()
    const { current } = setup({ onStalled, onClosed })
    current().open()
    current().server({ type: 'stalled', since_last_sequence: 4 })
    expect(onStalled).toHaveBeenCalledWith(4)
    expect(onClosed).not.toHaveBeenCalled()
  })

  it.each(['ended', 'unauthorized', 'not_owner', 'session_lost'])(
    'stops for good when the gateway closes with %s',
    (reason) => {
      const onClosed = vi.fn()
      const { client, sockets, current } = setup({ onClosed })
      current().open()
      current().server({ type: 'closed', reason })
      expect(onClosed).toHaveBeenCalledWith(reason)
      expect(current().closedByApp).toBe(true)
      current().drop()
      vi.advanceTimersByTime(10_000)
      expect(sockets).toHaveLength(1)
      expect(client.push(frameRequest(0, 0, 100))).toBe(false)
    },
  )

  it('reconnects after a server shutdown notice', () => {
    const { sockets, current } = setup()
    current().open()
    current().server({ type: 'closed', reason: 'server_shutdown' })
    current().drop()
    vi.advanceTimersByTime(100)
    expect(sockets).toHaveLength(2)
  })

  it('closes locally without reconnecting', () => {
    const onClosed = vi.fn()
    const { client, sockets, current } = setup({ onClosed })
    current().open()
    client.close()
    expect(onClosed).toHaveBeenCalledWith('local')
    current().drop()
    vi.advanceTimersByTime(10_000)
    expect(sockets).toHaveLength(1)
  })

  it('splits a long resend into frames of at most 30 intervals', () => {
    const sockets: FakeSocket[] = []
    const client = new RealtimeClient({
      url: 'ws://synthetic.invalid/realtime',
      sessionId: SESSION_ID,
      createSocket: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
      handlers: {},
      capacity: 70,
    })
    client.start()
    for (let sequence = 0; sequence < 65; sequence++) client.push(frameRequest(sequence, sequence * 10, sequence * 10 + 10))
    sockets[0].open()
    const sizes = sockets[0].sent.filter((m) => m.type === 'features').map((m) => (m.items as unknown[]).length)
    expect(sizes).toEqual([30, 30, 5])
  })
})
