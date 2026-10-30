/** Proposed backend contract; disabled until a same-origin account API is deployed. */
export type MailPurpose = 'reset' | 'verify'
export class MailApiError extends Error {
  constructor(public code: string, message: string) { super(message) }
}

export function newPasswordValid(value: string) {
  return value.length >= 12 && new TextEncoder().encode(value).length <= 72
}

export function mailRoute(hash: string): { purpose: MailPurpose; token: string } | null {
  const [path, query = ''] = hash.replace(/^#/, '').split('?')
  if (path !== 'password-reset' && path !== 'verify-email') return null
  const token = new URLSearchParams(query).get('token') ?? ''
  return { purpose: path === 'password-reset' ? 'reset' : 'verify', token: token.length <= 512 ? token : '' }
}

export function createMailApi({ enabled = false, fetcher = fetch }: { enabled?: boolean; fetcher?: typeof fetch } = {}) {
  async function post(path: string, body: Record<string, string>, signal?: AbortSignal) {
    if (!enabled) throw new MailApiError('NOT_CONNECTED', '메일 인증 서버 연결을 준비 중이에요. 현재 기기 안의 계정에는 적용되지 않아요.')
    const deadline = AbortSignal.timeout(15_000)
    const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
    try {
      // No CSRF since the token login (BE ADR 0031, 2026-10-27): these routes need no sign-in.
      const response = await fetcher(`/api/v2/auth/${path}`, {
        method: 'POST', credentials: 'same-origin', signal: requestSignal, cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (response.ok) return
      if (response.status === 429) throw new MailApiError('RATE_LIMITED', '요청이 많아요. 잠시 기다린 뒤 다시 시도해 주세요.')
      if (response.status === 400 || response.status === 410) throw new MailApiError('INVALID_TOKEN', '링크가 만료됐거나 이미 사용됐어요. 새 메일을 요청해 주세요.')
      throw new MailApiError('UNAVAILABLE', '요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.')
    } catch (error) {
      console.error('[features/auth/mailApi.ts:post] Operation failed', error)
      if (signal?.aborted || error instanceof MailApiError) throw error
      throw new MailApiError('UNAVAILABLE', '네트워크 연결을 확인한 뒤 다시 시도해 주세요.')
    }
  }
  return {
    enabled,
    request: (purpose: MailPurpose, email: string, signal?: AbortSignal) =>
      post(purpose === 'reset' ? 'password-reset/requests' : 'email-verification/requests', { email: email.trim().toLowerCase() }, signal),
    reset: (token: string, password: string, signal?: AbortSignal) => post('password-reset/confirm', { token, new_password: password }, signal),
    verify: (token: string, signal?: AbortSignal) => post('email-verification/confirm', { token }, signal),
  }
}

export const accountMailApi = createMailApi({ enabled: import.meta.env.VITE_ACCOUNT_MAIL_API_ENABLED === 'true' })
