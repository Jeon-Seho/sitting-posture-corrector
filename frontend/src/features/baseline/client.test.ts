import { afterEach, describe, expect, it, vi } from 'vitest'
import { setServerAuth } from '../platform/serverAuth'
import { ApiError } from '../platform/api'
import { fetchCurrentBaseline, registerBaseline } from './client'
import { BASELINE_JOINT_NAMES, type BaselineLandmarks } from './landmarkCapture'

const USER = '11111111-1111-4111-8111-111111111111'
const ID = '9b1c0e0a-2c4d-4f6a-8e1b-5a7c9d2e4f60'
const landmarks = Object.fromEntries(BASELINE_JOINT_NAMES.map((n) => [n, { x: 0.5, y: 0.4 }])) as BaselineLandmarks
const stored = { schema_version: '2.0', baseline_id: ID, registered_at: '2026-10-21T08:00:00.000Z', landmarks }
const reply = (status: number, body: unknown = {}) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response
const captured = { calibrationMs: 3000, sampleCount: 90, landmarks }

describe('baseline API (B1·B2) with a stubbed fetch only', () => {
  afterEach(() => setServerAuth(null))

  it('needs a signed-in account', async () => {
    const fetch = vi.fn()
    await expect(fetchCurrentBaseline({ fetch })).rejects.toMatchObject({ kind: 'signed_out' })
    await expect(registerBaseline(captured, stored.registered_at, { fetch })).rejects.toBeInstanceOf(
      ApiError,
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reads the current posture and treats 404 as none registered', async () => {
    setServerAuth({ userId: USER, csrfToken: async () => 'token' })
    const fetch = vi.fn().mockResolvedValueOnce(reply(200, stored)).mockResolvedValueOnce(reply(404))
    expect(await fetchCurrentBaseline({ fetch })).toEqual({
      baselineId: ID,
      registeredAt: stored.registered_at,
      landmarks,
    })
    expect(await fetchCurrentBaseline({ fetch })).toBeNull()
    expect(fetch.mock.calls[0][0]).toBe('/api/v2/baselines/current')
    expect(fetch.mock.calls[0][1].headers).toEqual({ 'X-PoseGood-User-Id': USER })
  })

  it('sends B1 with CSRF and account headers and retries 502·503 with the same body', async () => {
    setServerAuth({ userId: USER, csrfToken: async () => 'token' })
    const fetch = vi.fn().mockResolvedValueOnce(reply(503)).mockResolvedValueOnce(reply(200, stored))
    const saved = await registerBaseline(captured, stored.registered_at, { fetch, retryDelayMs: 0 })
    expect(saved.baselineId).toBe(ID)
    expect(fetch).toHaveBeenCalledTimes(2)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/v2/baselines')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'X-CSRF-TOKEN': 'token', 'X-PoseGood-User-Id': USER })
    expect(JSON.parse(init.body)).toEqual({
      registered_at: stored.registered_at,
      calibration_ms: 3000,
      sample_count: 90,
      landmarks,
    })
    expect(fetch.mock.calls[1][1].body).toBe(init.body)
  })

  it('rejects a reply that is not a posture and explains HTTP errors', async () => {
    setServerAuth({ userId: USER, csrfToken: async () => 'token' })
    const bad = vi.fn().mockResolvedValue(reply(200, { ...stored, baseline_id: 'x' }))
    await expect(registerBaseline(captured, stored.registered_at, { fetch: bad })).rejects.toMatchObject({
      kind: 'server',
    })
    const conflict = vi.fn().mockResolvedValue(reply(409))
    await expect(registerBaseline(captured, stored.registered_at, { fetch: conflict })).rejects.toMatchObject({
      kind: 'conflict',
    })
    const offline = vi.fn().mockRejectedValue(new TypeError('offline'))
    await expect(
      registerBaseline(captured, stored.registered_at, { fetch: offline, retryDelayMs: 0 }),
    ).rejects.toMatchObject({ kind: 'network' })
    expect(offline).toHaveBeenCalledTimes(4)
  })

  it('sends B1 again with the same body when no answer came back (B1 returns the same row)', async () => {
    setServerAuth({ userId: USER, csrfToken: async () => 'token' })
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(reply(200, stored))
    expect((await registerBaseline(captured, stored.registered_at, { fetch, retryDelayMs: 0 })).baselineId).toBe(ID)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body)
  })

  it('does not repeat B2 when no answer came back', async () => {
    setServerAuth({ userId: USER, csrfToken: async () => 'token' })
    const offline = vi.fn().mockRejectedValue(new TypeError('offline'))
    await expect(fetchCurrentBaseline({ fetch: offline, retryDelayMs: 0 })).rejects.toMatchObject({ kind: 'network' })
    expect(offline).toHaveBeenCalledOnce()
  })
})
