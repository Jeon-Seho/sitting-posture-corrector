import { SERVER } from '../platform/serverConfig'
import type { Profile } from '../storage/types'
import type { ConsentType } from './consents'

/**
 * Account server client (D-66, FE proposal F12, plan 0027 2절; contract contracts/accounts.v2.md).
 * Only sign-up, sign-in, sign-out and "who am I" (A1–A5). Password change, withdrawal and the
 * optional-profile consent stay on later steps.
 *
 * - The login cookie is HttpOnly and lives in the DB; requests carry it with `credentials: 'include'`.
 * - Every write sends `X-CSRF-TOKEN` from `GET /v2/auth/csrf`. The server issues a new token at
 *   login and logout, so the cached token is dropped then; a 403 (stale token) is retried once.
 * - Protected writes (here only logout) also send the signed-in `user_id` as `X-PoseGood-User-Id`;
 *   another tab that switched accounts gets `409 AUTH_CHANGED`.
 */
export type ApiProfile = { name: string; age: number | null; occupation: string | null }
export type AccountView = { user_id: string; email: string; profile: ApiProfile }
export type RegisterInput = {
  email: string
  password: string
  profile: Profile
  consents: { type: ConsentType; document_version: string }[]
}

export class AccountError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(message)
    this.name = 'AccountError'
  }
}

export type AccountClient = {
  /** A4: the signed-in account, or null when not signed in (401). */
  me: () => Promise<AccountView | null>
  /** A2: creates the account and signs in. */
  register: (input: RegisterInput) => Promise<AccountView>
  /** A3. */
  login: (email: string, password: string) => Promise<AccountView>
  /** A5. Ends the server login even if this tab no longer matches it. */
  logout: () => Promise<void>
  /** The `user_id` of the last successful me/register/login, null after logout. */
  userId: () => string | null
}

/** Profile on this device (optional values left out) ↔ API (`null`). */
export function toApiProfile(profile: Profile): ApiProfile {
  return {
    name: profile.name,
    age: profile.age ?? null,
    occupation: profile.occupation ? profile.occupation : null,
  }
}

export function fromApiProfile(profile: ApiProfile): Profile {
  const next: Profile = { name: profile.name }
  if (profile.age !== null) next.age = profile.age
  if (profile.occupation !== null) next.occupation = profile.occupation
  return next
}

/** What the sign-in and sign-up screens show for a failed request. */
export function accountErrorMessage(error: unknown, action: 'login' | 'register') {
  if (!(error instanceof AccountError)) return '계정 서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
  if (error.code === 'INVALID_CREDENTIALS') return '이메일 또는 비밀번호가 맞지 않아요.'
  if (error.code === 'ACCOUNT_CLOSED') return '탈퇴한 계정입니다. 되돌릴 수 없고 탈퇴 30일 뒤 삭제됩니다.'
  if (error.code === 'ACCOUNT_EXISTS') return '가입할 수 없는 이메일이에요. 이미 가입했거나 탈퇴 후 30일이 지나지 않았어요.'
  if (error.code === 'CONSENT_REQUIRED') return '필수 약관 동의를 다시 확인해 주세요.'
  if (error.status === 400)
    return action === 'register'
      ? '입력 값을 확인해 주세요. 비밀번호는 12자 이상, 이름은 30자 이하, 나이는 14~120이에요.'
      : '이메일과 비밀번호를 확인해 주세요.'
  if (error.status === 503) return '계정 서버가 바빠요. 잠시 뒤 다시 시도해 주세요.'
  return `계정 요청에 실패했어요 (${error.status ?? '응답 없음'}).`
}

export function createAccountClient(
  options: { fetch?: typeof fetch; base?: string; timeoutMs?: number } = {},
): AccountClient {
  const fetchRequest = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init))
  const base = `${options.base ?? SERVER.apiBase}/api/v2/auth`
  const timeoutMs = options.timeoutMs ?? 10000
  let csrf: string | null = null
  let user: string | null = null

  async function send(path: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), timeoutMs)
    let response: Response
    try {
      response = await fetchRequest(`${base}${path}`, {
        method,
        headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
        credentials: 'include',
        signal: abort.signal,
      })
    } catch {
      throw new AccountError('계정 서버에 연결하지 못했어요.', null, null)
    } finally {
      clearTimeout(timer)
    }
    let payload: unknown = null
    const text = await response.text()
    if (text) {
      try {
        payload = JSON.parse(text)
      } catch {
        payload = null
      }
    }
    if (!response.ok) {
      const code = payload && typeof payload === 'object' && 'code' in payload ? String((payload as { code: unknown }).code) : null
      throw new AccountError(`계정 요청 실패 (${response.status})`, response.status, code)
    }
    return payload
  }

  async function token() {
    if (csrf) return csrf
    const body = (await send('/csrf', 'GET')) as { token?: unknown } | null
    if (!body || typeof body.token !== 'string') throw new AccountError('CSRF 토큰을 받지 못했어요.', null, null)
    csrf = body.token
    return csrf
  }

  /** A write with the CSRF token; a stale token (403 ACCESS_DENIED) is replaced once. */
  async function write(path: string, body?: unknown, extra: Record<string, string> = {}) {
    for (let attempt = 0; ; attempt++) {
      const headers = { ...extra, 'X-CSRF-TOKEN': await token() }
      try {
        return await send(path, 'POST', body, headers)
      } catch (error) {
        if (attempt === 0 && error instanceof AccountError && error.status === 403 && error.code === 'ACCESS_DENIED') {
          csrf = null
          continue
        }
        throw error
      }
    }
  }

  function signedIn(payload: unknown): AccountView {
    const view = payload as AccountView | null
    if (!view || typeof view.user_id !== 'string' || !view.profile || typeof view.profile.name !== 'string')
      throw new AccountError('계정 응답 형식이 달라요.', null, null)
    user = view.user_id
    // The server stores a new CSRF token with the new login session.
    csrf = null
    return view
  }

  return {
    async me() {
      try {
        const payload = await send('/me', 'GET')
        const view = payload as AccountView
        user = view.user_id
        return view
      } catch (error) {
        if (error instanceof AccountError && error.status === 401) {
          user = null
          return null
        }
        throw error
      }
    },
    async register(input) {
      return signedIn(
        await write('/register', {
          email: input.email,
          password: input.password,
          profile: toApiProfile(input.profile),
          consents: input.consents,
        }),
      )
    },
    async login(email, password) {
      return signedIn(await write('/login', { email, password }))
    },
    async logout() {
      const headers: Record<string, string> = user ? { 'X-PoseGood-User-Id': user } : {}
      try {
        await write('/logout', undefined, headers)
      } catch (error) {
        // Already signed out on the server (expired login): nothing left to end.
        if (!(error instanceof AccountError && error.status === 401)) throw error
      } finally {
        user = null
        csrf = null
      }
    },
    userId: () => user,
  }
}
