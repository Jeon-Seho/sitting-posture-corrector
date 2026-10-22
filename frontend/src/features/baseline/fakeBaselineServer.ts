import { vi } from 'vitest'
import { setServerAuth } from '../platform/serverAuth'

/**
 * Tests only: a signed-in account and an in-memory B1·B2 (`/api/v2/baselines`) behind a
 * stubbed `fetch`. Every saved posture gets a new id; `current` is the newest one.
 */
export const FAKE_USER_ID = '11111111-1111-4111-8111-111111111111'

export type FakeBaselineServer = {
  posts: Record<string, unknown>[]
  /** The newest registered posture as B2 returns it, or null for 404. */
  current: Record<string, unknown> | null
  /** Status for the next B1 calls instead of saving (e.g. 401, 503). */
  failWith: number[]
  /** Status for the next B2 calls instead of answering (e.g. 503); 0 drops the request. */
  failCurrent: number[]
}

let next = 0
const id = () => `9b1c0e0a-2c4d-4f6a-8e1b-${String(++next).padStart(12, '0')}`

export function baselineResponse(landmarks: unknown, registeredAt = '2026-10-21T08:00:00.000Z', baselineId = id()) {
  return { schema_version: '2.0', baseline_id: baselineId, registered_at: registeredAt, landmarks }
}

export function installFakeBaselineServer(initial: Record<string, unknown> | null = null): FakeBaselineServer {
  const server: FakeBaselineServer = { posts: [], current: initial, failWith: [], failCurrent: [] }
  const json = (status: number, body: unknown) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v2/baselines/current') && server.failCurrent.length) {
        const status = server.failCurrent.shift()!
        if (!status) throw new TypeError('offline')
        return json(status, { code: 'FAKE' })
      }
      if (url.endsWith('/api/v2/baselines/current')) return server.current ? json(200, server.current) : json(404, {})
      if (url.endsWith('/api/v2/baselines') && init?.method === 'POST') {
        const status = server.failWith.shift()
        if (status) return json(status, { code: 'FAKE' })
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        server.posts.push(body)
        server.current = baselineResponse(body.landmarks, String(body.registered_at))
        return json(200, server.current)
      }
      return json(404, {})
    }),
  )
  setServerAuth({ userId: FAKE_USER_ID, csrfToken: async () => 'fake-csrf' })
  return server
}

export function removeFakeBaselineServer() {
  setServerAuth(null)
}
