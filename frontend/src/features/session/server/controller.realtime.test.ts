import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SocketLike } from '../realtime/client'
import { ServerSessionController } from './controller'
import type { DecisionEvent, FrameRequest, ServerCheckpoint } from './contracts'
import { SESSION_ID, cameraFrame, descriptor, flush, observation, syntheticClient } from './testFixtures'

/** One synthetic gateway socket. The test plays CEP with the same ledger the HTTP double uses. */
class FakeSocket implements SocketLike {
  readyState = 0
  sent: { type: string; items?: FrameRequest[]; [key: string]: unknown }[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    this.readyState = 3
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  push(message: object) {
    this.onmessage?.({ data: JSON.stringify({ session_id: SESSION_ID, ...message }) })
  }
}

function collapse(event_id: number, timestamp_ms: number): DecisionEvent {
  return {
    schema_version: '1.0',
    session_id: SESSION_ID,
    event_id,
    kind: 'collapse_confirmed',
    timestamp_ms,
    onset_ms: 0,
    onset_valid_ms: 0,
    deviation_type: 'forward_slouch',
    reason: null,
  }
}

async function setup() {
  let now = 0
  const { client } = syntheticClient()
  const sockets: FakeSocket[] = []
  const checkpoints: ServerCheckpoint[] = []
  const onNotifications = vi.fn()
  const onEnded = vi.fn()
  const controller = new ServerSessionController({
    session: descriptor(),
    client,
    now: () => now,
    wallNow: () => now,
    onEnded,
    onNotifications,
    onCheckpoint: (_machine, saved) => {
      checkpoints.push(saved)
    },
    realtime: {
      url: 'ws://synthetic.invalid/realtime',
      createSocket: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    },
  })
  await controller.start()
  await flush()
  const socket = () => sockets.at(-1)!
  socket().open()
  /** Gateway + CEP: acknowledge, run each interval through the shared ledger, report progress. */
  async function process() {
    const frames = socket().sent.filter((m) => m.type === 'features').flatMap((m) => m.items!)
    const last = frames.at(-1)
    if (!last) return
    let latest = null
    for (const body of frames) {
      latest = (await client.send({ kind: 'features', body }, new AbortController().signal)).view
      socket().push({ type: 'observation', observation: observation(body) })
    }
    socket().sent = socket().sent.filter((m) => m.type !== 'features')
    socket().push({ type: 'ack', last_sequence: last.sequence })
    socket().push({ type: 'progress', last_sequence: latest!.last_sequence, summary: latest!.summary })
    return latest!
  }
  function frames(...times: number[]) {
    for (const at of times) {
      now = at
      controller.ingest(cameraFrame(at), 'synthetic-device')
    }
  }
  const featureSends = () => client.send.mock.calls.filter(([request]) => request.kind === 'features').length
  return { controller, client, socket, sockets, process, frames, featureSends, checkpoints, onNotifications, onEnded }
}

describe('server session over the realtime transport (synthetic gateway)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
  afterEach(() => vi.useRealTimers())

  it('creates over HTTP, then sends live intervals over WebSocket and moves counts on progress', async () => {
    const s = await setup()
    expect(s.client.send.mock.calls.map(([request]) => request.kind)).toEqual(['create'])
    expect(s.socket().sent[0]).toMatchObject({ type: 'hello', last_event_id: 0 })
    s.frames(100, 200, 300)
    expect(s.controller.state.queued).toBe(2)
    vi.advanceTimersByTime(500)
    expect(s.socket().sent.at(-1)).toMatchObject({ type: 'features', items: [{ sequence: 0 }, { sequence: 1 }] })
    const before = s.featureSends()
    await s.process()
    // Only the synthetic CEP above touched the ledger; the controller sent no HTTP features.
    expect(s.featureSends()).toBe(before + 2)
    expect(s.controller.state.queued).toBe(0)
    expect(s.controller.state.view!.summary.valid_ms).toBe(200)
    expect(s.controller.state.view!.last_sequence).toBe(1)
    expect(s.controller.state.live.state).toBe('good')
    expect(s.checkpoints.at(-1)!.nextSequence).toBe(2)
  })

  it('notifies a pushed confirmation once, even when it is replayed after reconnecting', async () => {
    const s = await setup()
    s.frames(0, 1000, 2000, 3000)
    vi.advanceTimersByTime(500)
    const ledger = await s.process()
    // Confirmed counts never shrink, so the synthetic CEP only adds the episode.
    const summary = { ...ledger!.summary, collapse_count: 1, alert_count: 1, events_per_hour: 1200 }
    s.socket().push({ type: 'decision', event: collapse(1, 3000), summary })
    expect(s.onNotifications).toHaveBeenCalledOnce()
    s.socket().onclose?.()
    vi.advanceTimersByTime(500)
    s.socket().open()
    expect(s.socket().sent[0]).toMatchObject({ type: 'hello', last_event_id: 1 })
    s.socket().push({ type: 'decision', event: collapse(1, 3000), summary })
    expect(s.onNotifications).toHaveBeenCalledOnce()
    expect(s.controller.state.view!.events).toHaveLength(1)
    expect(s.checkpoints.at(-1)!.lastNotificationId).toBe(1)
  })

  it('ends over HTTP only after every live interval is acknowledged', async () => {
    const s = await setup()
    s.frames(100, 200)
    s.controller.end()
    await flush()
    expect(s.client.send.mock.calls.some(([request]) => request.kind === 'end')).toBe(false)
    expect(s.controller.state.message).toContain('모두 확인되면')
    vi.advanceTimersByTime(500)
    await s.process()
    await flush()
    expect(s.client.send.mock.calls.at(-1)![0].kind).toBe('end')
    expect(s.controller.state.phase).toBe('ended')
    expect(s.onEnded).toHaveBeenCalledOnce()
  })

  it('shows a stalled decision path and clears it on the next observation', async () => {
    const s = await setup()
    s.socket().push({ type: 'stalled', since_last_sequence: -1 })
    expect(s.controller.state.message).toContain('분석이 잠시 멈췄어요')
    s.frames(100, 200)
    vi.advanceTimersByTime(500)
    await s.process()
    expect(s.controller.state.message).toBe('')
  })

  it('stops input when pushed counts rewind the confirmed ledger', async () => {
    const s = await setup()
    s.frames(100, 200)
    vi.advanceTimersByTime(500)
    const earlier = await s.process()
    s.frames(300, 400)
    vi.advanceTimersByTime(500)
    await s.process()
    s.socket().push({ type: 'progress', last_sequence: 3, summary: earlier!.summary })
    expect(s.controller.state.phase).toBe('paused')
    expect(s.controller.state.canResume).toBe(false)
    expect(s.controller.state.message).toContain('뒤로 갔거나')
  })

  it('pauses without resuming when the gateway refuses the owner', async () => {
    const s = await setup()
    s.socket().push({ type: 'closed', reason: 'not_owner' })
    expect(s.controller.state.phase).toBe('paused')
    expect(s.controller.state.canResume).toBe(false)
    expect(s.controller.state.message).toContain('권한')
  })
})
