import { describe, expect, it, vi } from 'vitest'
import { createMailApi, mailRoute, newPasswordValid } from './mailApi'

describe('future mail API connection', () => {
  it('does not make a request or claim success before backend activation', async () => {
    const fetcher = vi.fn()
    await expect(createMailApi({ fetcher }).request('reset', 'a@example.com')).rejects.toMatchObject({ code: 'NOT_CONNECTED' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('normalizes the email and sends CSRF on the reset request', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ token: 'synthetic-csrf' })))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
    await createMailApi({ enabled: true, fetcher }).request('reset', ' A@Example.com ')
    expect(fetcher.mock.calls[1]).toEqual(['/api/v2/auth/password-reset/requests', expect.objectContaining({
      body: JSON.stringify({ email: 'a@example.com' }), credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': 'synthetic-csrf' },
    })])
  })
  it.each([400, 410, 429, 500])('returns bounded error messages for HTTP %s', async status => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ token: 'csrf' })))
      .mockResolvedValueOnce(new Response('private server detail', { status }))
    await expect(createMailApi({ enabled: true, fetcher }).verify('synthetic-token')).rejects.not.toThrow('private server detail')
  })
  it('stops before posting when CSRF is unavailable', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 503 }))
    await expect(createMailApi({ enabled: true, fetcher }).reset('token', 'new-password')).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('sends the proposed reset body without placing the bearer token in a URL', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ token: 'csrf' })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    await createMailApi({ enabled: true, fetcher }).reset('synthetic-secret', 'new-password')
    expect(fetcher.mock.calls[1][0]).not.toContain('synthetic-secret')
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ token: 'synthetic-secret', new_password: 'new-password' })
  })
  it('separates email confirmation from password reset links and ignores unrelated routes', () => {
    expect(mailRoute('#password-reset?token=example-token')).toEqual({ purpose: 'reset', token: 'example-token' })
    expect(mailRoute('#verify-email?token=example-token')).toEqual({ purpose: 'verify', token: 'example-token' })
    expect(mailRoute('#collection')).toBeNull()
    expect(mailRoute('#password-reset?token=' + 'x'.repeat(513))?.token).toBe('')
  })
  it('uses the server password length and UTF-8 byte limits for new passwords', () => {
    expect(newPasswordValid('x'.repeat(11))).toBe(false)
    expect(newPasswordValid('x'.repeat(12))).toBe(true)
    expect(newPasswordValid('가'.repeat(24))).toBe(true)
    expect(newPasswordValid('가'.repeat(25))).toBe(false)
  })
})
