import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountApiError, createAccountClient, ACCOUNT_ACCESS_LOST } from './client'
import { accountUser, accountWorkspace, syntheticRecord, USER_A, USER_B } from './testFixtures'
import { validAccountId } from './contracts'
import { validUser, validWorkspace } from './validation'

const json = (value: unknown, status = 200) => Response.json(value, { status })
const token = (value = 'synthetic-token') => json({ header_name: 'X-CSRF-TOKEN', token: value })
const mutationHeaders = (call: unknown[]) => new Headers((call[1] as RequestInit).headers)
function signIn(client: ReturnType<typeof createAccountClient>, method: 'login' | 'register') {
  return method === 'login'
    ? client.login(accountUser.email, 'synthetic-password')
    : client.register({
        email: accountUser.email,
        password: 'synthetic-password',
        profile: accountUser.profile,
        consent_version: 'service-v1',
      })
}
afterEach(() => vi.unstubAllGlobals())

describe('authenticated same-origin API boundary', () => {
  it('gets CSRF before mutation and sends cookies with the server-confirmed identity', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(json(accountWorkspace()))
    const client = createAccountClient(fetch)
    client.setIdentity(USER_A)
    const initial = accountWorkspace()
    await client.updateWorkspace(initial)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/v1/auth/csrf', '/api/v1/workspace'])
    const headers = mutationHeaders(fetch.mock.calls[1])
    expect(headers.get('X-CSRF-TOKEN')).toBe('synthetic-token')
    expect(headers.get('X-PoseGood-User-Id')).toBe(USER_A)
    expect(fetch.mock.calls[1][1]?.credentials).toBe('same-origin')
    expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toEqual({
      profile: initial.profile,
      rules: initial.rules,
      preferences: initial.preferences,
    })
  })

  it('never sends account credentials to a foreign URL or accepts a missing identity', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const client = createAccountClient(fetch)
    await expect(client.fetch('https://synthetic.invalid/api/v1/workspace')).rejects.toThrow(
      '요청 주소',
    )
    await expect(client.workspace()).rejects.toThrow('로그인')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refetches CSRF after login rotates authentication', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(token('before-login'))
      .mockResolvedValueOnce(json(accountUser))
      .mockResolvedValueOnce(token('after-login'))
      .mockResolvedValueOnce(json(accountWorkspace()))
    const client = createAccountClient(fetch)
    await client.login(accountUser.email, 'synthetic-password')
    await client.updateWorkspace(accountWorkspace())
    expect(mutationHeaders(fetch.mock.calls[1]).get('X-CSRF-TOKEN')).toBe('before-login')
    expect(mutationHeaders(fetch.mock.calls[3]).get('X-CSRF-TOKEN')).toBe('after-login')
    expect(mutationHeaders(fetch.mock.calls[3]).get('X-PoseGood-User-Id')).toBe(USER_A)
  })

  it.each(['login', 'register'] as const)(
    'does not revive identity when a late %s response arrives after a boundary reset',
    async (method) => {
      let release!: (response: Response) => void
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(token())
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = resolve
            }),
        )
      const client = createAccountClient(fetch)
      const pending = signIn(client, method)
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
      client.setIdentity(null)
      release(json(accountUser))
      await expect(pending).rejects.toMatchObject({ code: 'AUTH_CHANGED' })
      await expect(client.workspace()).rejects.toMatchObject({ status: 401 })
      expect(fetch).toHaveBeenCalledTimes(2)
    },
  )

  it.each(['login', 'register'] as const)(
    'does not replace a newly confirmed account with a late %s response',
    async (method) => {
      let release!: (response: Response) => void
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(token())
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = resolve
            }),
        )
        .mockResolvedValueOnce(json(accountWorkspace()))
      const client = createAccountClient(fetch)
      const pending = signIn(client, method)
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
      client.setIdentity(USER_B)
      release(json(accountUser))
      await expect(pending).rejects.toMatchObject({ code: 'AUTH_CHANGED' })
      client.assertIdentity(USER_B)
      await client.workspace()
      expect(mutationHeaders(fetch.mock.calls[2]).get('X-PoseGood-User-Id')).toBe(USER_B)
    },
  )

  it('keeps the newer sign-in identity when an older sign-in completes afterward', async () => {
    let release!: (response: Response) => void
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(token())
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve
          }),
      )
      .mockResolvedValueOnce(json({ ...accountUser, user_id: USER_B }))
    const client = createAccountClient(fetch)
    const older = client.login(accountUser.email, 'synthetic-password')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    await client.login('newer-synthetic@example.test', 'synthetic-password')
    release(json(accountUser))
    await expect(older).rejects.toMatchObject({ code: 'AUTH_CHANGED' })
    client.assertIdentity(USER_B)
  })

  it('rejects an identity change while waiting for CSRF before any old-account mutation is sent', async () => {
    let release!: (response: Response) => void
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const client = createAccountClient(fetch)
    client.setIdentity(USER_A)
    const pending = client.updateWorkspace(accountWorkspace())
    client.setIdentity(USER_B)
    release(token())
    await expect(pending).rejects.toMatchObject({ code: 'AUTH_CHANGED' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not send an old mutation after the same account authenticates again during CSRF loading', async () => {
    let release!: (response: Response) => void
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const client = createAccountClient(fetch)
    client.setIdentity(USER_A)
    const pending = client.updateWorkspace(accountWorkspace())
    client.setIdentity(null)
    client.setIdentity(USER_A)
    release(token())
    await expect(pending).rejects.toMatchObject({ code: 'AUTH_CHANGED' })
    client.assertIdentity(USER_A)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not revoke newer authentication when an older request for the same user returns 401', async () => {
    let release!: (response: Response) => void
    const window = new EventTarget()
    const expired = vi.fn()
    window.addEventListener(ACCOUNT_ACCESS_LOST, expired)
    vi.stubGlobal('window', window)
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const client = createAccountClient(fetch)
    client.setIdentity(USER_A)
    const pending = client.workspace()
    client.setIdentity(null)
    client.setIdentity(USER_A)
    release(json({ code: 'UNAUTHENTICATED' }, 401))
    await expect(pending).rejects.toMatchObject({ status: 401 })
    client.assertIdentity(USER_A)
    expect(expired).not.toHaveBeenCalled()
  })

  it('does not turn AUTH_CHANGED into a terminal measurement rejection or accept its response', async () => {
    const window = new EventTarget()
    const expired = vi.fn()
    window.addEventListener(ACCOUNT_ACCESS_LOST, expired)
    vi.stubGlobal('window', window)
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(json({ code: 'AUTH_CHANGED' }, 409))
    const client = createAccountClient(fetch)
    client.setIdentity(USER_A)
    await expect(
      client.fetch('/api/v1/sessions/synthetic', { method: 'PUT', body: '{}' }),
    ).rejects.toBeInstanceOf(AccountApiError)
    expect(expired).toHaveBeenCalledOnce()
    await expect(client.workspace()).rejects.toMatchObject({ status: 401 })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('keeps a wrong current password retryable within the current account', async () => {
    const window = new EventTarget()
    const expired = vi.fn()
    window.addEventListener(ACCOUNT_ACCESS_LOST, expired)
    vi.stubGlobal('window', window)
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(json({ code: 'INVALID_PASSWORD' }, 400))
      .mockResolvedValueOnce(json(accountWorkspace()))
    const client = createAccountClient(fetch)
    client.setIdentity(USER_A)
    await expect(client.password('incorrect', 'synthetic-password')).rejects.toMatchObject({
      status: 400,
    })
    await client.workspace()
    expect(expired).not.toHaveBeenCalled()
  })

  it('clears rejected CSRF for the next manual attempt without retrying the mutation automatically', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(token('old'))
      .mockResolvedValueOnce(json({ code: 'ACCESS_DENIED' }, 403))
      .mockResolvedValueOnce(token('fresh'))
      .mockResolvedValueOnce(json(accountWorkspace()))
    const client = createAccountClient(fetch)
    client.setIdentity(USER_A)
    await expect(client.updateWorkspace(accountWorkspace())).rejects.toMatchObject({ status: 403 })
    expect(fetch).toHaveBeenCalledTimes(2)
    await client.updateWorkspace(accountWorkspace())
    expect(mutationHeaders(fetch.mock.calls[3]).get('X-CSRF-TOKEN')).toBe('fresh')
  })

  it('adopts canonical server dates and JSON key order while requiring exact result values', async () => {
    const record = syntheticRecord()
    const canonical = {
      ...record,
      startedAt: '2026-10-01T00:00:01Z',
      endedAt: '2026-10-01T00:01:01Z',
    }
    const reordered = Object.fromEntries(Object.entries(canonical).reverse())
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(json(reordered))
    const client = createAccountClient(fetch)
    client.setIdentity(USER_A)
    await expect(client.saveRecord(record)).resolves.toEqual(canonical)
    expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toEqual(record)
  })

  it('rejects a changed summary even when the returned record is independently valid', async () => {
    const record = syntheticRecord()
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(json({ ...record, good: 59 }))
    const client = createAccountClient(fetch)
    client.setIdentity(USER_A)
    await expect(client.saveRecord(record)).rejects.toThrow('측정 결과와 일치')
  })
})

describe('DB schema V1.1 account identity', () => {
  it('accepts only the decimal user_account_id and the 30-character display name', () => {
    expect(validAccountId('1')).toBe(true)
    expect(validAccountId('9223372036854775807')).toBe(true)
    for (const value of ['0', '01', '-1', '1.5', '12345678-1234-1234-1234-123456789001', 1])
      expect(validAccountId(value)).toBe(false)
    const user = { user_id: '7', email: 'synthetic@example.test', profile: accountUser.profile }
    expect(validUser(user)).toBe(true)
    expect(validUser({ ...user, profile: { ...user.profile, name: 'x'.repeat(31) } })).toBe(false)
    expect(validWorkspace({ ...accountWorkspace(), preferences: { alerts_on: true } })).toBe(true)
  })
})
