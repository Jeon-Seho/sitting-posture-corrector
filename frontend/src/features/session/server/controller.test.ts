import { describe, expect, it, vi } from 'vitest'
import { validMachine } from '../../storage/validation'
import { ServerRequestError, type ServerReply } from './client'
import { ServerSessionController } from './controller'
import type { ServerCheckpoint, ServerPendingRequest } from './contracts'
import { validServerCheckpoint } from './validation'
import {
  BASELINE,
  BASELINE_ID,
  SESSION_ID,
  cameraFrame,
  checkpoint,
  deferred,
  descriptor,
  flush,
  frameRequest,
  observation,
  syntheticClient,
  view,
} from './testFixtures'

function setup(
  options: {
    client?: ReturnType<typeof syntheticClient>['client']
    saved?: ServerCheckpoint
    finishOnly?: boolean
    capacity?: number
    writable?: boolean
  } = {},
) {
  let now = 0
  const client = options.client ?? syntheticClient().client
  const session = descriptor()
  session.server.checkpoint = options.saved
  session.server.finishOnly = options.finishOnly
  const onEnded = vi.fn()
  const onNotifications = vi.fn()
  const checkpoints: ServerCheckpoint[] = []
  const onCheckpoint = vi.fn((machine, saved: ServerCheckpoint) => {
    expect(validMachine(machine)).toBe(true)
    expect(validServerCheckpoint(saved, SESSION_ID, session.rules)).toBe(true)
    checkpoints.push(saved)
    return options.writable !== false
  })
  const controller = new ServerSessionController({
    session,
    client,
    now: () => now,
    wallNow: () => now,
    capacity: options.capacity,
    onEnded,
    onNotifications,
    onCheckpoint,
  })
  return {
    controller,
    client,
    onEnded,
    onNotifications,
    checkpoints,
    time: (value: number) => {
      now = value
    },
  }
}

describe('server lifecycle using synthetic adjacent frames only', () => {
  it('detaches and freezes authoritative snapshots exposed to presentation consumers', async () => {
    const s = setup()
    const response = view()
    s.client.send.mockResolvedValueOnce({ view: response })
    await s.controller.start()
    await flush()
    response.summary.total_ms = 999
    expect(s.controller.state.view!.summary.total_ms).toBe(0)
    expect(() => {
      s.controller.state.view!.summary.total_ms = 123
    }).toThrow()
  })
  it('delivers a new server confirmation once and does not replay it on later snapshots', async () => {
    const s = setup()
    await s.controller.start()
    await flush()
    s.client.send.mockImplementation(async (request) => {
      if (request.kind !== 'features') throw new Error('Unexpected synthetic request')
      const o = {
        ...observation(request.body),
        collapse_probability: 0.9,
        deviation_type: 'forward_slouch' as const,
      }
      const source = view({ last_sequence: o.sequence })
      const confirmed = o.end_ms >= 3000
      source.summary = {
        ...source.summary,
        total_ms: o.end_ms,
        valid_ms: o.end_ms,
        deviation_ms: o.end_ms,
        keep_rate: 0,
        events_per_hour: confirmed ? 3_600_000 / o.end_ms : 0,
        collapse_count: confirmed ? 1 : 0,
        alert_count: confirmed ? 1 : 0,
      }
      if (confirmed)
        source.events = [
          {
            schema_version: '1.0',
            session_id: SESSION_ID,
            event_id: 1,
            kind: 'collapse_confirmed',
            timestamp_ms: 3000,
            onset_ms: 0,
            onset_valid_ms: 0,
            deviation_type: 'forward_slouch',
            reason: null,
          },
        ]
      return { view: source, observation: o }
    })
    for (const at of [0, 1000, 2000, 3000, 4000]) {
      s.time(at)
      s.controller.ingest(cameraFrame(at), 'synthetic-device')
      await flush()
    }
    expect(s.onNotifications).toHaveBeenCalledOnce()
    expect(s.onNotifications.mock.calls[0][0]).toEqual([
      expect.objectContaining({ event_id: 1, kind: 'collapse_confirmed' }),
    ])
    expect(s.controller.state.live.events).toHaveLength(1)
    expect(s.checkpoints.at(-1)!.lastNotificationId).toBe(1)
  })
  it('persists create before sending, warms up once, and transports fixed baseline deltas', async () => {
    const s = setup()
    await s.controller.start()
    await flush()
    expect(s.checkpoints[0].pending?.kind).toBe('create')
    expect(s.controller.state.phase).toBe('running')
    s.time(100)
    s.controller.ingest(cameraFrame(100), 'synthetic-device')
    expect(s.client.send).toHaveBeenCalledTimes(1)
    s.time(200)
    s.controller.ingest(cameraFrame(200, { ...BASELINE, headGap: 0.6 }), 'synthetic-device')
    await flush()
    expect(s.client.send.mock.calls[1][0]).toMatchObject({
      kind: 'features',
      body: {
        baseline_id: BASELINE_ID,
        sequence: 0,
        start_ms: 100,
        end_ms: 200,
        features: { head_gap_delta: -0.09999999999999998 },
      },
    })
    expect(s.controller.state.live.validSeconds).toBe(0.1)
    expect(s.controller.state.view!.summary.missing_ms).toBe(100)
  })

  it('requires both endpoint measurements and records poor quality without inventing a posture', async () => {
    const s = setup()
    await s.controller.start()
    await flush()
    s.time(100)
    s.controller.ingest(cameraFrame(100, null), 'synthetic-device')
    s.time(200)
    s.controller.ingest(cameraFrame(200), 'synthetic-device')
    await flush()
    expect(s.client.send.mock.calls[1][0]).toMatchObject({
      body: { measurement_quality: 'poor', features: null },
    })
    expect(s.controller.state.live.validSeconds).toBe(0)
    expect(s.controller.state.live.state).toBe('unknown')
  })

  it('invalidates stale normal display immediately on poor quality, including a late earlier good ACK', async () => {
    const s = setup()
    await s.controller.start()
    await flush()
    s.time(100)
    s.controller.ingest(cameraFrame(100), 'synthetic-device')
    s.time(200)
    s.controller.ingest(cameraFrame(200), 'synthetic-device')
    await flush()
    expect(s.controller.state.live.state).toBe('good')
    const transport = syntheticClient(s.controller.state.view!)
    const olderGood = deferred<ServerReply>(),
      latestPoor = deferred<ServerReply>()
    s.client.send.mockImplementation(async (request) => transport.respond(request))
    s.client.send.mockImplementationOnce(() => olderGood.promise)
    s.client.send.mockImplementationOnce(() => latestPoor.promise)
    s.time(250)
    s.controller.ingest(cameraFrame(250), 'synthetic-device')
    s.time(300)
    s.controller.ingest(cameraFrame(300, null), 'synthetic-device')
    expect(s.controller.state.live.state).toBe('unknown')
    olderGood.resolve(transport.respond(s.client.send.mock.calls[2][0]))
    await flush()
    expect(s.controller.state.live.state).toBe('unknown')
    expect(s.controller.state.live.goodSeconds).toBe(0.15)
    expect(s.client.send.mock.calls[3][0]).toMatchObject({
      body: { measurement_quality: 'poor', features: null },
    })
    latestPoor.resolve(transport.respond(s.client.send.mock.calls[3][0]))
    await flush()
    expect(s.controller.state.live.state).toBe('unknown')
    s.time(400)
    s.controller.ingest(cameraFrame(400), 'synthetic-device')
    await flush()
    expect(s.controller.state.live.state).toBe('unknown')
    s.time(500)
    s.controller.ingest(cameraFrame(500), 'synthetic-device')
    await flush()
    expect(s.controller.state.live.state).toBe('good')
  })

  it('drops a real frame gap, pauses, and resumes with a new warmup rather than filling it', async () => {
    const s = setup()
    await s.controller.start()
    await flush()
    s.time(100)
    s.controller.ingest(cameraFrame(100), 'synthetic-device')
    s.time(2000)
    s.controller.ingest(cameraFrame(2000), 'synthetic-device')
    expect(s.client.send).toHaveBeenCalledTimes(1)
    expect(s.controller.state.phase).toBe('paused')
    expect(s.controller.resume()).toBe(true)
    s.time(2100)
    s.controller.ingest(cameraFrame(2100), 'synthetic-device')
    s.time(2200)
    s.controller.ingest(cameraFrame(2200), 'synthetic-device')
    await flush()
    expect(s.controller.state.view!.summary).toMatchObject({ valid_ms: 100, missing_ms: 2100 })
  })

  it('does not send changes from another device or frame dimensions', async () => {
    const s = setup()
    await s.controller.start()
    await flush()
    s.time(100)
    s.controller.ingest(cameraFrame(100), 'different-synthetic-device')
    expect(s.controller.state.phase).toBe('paused')
    expect(s.client.send).toHaveBeenCalledTimes(1)
    s.controller.resume()
    s.time(200)
    s.controller.ingest({ ...cameraFrame(200), width: 1280 }, 'synthetic-device')
    expect(s.controller.state.phase).toBe('paused')
    expect(s.client.send).toHaveBeenCalledTimes(1)
  })

  it('pauses on uncertain failure and retries identical payload without automatic resumption', async () => {
    const s = setup()
    await s.controller.start()
    await flush()
    s.client.send.mockRejectedValueOnce(new ServerRequestError('Synthetic timeout'))
    s.time(100)
    s.controller.ingest(cameraFrame(100), 'synthetic-device')
    s.time(200)
    s.controller.ingest(cameraFrame(200), 'synthetic-device')
    await flush()
    const original = s.client.send.mock.calls[1][0]
    expect(s.controller.state.phase).toBe('paused')
    expect(s.checkpoints.at(-1)!.pending).toEqual(original)
    await s.controller.retry()
    await flush()
    expect(s.client.send.mock.calls[2][0]).toBe(original)
    expect(s.controller.state.phase).toBe('paused')
    expect(s.controller.state.canResume).toBe(true)
  })

  it('bounds lagging frames and stays paused after the backlog drains', async () => {
    const s = setup({ capacity: 2 })
    await s.controller.start()
    await flush()
    const first = deferred<ServerReply>()
    const transport = syntheticClient()
    s.client.send.mockImplementation(async (request) => transport.respond(request))
    s.client.send.mockImplementationOnce(() => first.promise)
    for (const at of [100, 200, 300, 400]) {
      s.time(at)
      s.controller.ingest(cameraFrame(at), 'synthetic-device')
    }
    expect(s.controller.state).toMatchObject({ phase: 'paused', queued: 2 })
    first.resolve(transport.respond(s.client.send.mock.calls[1][0]))
    await flush()
    expect(s.controller.state.phase).toBe('paused')
    expect(s.controller.state.queued).toBe(0)
  })

  it('freezes end during unfinished create and calls final saving only after end ACK', async () => {
    const s = setup()
    const creation = deferred<ServerReply>(),
      ending = deferred<ServerReply>()
    const normal = syntheticClient()
    s.client.send.mockImplementation((request) =>
      request.kind === 'create' ? creation.promise : ending.promise,
    )
    await s.controller.start()
    s.time(250)
    s.controller.end()
    s.time(900)
    s.controller.end()
    expect(s.client.send).toHaveBeenCalledTimes(1)
    expect(s.onEnded).not.toHaveBeenCalled()
    creation.resolve({ view: view() })
    await flush()
    const pending = s.client.send.mock.calls[1][0]
    expect(pending).toEqual({ kind: 'end', body: { end_ms: 250 } })
    expect(s.onEnded).not.toHaveBeenCalled()
    ending.resolve(normal.respond(pending))
    await flush()
    expect(s.onEnded).toHaveBeenCalledOnce()
    expect(s.controller.state.phase).toBe('ended')
  })

  it('eventually queues a frozen end even when the bounded queue had no free slot', async () => {
    const s = setup({ capacity: 1 })
    await s.controller.start()
    await flush()
    const pending = deferred<ServerReply>()
    const transport = syntheticClient()
    s.client.send.mockImplementation(async (request) => transport.respond(request))
    s.client.send.mockImplementationOnce(() => pending.promise)
    s.time(100)
    s.controller.ingest(cameraFrame(100), 'synthetic-device')
    s.time(200)
    s.controller.ingest(cameraFrame(200), 'synthetic-device')
    const feature = s.client.send.mock.calls[1][0]
    s.time(250)
    s.controller.end()
    expect(s.client.send).toHaveBeenCalledTimes(2)
    pending.resolve(transport.respond(feature))
    await flush()
    expect(s.client.send.mock.calls[2][0]).toEqual({ kind: 'end', body: { end_ms: 250 } })
    expect(s.onEnded).toHaveBeenCalledOnce()
  })

  it('keeps a failed end timestamp and saves final results once after its retry', async () => {
    const s = setup()
    await s.controller.start()
    await flush()
    s.client.send.mockRejectedValueOnce(new ServerRequestError('Synthetic uncertain end'))
    s.time(100)
    s.controller.end()
    await flush()
    expect(s.onEnded).not.toHaveBeenCalled()
    s.time(5000)
    await s.controller.retry()
    await flush()
    expect(s.client.send.mock.calls[2][0]).toEqual({ kind: 'end', body: { end_ms: 100 } })
    expect(s.onEnded).toHaveBeenCalledOnce()
  })

  it('records only known rest heartbeats and retains a long scheduling gap as missing', async () => {
    const s = setup()
    await s.controller.start()
    await flush()
    s.time(100)
    s.controller.pause()
    await flush()
    s.time(600)
    s.controller.tick()
    await flush()
    s.time(5000)
    s.controller.tick()
    await flush()
    s.time(5500)
    s.controller.tick()
    await flush()
    expect(s.controller.state.view!.summary).toMatchObject({
      rest_ms: 1100,
      missing_ms: 4400,
      valid_ms: 0,
    })
    expect(s.controller.state.live.goodSeconds).toBe(0)
  })

  it('does not send any create when checkpoint persistence fails', async () => {
    const s = setup({ writable: false })
    await s.controller.start()
    await flush()
    expect(s.client.send).not.toHaveBeenCalled()
    expect(s.controller.state.phase).toBe('paused')
    expect(s.controller.state.retryable).toBe(true)
  })

  it('restores with GET, preserves uncertain input and never plays historical notifications', async () => {
    const pending: ServerPendingRequest = { kind: 'features', body: frameRequest() }
    const saved = checkpoint({ elapsedMs: 100, nextSequence: 1, pending })
    const s = setup({ saved })
    await s.controller.start()
    await flush()
    expect(s.client.get).toHaveBeenCalledOnce()
    expect(s.client.send.mock.calls[0][0]).toEqual(pending)
    expect(s.controller.state.phase).toBe('paused')
    expect(s.onNotifications).not.toHaveBeenCalled()
    expect(s.checkpoints.at(-1)!.baseline).toEqual(BASELINE)
  })

  it('blocks confirmed server-session loss without PUT recreating its UUID', async () => {
    const client = syntheticClient().client
    client.get.mockRejectedValue(new ServerRequestError('Synthetic missing session', 404))
    const s = setup({ saved: checkpoint(), client })
    await s.controller.start()
    await flush()
    expect(s.controller.state.phase).toBe('lost')
    expect(client.send).not.toHaveBeenCalled()
    expect(s.onEnded).not.toHaveBeenCalled()
    s.controller.end()
    await s.controller.retry()
    expect(client.send).not.toHaveBeenCalled()
  })

  it('allows identical create retry if no server view was ever acknowledged', async () => {
    const client = syntheticClient().client
    client.get.mockRejectedValueOnce(new ServerRequestError('Synthetic not created', 404))
    const pending: ServerPendingRequest = { kind: 'create', body: { policy: view().policy } }
    const s = setup({ saved: checkpoint({ view: null, pending }), client })
    await s.controller.start()
    await flush()
    expect(client.send.mock.calls[0][0]).toEqual(pending)
    expect(s.controller.state.phase).toBe('paused')
  })

  it('validates restored identity and refuses a stale rewritten ledger', async () => {
    const existing = syntheticClient()
    const accepted = existing.respond({ kind: 'features', body: frameRequest() }).view
    const client = syntheticClient().client
    const s = setup({
      saved: checkpoint({ view: accepted, elapsedMs: 100, nextSequence: 1 }),
      client,
    })
    await s.controller.start()
    await flush()
    expect(s.controller.state.phase).toBe('paused')
    expect(s.controller.state.message).toContain('뒤로 갔거나')
    expect(client.send).not.toHaveBeenCalled()
  })

  it('resolves terminal feature rejection via GET and can end without restarting capture', async () => {
    const s = setup()
    await s.controller.start()
    await flush()
    s.client.send.mockRejectedValueOnce(new ServerRequestError('Synthetic development limit', 429))
    s.time(100)
    s.controller.ingest(cameraFrame(100), 'synthetic-device')
    s.time(200)
    s.controller.ingest(cameraFrame(200), 'synthetic-device')
    await flush()
    expect(s.checkpoints.at(-1)!.pending).toBeNull()
    s.time(300)
    s.controller.end()
    await flush()
    expect(s.client.get).toHaveBeenCalledOnce()
    expect(s.client.send.mock.calls[2][0]).toEqual({ kind: 'end', body: { end_ms: 300 } })
    expect(s.onEnded).toHaveBeenCalledOnce()
  })

  it('finish-only recovery resolves pending input before ending and sends end once', async () => {
    const pending: ServerPendingRequest = { kind: 'features', body: frameRequest() }
    const s = setup({
      saved: checkpoint({ elapsedMs: 100, nextSequence: 1, pending }),
      finishOnly: true,
    })
    await s.controller.start()
    await flush()
    expect(s.client.send.mock.calls.map(([request]) => request.kind)).toEqual(['features', 'end'])
    expect(s.onEnded).toHaveBeenCalledOnce()
  })

  it('durably preserves end intent alongside an uncertain feature request across reload', async () => {
    const first = setup()
    await first.controller.start()
    await flush()
    first.client.send.mockRejectedValueOnce(new ServerRequestError('Synthetic uncertain feature'))
    first.time(100)
    first.controller.ingest(cameraFrame(100), 'synthetic-device')
    first.time(200)
    first.controller.ingest(cameraFrame(200), 'synthetic-device')
    await flush()
    first.time(250)
    first.controller.end()
    const saved = first.checkpoints.at(-1)!
    expect(saved).toMatchObject({
      endAt: 250,
      pending: { kind: 'features', body: { sequence: 0, start_ms: 100, end_ms: 200 } },
    })
    first.controller.dispose()
    const restored = setup({ saved })
    await restored.controller.start()
    await flush()
    expect(restored.client.send.mock.calls.map(([request]) => request.kind)).toEqual([
      'features',
      'end',
    ])
    expect(restored.client.send.mock.calls[1][0]).toEqual({ kind: 'end', body: { end_ms: 250 } })
    expect(restored.onEnded).toHaveBeenCalledOnce()
  })

  it('rejects substituting a different baseline under the same restored baseline UUID', async () => {
    const s = setup({ saved: checkpoint({ baseline: { ...BASELINE, headGap: 0.1 } }) })
    await s.controller.start()
    await flush()
    expect(s.controller.state.phase).toBe('lost')
    expect(s.client.get).not.toHaveBeenCalled()
    expect(s.client.send).not.toHaveBeenCalled()
  })
})
