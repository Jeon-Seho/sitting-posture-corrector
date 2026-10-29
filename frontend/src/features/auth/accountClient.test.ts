import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AccountError,
  accountErrorMessage,
  createAccountClient,
  RENEW_BEFORE_MS,
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
/** A2·A3·A8 token fields (BE ADR 0031). */
const TOKEN = (access: string, extra: Record<string, unknown> = {}) => ({
  user_id: '42',
  access_token: access,
  token_type: 'Bearer',
  expires_in: 1800,
  ...extra,
})
const SIGNED_IN = (access: string) => [200, { ...VIEW, ...TOKEN(access) }] as [number, unknown]
const REFRESHED = (access: string, extra: Record<string, unknown> = {}) => [200, TOKEN(access, extra)] as [number, unknown]
const client = (s: ReturnType<typeof server>, extra: { now?: () => number } = {}) =>
  createAccountClient({ fetch: s.fetch, base: '', channel: false, ...extra })

afterEach(() => {
  vi.useRealTimers()
  setServerAuth(null)
})

describe('account server client (D-66, BE ADR 0031 token login, A2–A5·A8)', () => {
  it('cannot restore server authority when a late refresh finishes after developer entry', async () => {
    let reply!: (response: Response) => void
    const fetch = vi.fn(() => new Promise<Response>(resolve => { reply = resolve }))
    const accounts = createAccountClient({ fetch, channel: false })
    const restoring = accounts.me().catch(() => null)
    accounts.suspend!()
    reply(new Response(JSON.stringify(TOKEN('stale'))))
    await restoring
    expect(getServerAuth()).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('signs up without CSRF, with a snake_case body, null optional values and agreed consents only', async () => {
    const s = server([SIGNED_IN('a1')])
    const accounts = createAccountClient({ fetch: s.fetch, base: 'https://api.example.invalid', channel: false })
    const choices = { ...allAgreed(), C3: false }
    const view = await accounts.register({
      email: VIEW.email,
      password: 'synthetic-password-12',
      profile: { name: '합성 가입' },
      consents: consentPayload(choices),
    })
    expect(view.user_id).toBe('42')
    expect(accounts.userId()).toBe('42')
    expect(s.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST https://api.example.invalid/api/v2/auth/register'])
    expect(s.calls[0].headers).not.toHaveProperty('X-CSRF-TOKEN')
    const body = s.calls[0].body as { profile: unknown; consents: { type: string; document_version: string }[] }
    expect(body.profile).toEqual({ name: '합성 가입', age: null, occupation: null })
    expect(body.consents.map((c) => c.type).sort()).toEqual(
      ['ACCOUNT_INFO', 'AGE_14_OVER', 'MEASUREMENT_RECORD', 'POSE_COORDINATES', 'TERMS'],
    )
    expect(new Set(body.consents.map((c) => c.document_version))).toEqual(new Set(['service-v2']))
    expect(await getServerAuth()!.accessToken()).toBe('a1')
  })

  it('hands the access token to the other server calls and drops it on logout', async () => {
    const s = server([SIGNED_IN('a1'), [204]])
    const accounts = client(s)
    await accounts.login(VIEW.email, 'synthetic-password-12')
    const auth = getServerAuth()!
    expect(auth.userId).toBe('42')
    expect(await auth.accessToken()).toBe('a1')
    await accounts.logout()
    expect(s.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /api/v2/auth/login', 'POST /api/v2/auth/logout'])
    expect(s.calls[1].headers).toMatchObject({ Authorization: 'Bearer a1', 'X-PoseGood-User-Id': '42' })
    // The server does not revoke the access token: the app forgets it.
    expect(accounts.userId()).toBeNull()
    expect(getServerAuth()).toBeNull()
    await expect(auth.accessToken()).rejects.toBeInstanceOf(AccountError)
  })

  it('reports wrong credentials and a withdrawn account with the server codes', async () => {
    const s = server([[401, { code: 'INVALID_CREDENTIALS' }], [403, { code: 'ACCOUNT_CLOSED' }]])
    const accounts = client(s)
    const wrong = await accounts.login(VIEW.email, 'x').catch((e: unknown) => e)
    expect(wrong).toBeInstanceOf(AccountError)
    expect(accountErrorMessage(wrong, 'login')).toBe('이메일 또는 비밀번호가 맞지 않아요.')
    const closed = await accounts.login(VIEW.email, 'synthetic-password-12').catch((e: unknown) => e)
    expect((closed as AccountError).code).toBe('ACCOUNT_CLOSED')
    expect(accountErrorMessage(closed, 'login')).toContain('탈퇴한 계정')
    expect(accountErrorMessage(new TypeError('offline'), 'login')).toContain('연결하지 못했어요')
  })

  it('starts by renewing with the refresh cookie (A8) and then asks A4, taking 「오늘」 from both (ADR 0029)', async () => {
    resetServerClock()
    const s = server([
      REFRESHED('a1', { today: '2026-10-25' }),
      [200, { ...VIEW, today: '2026-10-25' }],
      [200, { ...VIEW, today: '2026-10-26' }],
      [401],
      [503],
    ])
    const accounts = client(s)
    expect((await accounts.me())?.user_id).toBe('42')
    expect(s.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /api/v2/auth/refresh', 'GET /api/v2/auth/me'])
    expect(s.calls[0].body).toBeUndefined()
    expect(s.calls[1].headers.Authorization).toBe('Bearer a1')
    expect(serverToday()).toBe('2026-10-25')
    await accounts.refreshServerTime?.()
    expect(serverToday()).toBe('2026-10-26')
    // A4 401 renews once; a renewal without a proper answer (503) changes neither the day nor the sign-in.
    await accounts.refreshServerTime?.()
    expect(s.calls.slice(3).map((c) => c.url)).toEqual(['/api/v2/auth/me', '/api/v2/auth/refresh'])
    expect(serverToday()).toBe('2026-10-26')
    expect(accounts.userId()).toBe('42')
    resetServerClock()
  })

  it('treats a start without a refresh cookie as signed out and a signed-out logout as done', async () => {
    const s = server([[401, { code: 'UNAUTHENTICATED' }], [401, { code: 'UNAUTHENTICATED' }]])
    const accounts = client(s)
    expect(await accounts.me()).toBeNull()
    expect(s.calls.map((c) => c.url)).toEqual(['/api/v2/auth/refresh'])
    await expect(accounts.logout()).resolves.toBeUndefined()
  })

  it('renews a minute and a half before the access token ends, and tries again after no answer', async () => {
    vi.useFakeTimers()
    const s = server([SIGNED_IN('a1'), [503], REFRESHED('a2')])
    const accounts = client(s, { now: () => Date.now() })
    await accounts.login(VIEW.email, 'synthetic-password-12')
    await vi.advanceTimersByTimeAsync(1800_000 - RENEW_BEFORE_MS - 1)
    expect(s.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(s.calls.map((c) => c.url)).toEqual(['/api/v2/auth/login', '/api/v2/auth/refresh'])
    // 503: still signed in, tried again later.
    expect(accounts.userId()).toBe('42')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(s.calls).toHaveLength(3)
    expect(await getServerAuth()!.accessToken()).toBe('a2')
  })

  it('renews once for callers that ask together, and signs out when A8 says the login is over', async () => {
    const s = server([SIGNED_IN('a1'), REFRESHED('a2'), [401, { code: 'UNAUTHENTICATED' }]])
    const accounts = client(s)
    await accounts.login(VIEW.email, 'synthetic-password-12')
    const auth = getServerAuth()!
    expect(await Promise.all([auth.accessToken(true), auth.accessToken(true)])).toEqual(['a2', 'a2'])
    expect(s.calls.filter((c) => c.url.endsWith('/refresh'))).toHaveLength(1)
    await expect(auth.accessToken(true)).rejects.toMatchObject({ status: 401 })
    expect(accounts.userId()).toBeNull()
    expect(getServerAuth()).toBeNull()
  })

  it('renews before handing out a token that is about to end', async () => {
    let clock = 0
    const s = server([SIGNED_IN('a1'), REFRESHED('a2')])
    const accounts = client(s, { now: () => clock })
    await accounts.login(VIEW.email, 'synthetic-password-12')
    clock = 1800_000 - RENEW_BEFORE_MS + 1
    expect(await getServerAuth()!.accessToken()).toBe('a2')
  })

  it('converts optional profile values between this device (left out) and the API (null)', () => {
    expect(toApiProfile({ name: '가', age: 31, occupation: '합성 직업' })).toEqual({ name: '가', age: 31, occupation: '합성 직업' })
    expect(toApiProfile({ name: '가', occupation: '' })).toEqual({ name: '가', age: null, occupation: null })
    expect(fromApiProfile({ name: '가', age: null, occupation: null })).toEqual({ name: '가' })
    expect(fromApiProfile({ name: '가', age: 14, occupation: '직업' })).toEqual({ name: '가', age: 14, occupation: '직업' })
  })

  it('clears the account when me() finds no login and rejects a malformed me() reply', async () => {
    setServerAuth({ userId: 'old', accessToken: async () => 'x' })
    const s = server([[401], REFRESHED('a1'), [200, { user_id: 7 }]])
    const accounts = client(s)
    expect(await accounts.me()).toBeNull()
    expect(getServerAuth()).toBeNull()
    await expect(accounts.me()).rejects.toBeInstanceOf(AccountError)
  })
})
