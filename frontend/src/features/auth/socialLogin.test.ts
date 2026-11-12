import { describe, expect, it, vi } from 'vitest'
import { createAccountClient, discordAuthorizeUrl } from './accountClient'
import { createMailApi } from './mailApi'
import { discordLoginEnabled, socialResultMessage, socialRoute } from './socialLogin'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('Discord sign-in routes', () => {
  it('reads only a result status or the sign-up step from the fragment', () => {
    expect(socialRoute('#social-result?status=linked')).toEqual({ kind: 'result', status: 'linked' })
    expect(socialRoute('#social-signup')).toEqual({ kind: 'signup' })
    expect(socialRoute('#social-result?status=<script>')).toEqual({ kind: 'result', status: 'failed' })
    expect(socialRoute('#password-reset?token=x')).toBeNull()
  })

  it('says nothing after a sign-in and explains every other result', () => {
    expect(socialResultMessage('signed-in')).toBeNull()
    for (const status of ['linked', 'link-required', 'email-required', 'in-use', 'closed', 'cancelled', 'expired', 'other'])
      expect(socialResultMessage(status)).toEqual(expect.any(String))
    expect(socialResultMessage('link-required')).toContain('로그인한 뒤')
  })

  it('is off unless the build turns it on', () => {
    expect(discordLoginEnabled(undefined)).toBe(false)
    expect(discordLoginEnabled('true')).toBe(true)
  })

  it('opens only a Discord consent page from the server answer', () => {
    expect(discordAuthorizeUrl({ authorize_url: 'https://discord.com/oauth2/authorize?state=s' })).toContain('discord.com')
    for (const url of ['http://discord.com/oauth2/authorize', 'https://evil.example/oauth2', 'javascript:alert(1)', 42])
      expect(() => discordAuthorizeUrl({ authorize_url: url })).toThrow()
  })
})

describe('account client social calls', () => {
  it('starts sign-in without a token and links with the access token', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ authorize_url: 'https://discord.com/oauth2/authorize?state=a' }))
      .mockResolvedValueOnce(json({ user_id: '1', access_token: 'access-1', token_type: 'Bearer', expires_in: 1800, today: '2026-11-11' }))
      .mockResolvedValueOnce(json({ user_id: '1', email: 'a@example.test', profile: { name: '시험', age: null, occupation: null }, today: '2026-11-11' }))
      .mockResolvedValueOnce(json({ authorize_url: 'https://discord.com/oauth2/authorize?state=b' }))
    const client = createAccountClient({ fetch, channel: false })
    await client.social!.startLogin()
    expect(fetch.mock.calls[0][0]).toBe('/api/auth/social/discord/login')
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined()
    await client.me()
    await client.social!.startLink()
    expect(fetch.mock.calls[3][0]).toBe('/api/auth/social/discord/link')
    expect(fetch.mock.calls[3][1].headers.Authorization).toBe('Bearer access-1')
  })

  it('treats an expired sign-up as nothing to continue', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ code: 'SOCIAL_SIGNUP_EXPIRED' }, 410))
    await expect(createAccountClient({ fetch, channel: false }).social!.signupDraft()).resolves.toBeNull()
  })

  it('finishes the sign-up without sending an email or password', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({
      user_id: '9', email: 'd@example.test', profile: { name: '디코', age: null, occupation: null }, today: '2026-11-11',
      access_token: 'access-9', token_type: 'Bearer', expires_in: 1800,
    }))
    const client = createAccountClient({ fetch, channel: false })
    const view = await client.social!.signup({ profile: { name: '디코' }, consents: [] })
    expect(view.email).toBe('d@example.test')
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body).toEqual({ profile: { name: '디코', age: null, occupation: null }, consents: [] })
    expect(client.userId()).toBe('9')
  })
})

describe('password reset switch', () => {
  it('turns reset on without turning on the email verification that has no server route', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
    const api = createMailApi({ resetEnabled: true, fetcher, base: 'https://api.example.test' })
    expect(api.enabledFor('reset')).toBe(true)
    expect(api.enabledFor('verify')).toBe(false)
    await api.request('reset', 'a@example.test')
    expect(fetcher.mock.calls[0][0]).toBe('https://api.example.test/api/auth/password-reset/requests')
    await expect(api.request('verify', 'a@example.test')).rejects.toMatchObject({ code: 'NOT_CONNECTED' })
  })

  it('reports a server with the route off as not connected', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    await expect(createMailApi({ resetEnabled: true, fetcher }).request('reset', 'a@example.test'))
      .rejects.toMatchObject({ code: 'NOT_CONNECTED' })
  })
})
