import { afterEach, expect, it, vi } from 'vitest'
import { apiRequest, type ApiErrorKind } from './api'
import { setServerAuth } from './serverAuth'

const messages = Object.fromEntries(
  ['signed_out', 'invalid', 'conflict', 'not_found', 'busy', 'limit', 'server', 'network'].map((k) => [k, k]),
) as Record<ApiErrorKind, string>

afterEach(() => {
  setServerAuth(null)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('returns null for 204 without reading a body or logging an error (A6·A7·logout)', async () => {
  setServerAuth({ userId: '42', accessToken: async () => 'synthetic-token' })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  await expect(apiRequest('/auth/account', { method: 'DELETE' }, messages, { retries: 0 })).resolves.toBeNull()
  expect(logged).not.toHaveBeenCalled()
})
