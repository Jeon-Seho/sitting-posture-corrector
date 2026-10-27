import { describe, expect, it, vi } from 'vitest'
import {
  AccountError,
  accountErrorMessage,
  createAccountClient,
  fromApiProfile,
  toApiProfile,
} from './accountClient'
import { allAgreed, consentPayload } from './consents'
import { getServerAuth, setServerAuth } from '../platform/serverAuth'
import { resetServerClock, serverToday } from '../platform/serverClock'

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown }

/** Synthetic account server: replies in order, records what the app sent. */
function server(replies: Array<[number, unknown?]>) {
  const calls: Call[] = []
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    expect(init?.credentials).toBe('include')
    const [status, body] = replies.shift() ?? [500]
    return new Response(body === undefined ? null : JSON.stringify(body), { status })
  })
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch }
}

const VIEW = {
  user_id: '42',
  email: 'synthetic@example.invalid',
  profile: { name: '합성 가입', age: null, occupation: null },
}
const CSRF = (token: string) => [200, { header_name: 'X-CSRF-TOKEN', token }] as [number, unknown]

describe('account server client (D-66, contracts/accounts.v2.md A1–A5)', () => {
  it('signs up with the CSRF token, snake_case body, null optional values and agreed consents only', async () => {
    const s = server([CSRF('t1'), [200, VIEW]])
    const client = createAccountClient({ fetch: s.fetch, base: 'https://api.example.invalid' })
    const choices = { ...allAgreed(), C3: false }
    const view = await client.register({
      email: VIEW.email,
      password: 'synthetic-password-12',
      profile: { name: '합성 가입' },
      consents: consentPayload(choices),
    })
    expect(view.user_id).toBe('42')
    expect(client.userId()).toBe('42')
    expect(s.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET https://api.example.invalid/api/v2/auth/csrf',
      'POST https://api.example.invalid/api/v2/auth/register',
    ])
    expect(s.calls[1].headers['X-CSRF-TOKEN']).toBe('t1')
    const body = s.calls[1].body as { profile: unknown; consents: { type: string; document_version: string }[] }
    expect(body.profile).toEqual({ name: '합성 가입', age: null, occupation: null })
    expect(body.consents.map((c) => c.type).sort()).toEqual(
      ['ACCOUNT_INFO', 'AGE_14_OVER', 'MEASUREMENT_RECORD', 'POSE_COORDINATES', 'TERMS'],
    )
    expect(new Set(body.consents.map((c) => c.document_version))).toEqual(new Set(['service-v2']))
  })

  it('takes a new CSRF token after login and sends the user id on logout', async () => {
    const s = server([CSRF('before'), [200, VIEW], CSRF('after'), [204]])
    const client = createAccountClient({ fetch: s.fetch, base: '' })
    await client.login(VIEW.email, 'synthetic-password-12')
    await client.logout()
    expect(s.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/v2/auth/csrf',
      'POST /api/v2/auth/login',
      'GET /api/v2/auth/csrf',
      'POST /api/v2/auth/logout',
    ])
    expect(s.calls[3].headers).toMatchObject({ 'X-CSRF-TOKEN': 'after', 'X-PoseGood-User-Id': '42' })
    expect(client.userId()).toBeNull()
  })

  it('replaces a stale CSRF token once (403 ACCESS_DENIED)', async () => {
    const s = server([CSRF('old'), [403, { code: 'ACCESS_DENIED' }], CSRF('new'), [200, VIEW]])
    const client = createAccountClient({ fetch: s.fetch, base: '' })
    await client.login(VIEW.email, 'synthetic-password-12')
    expect(s.calls[3].headers['X-CSRF-TOKEN']).toBe('new')
  })

  it('reports wrong credentials and a withdrawn account with the server codes', async () => {
    const s = server([CSRF('t'), [401, { code: 'INVALID_CREDENTIALS' }], [403, { code: 'ACCOUNT_CLOSED' }]])
    const client = createAccountClient({ fetch: s.fetch, base: '' })
    const wrong = await client.login(VIEW.email, 'x').catch((e: unknown) => e)
    expect(wrong).toBeInstanceOf(AccountError)
    expect(accountErrorMessage(wrong, 'login')).toBe('이메일 또는 비밀번호가 맞지 않아요.')
    const closed = await client.login(VIEW.email, 'synthetic-password-12').catch((e: unknown) => e)
    expect((closed as AccountError).code).toBe('ACCOUNT_CLOSED')
    expect(accountErrorMessage(closed, 'login')).toContain('탈퇴한 계정')
    expect(accountErrorMessage(new TypeError('offline'), 'login')).toContain('연결하지 못했어요')
  })

  it('takes 「오늘」 from A4 today, also when asked again on return (ADR 0029)', async () => {
    resetServerClock()
    const s = server([
      [200, { ...VIEW, today: '2026-10-25' }],
      [200, { ...VIEW, today: '2026-10-26' }],
      [401],
    ])
    const client = createAccountClient({ fetch: s.fetch, base: '' })
    await client.me()
    expect(serverToday()).toBe('2026-10-25')
    await client.refreshServerTime?.()
    expect(serverToday()).toBe('2026-10-26')
    // A failed refresh changes neither the day nor the sign-in.
    await client.refreshServerTime?.()
    expect(serverToday()).toBe('2026-10-26')
    expect(client.userId()).toBe('42')
    resetServerClock()
    setServerAuth(null)
  })

  it('treats 401 on /me as signed out and a signed-out logout as done', async () => {
    const s = server([[401, { code: 'UNAUTHENTICATED' }], CSRF('t'), [401, { code: 'UNAUTHENTICATED' }]])
    const client = createAccountClient({ fetch: s.fetch, base: '' })
    expect(await client.me()).toBeNull()
    await expect(client.logout()).resolves.toBeUndefined()
  })

  it('converts optional profile values between this device (left out) and the API (null)', () => {
    expect(toApiProfile({ name: '가', age: 31, occupation: '합성 직업' })).toEqual({ name: '가', age: 31, occupation: '합성 직업' })
    expect(toApiProfile({ name: '가', occupation: '' })).toEqual({ name: '가', age: null, occupation: null })
    expect(fromApiProfile({ name: '가', age: null, occupation: null })).toEqual({ name: '가' })
    expect(fromApiProfile({ name: '가', age: 14, occupation: '직업' })).toEqual({ name: '가', age: 14, occupation: '직업' })
  })

  it('hands the signed-in account and its CSRF token to the other server calls (V3), and clears it on logout', async () => {
    const s = server([CSRF('t1'), [200, VIEW], CSRF('t2'), CSRF('t3'), [204]])
    const client = createAccountClient({ fetch: s.fetch, base: 'https://api.example.invalid' })
    await client.login(VIEW.email, 'synthetic-password-12')
    const auth = getServerAuth()!
    expect(auth.userId).toBe('42')
    // A new login session has a new token; the cached one is fetched once, then a fresh one on request.
    expect(await auth.csrfToken()).toBe('t2')
    expect(await auth.csrfToken(true)).toBe('t3')
    await client.logout()
    expect(getServerAuth()).toBeNull()
    setServerAuth(null)
  })

  it('clears the account when me() finds no login and rejects a malformed me() reply', async () => {
    setServerAuth({ userId: 'old', csrfToken: async () => 'x' })
    const s = server([[401], [200, { user_id: 7 }]])
    const client = createAccountClient({ fetch: s.fetch, base: 'https://api.example.invalid' })
    expect(await client.me()).toBeNull()
    expect(getServerAuth()).toBeNull()
    await expect(client.me()).rejects.toBeInstanceOf(AccountError)
  })
})
