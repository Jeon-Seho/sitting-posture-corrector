import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_RULES } from '../../../data/posture'
import { createSessionClient, ServerRequestError } from './client'
import { SESSION_ID, frameRequest, syntheticClient, view } from './testFixtures'

describe('same-origin server client with synthetic HTTP responses', () => {
  afterEach(() => vi.useRealTimers())

  it('posts only the immutable feature contract and validates both response envelopes', async () => {
    const request = frameRequest()
    const reply = syntheticClient().respond({ kind: 'features', body: request })
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            schema_version: '1.0',
            observation: reply.observation,
            session: reply.view,
          }),
          { status: 200 },
        ),
    )
    const client = createSessionClient(SESSION_ID, DEFAULT_RULES, {
      fetch: fetchMock as typeof fetch,
    })
    const result = await client.send(
      { kind: 'features', body: request },
      new AbortController().signal,
    )
    expect(result.view.last_sequence).toBe(0)
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/v1/sessions/${SESSION_ID}/features`,
      expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
        body: JSON.stringify(request),
      }),
    ])
  })

  it('rejects a response from a different session or frozen policy', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ...view(), policy: { ...view().policy, hold_ms: 8000 } }), {
          status: 200,
        }),
    )
    const client = createSessionClient(SESSION_ID, DEFAULT_RULES, {
      fetch: fetchMock as typeof fetch,
    })
    await expect(client.get(new AbortController().signal)).rejects.toThrow('계약과 일치하지')
  })

  it('distinguishes explicit rejection from uncertain timeout and aborts the timed request', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init!.signal as AbortSignal
          signal.addEventListener('abort', () => reject(new Error('Synthetic abort')), {
            once: true,
          })
        }),
    )
    const client = createSessionClient(SESSION_ID, DEFAULT_RULES, {
      fetch: fetchMock as typeof fetch,
      timeoutMs: 100,
    })
    const promise = client.send(
      { kind: 'create', body: { policy: view().policy } },
      new AbortController().signal,
    )
    const rejection = expect(promise).rejects.toMatchObject({
      status: null,
      message: expect.stringContaining('처리 여부가 확인되지 않아'),
    })
    await vi.advanceTimersByTimeAsync(100)
    await rejection
    expect(signal!.aborted).toBe(true)
    const terminal = createSessionClient(SESSION_ID, DEFAULT_RULES, {
      fetch: vi.fn(async () => new Response('{}', { status: 429 })) as typeof fetch,
    })
    await expect(terminal.get(new AbortController().signal)).rejects.toBeInstanceOf(
      ServerRequestError,
    )
  })
})
