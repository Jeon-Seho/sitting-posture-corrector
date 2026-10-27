import { SERVER } from '../platform/serverConfig'
import { getServerAuth, setServerAuth } from '../platform/serverAuth'
import { noteServerDay } from '../platform/serverClock'
import type { Profile } from '../storage/types'
import type { ConsentType } from './consents'

/**
 * Account server client (D-66, FE proposal F12, plan 0027 2절; BE ADR 0031 token login).
 * Sign-up, sign-in, sign-out, "who am I" and keeping the login (A2–A5, A8). Password change,
 * withdrawal and the optional-profile consent stay on later steps.
 *
 * - The access token (30 min) lives in memory only and goes out as `Authorization: Bearer`. The
 *   refresh token (14 days) is an HttpOnly cookie the app never reads; requests keep
 *   `credentials: 'include'` so A8 gets it.
 * - The access token is renewed (A8) a minute and a half before it ends, and on a 401 as a backup.
 *   One renewal at a time: callers wait for the one in flight. An A8 401 means the login is over
 *   (sign-out); no answer or a 5xx keeps the login and tries again later.
 * - On start the app has no token, so `me` renews first (A8) and then asks A4.
 * - Tabs share a new token over `BroadcastChannel`, so they do not each renew.
 * - Logout sends the signed-in `user_id` as `X-PoseGood-User-Id`; another tab that switched
 *   accounts gets `409 AUTH_CHANGED`. B1·B2·S1·S4 (`features/platform/api.ts`) get the token
 *   through `setServerAuth`.
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
  /**
   * A4 only for the server's time (when the app window comes back, ADR 0029). Changes nothing
   * about the sign-in, and a failure is ignored.
   */
  refreshServerTime?: () => Promise<void>
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

/** Renew this long before the access token ends (BE: 1~2 min). */
export const RENEW_BEFORE_MS = 90_000
/** After a renewal that got no answer, try again this much later. */
const RENEW_RETRY_MS = 30_000
const CHANNEL = 'posegood-auth'

type Login = { userId: string; token: string; expiresAt: number }
type TokenMessage = { type: 'token'; userId: string; token: string; expiresAt: number }

export function createAccountClient(
  options: { fetch?: typeof fetch; base?: string; timeoutMs?: number; now?: () => number; channel?: boolean } = {},
): AccountClient {
  const fetchRequest = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init))
  const base = `${options.base ?? SERVER.apiBase}/api/v2/auth`
  const timeoutMs = options.timeoutMs ?? 10000
  const now = options.now ?? Date.now
  let login: Login | null = null
  let user: string | null = null
  let renewing: Promise<string> | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const channel =
    options.channel !== false && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null
  channel?.addEventListener('message', (event: MessageEvent<TokenMessage>) => {
    const message = event.data
    // Another tab renewed the same account's token: use it instead of renewing here too.
    if (message?.type === 'token' && login && message.userId === login.userId && message.expiresAt > login.expiresAt)
      keep({ userId: message.userId, token: message.token, expiresAt: message.expiresAt }, false)
  })

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
    // A2·A3·A4·A8 carry the server's KST day: it decides 「오늘」 (BE-6, ADR 0029).
    if (payload && typeof payload === 'object' && 'today' in payload) noteServerDay((payload as { today: unknown }).today)
    if (!response.ok) {
      const code = payload && typeof payload === 'object' && 'code' in payload ? String((payload as { code: unknown }).code) : null
      throw new AccountError(`계정 요청 실패 (${response.status})`, response.status, code)
    }
    return payload
  }

  /** Keeps a new access token and plans its renewal. */
  function keep(next: Login, share = true) {
    login = next
    plan(next.expiresAt - RENEW_BEFORE_MS - now())
    if (share) channel?.postMessage({ type: 'token', ...next } satisfies TokenMessage)
    signIn(next.userId)
  }

  function plan(delayMs: number) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      renew().catch((error) => {
        // No answer or a 5xx: still signed in, try again (a 401 already signed out).
        if (login && !(error instanceof AccountError && error.status === 401)) plan(RENEW_RETRY_MS)
      })
    }, Math.max(0, delayMs))
  }

  /** The token fields of A2·A3·A8. */
  function tokenOf(payload: unknown): Login {
    const body = payload as { user_id?: unknown; access_token?: unknown; expires_in?: unknown } | null
    if (
      !body ||
      typeof body.user_id !== 'string' ||
      typeof body.access_token !== 'string' ||
      !body.access_token ||
      typeof body.expires_in !== 'number' ||
      !(body.expires_in > 0)
    )
      throw new AccountError('계정 응답 형식이 달라요.', null, null)
    return { userId: body.user_id, token: body.access_token, expiresAt: now() + body.expires_in * 1000 }
  }

  /** A8, one at a time. A 401 ends the login here. */
  function renew(): Promise<string> {
    if (!renewing)
      renewing = (async () => {
        try {
          const next = tokenOf(await send('/refresh', 'POST'))
          keep(next)
          return next.token
        } catch (error) {
          if (error instanceof AccountError && error.status === 401) signOut()
          throw error
        } finally {
          renewing = null
        }
      })()
    return renewing
  }

  async function accessToken(fresh = false) {
    if (!login) throw new AccountError('로그인이 필요해요.', 401, null)
    if (fresh || login.expiresAt - now() < RENEW_BEFORE_MS) return renew()
    return login.token
  }

  /** A call with the access token; a 401 renews once and sends again. */
  async function authed(path: string, method: string) {
    for (let fresh = false; ; fresh = true) {
      const token = await accessToken(fresh)
      try {
        return await send(path, method, undefined, { Authorization: `Bearer ${token}` })
      } catch (error) {
        if (!fresh && error instanceof AccountError && error.status === 401) continue
        throw error
      }
    }
  }

  function viewOf(payload: unknown): AccountView {
    const view = payload as AccountView | null
    if (!view || typeof view.user_id !== 'string' || !view.profile || typeof view.profile.name !== 'string')
      throw new AccountError('계정 응답 형식이 달라요.', null, null)
    return view
  }

  function signedIn(payload: unknown): AccountView {
    const view = viewOf(payload)
    keep(tokenOf(payload))
    return view
  }

  /** The account the other server calls use (B1·B2·S1·S4); null when signed out. */
  function signIn(userId: string | null) {
    // A renewed token is read through `accessToken`; only a change of account tells the listeners.
    if (userId === user && (getServerAuth()?.userId ?? null) === userId) return
    user = userId
    setServerAuth(userId ? { userId, accessToken } : null)
  }

  function signOut() {
    login = null
    if (timer) clearTimeout(timer)
    timer = null
    signIn(null)
  }

  return {
    async me() {
      try {
        // Started without a token (it lives in memory): the refresh cookie gets one first.
        if (!login) await renew()
        const view = viewOf(await authed('/me', 'GET'))
        signIn(view.user_id)
        return view
      } catch (error) {
        if (error instanceof AccountError && error.status === 401) {
          signOut()
          return null
        }
        throw error
      }
    },
    async register(input) {
      return signedIn(
        await send('/register', 'POST', {
          email: input.email,
          password: input.password,
          profile: toApiProfile(input.profile),
          consents: input.consents,
        }),
      )
    },
    async login(email, password) {
      return signedIn(await send('/login', 'POST', { email, password }))
    },
    async logout() {
      const headers: Record<string, string> = {}
      if (login) headers.Authorization = `Bearer ${login.token}`
      if (user) headers['X-PoseGood-User-Id'] = user
      try {
        await send('/logout', 'POST', undefined, headers)
      } catch (error) {
        // Already signed out on the server: nothing left to end.
        if (!(error instanceof AccountError && error.status === 401)) throw error
      } finally {
        // The server does not revoke the access token (BE ADR 0031): drop it here.
        signOut()
      }
    },
    userId: () => user,
    async refreshServerTime() {
      if (!login) return
      try {
        await authed('/me', 'GET')
      } catch {
        /* Signed out or offline: 「오늘」 stays as it was. */
      }
    },
  }
}
