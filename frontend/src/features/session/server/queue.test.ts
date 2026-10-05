import { describe, expect, it, vi } from 'vitest'
import type { ServerReply } from './client'
import { OrderedRequestQueue } from './queue'
import { deferred, flush, frameRequest, syntheticClient, view } from './testFixtures'

describe('ordered server mutation queue with synthetic requests', () => {
  it('sends one request at a time and freezes the original nested body', async () => {
    const first = deferred<ServerReply>()
    const { client } = syntheticClient()
    client.send.mockImplementationOnce(() => first.promise)
    const accepted = vi.fn()
    const queue = new OrderedRequestQueue({
      client,
      beforeSend: () => true,
      accepted,
      failed: vi.fn(),
    })
    const body = frameRequest()
    queue.enqueue({ kind: 'features', body })
    body.features!.head_gap_delta = 999
    queue.enqueue({ kind: 'features', body: frameRequest(1, 100, 200) })
    expect(client.send).toHaveBeenCalledTimes(1)
    expect(client.send.mock.calls[0][0]).toMatchObject({
      body: { features: { head_gap_delta: 0 } },
    })
    first.resolve({ view: view() })
    await flush()
    expect(client.send).toHaveBeenCalledTimes(2)
    expect(accepted).toHaveBeenCalledTimes(2)
    expect(queue.size).toBe(0)
  })

  it('retains an uncertain head and retries the identical request before its successor', async () => {
    const { client } = syntheticClient()
    client.send.mockRejectedValueOnce(new Error('Synthetic uncertain network failure'))
    const queue = new OrderedRequestQueue({
      client,
      beforeSend: () => true,
      accepted: vi.fn(),
      failed: vi.fn(),
    })
    queue.enqueue({ kind: 'features', body: frameRequest() })
    queue.enqueue({ kind: 'end', body: { end_ms: 100 } })
    await flush()
    expect(client.send).toHaveBeenCalledTimes(1)
    expect(queue.size).toBe(2)
    expect(queue.failed).toBe(true)
    const original = client.send.mock.calls[0][0]
    queue.retry()
    await flush()
    expect(client.send.mock.calls[1][0]).toBe(original)
    expect(client.send.mock.calls[2][0].kind).toBe('end')
  })

  it('bounds its backlog without replacing an uncertain head', async () => {
    const first = deferred<ServerReply>()
    const { client } = syntheticClient()
    client.send.mockImplementationOnce(() => first.promise)
    const queue = new OrderedRequestQueue({
      client,
      capacity: 2,
      beforeSend: () => true,
      accepted: vi.fn(),
      failed: vi.fn(),
    })
    expect(queue.enqueue({ kind: 'features', body: frameRequest() })).toBe(true)
    expect(queue.enqueue({ kind: 'features', body: frameRequest(1, 100, 200) })).toBe(true)
    expect(queue.enqueue({ kind: 'features', body: frameRequest(2, 200, 300) })).toBe(false)
    expect(queue.pending).toMatchObject({ body: { sequence: 0 } })
    queue.dispose()
  })

  it('does not make a mutation when the durable checkpoint fails', async () => {
    const { client } = syntheticClient()
    const queue = new OrderedRequestQueue({
      client,
      beforeSend: () => false,
      accepted: vi.fn(),
      failed: vi.fn(),
    })
    queue.enqueue({ kind: 'create', body: { policy: view().policy } })
    await flush()
    expect(client.send).not.toHaveBeenCalled()
    expect(queue.failed).toBe(true)
    expect(queue.pending?.kind).toBe('create')
  })

  it('aborts disposal and ignores a late mutation response', async () => {
    const first = deferred<ServerReply>()
    const { client } = syntheticClient()
    client.send.mockImplementationOnce(() => first.promise)
    const accepted = vi.fn()
    const queue = new OrderedRequestQueue({
      client,
      beforeSend: () => true,
      accepted,
      failed: vi.fn(),
    })
    queue.enqueue({ kind: 'create', body: { policy: view().policy } })
    const signal = client.send.mock.calls[0][1]
    queue.dispose()
    first.resolve({ view: view() })
    await flush()
    expect(signal.aborted).toBe(true)
    expect(accepted).not.toHaveBeenCalled()
    expect(queue.pending?.kind).toBe('create')
  })
})
