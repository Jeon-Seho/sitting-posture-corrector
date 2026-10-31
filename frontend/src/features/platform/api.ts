import { SERVER } from './serverConfig'
import { getServerAuth } from './serverAuth'

/**
 * One way to call the API (BE api-spec 1장): `/api` prefix, `Authorization: Bearer` access token,
 * `X-PoseGood-User-Id`, 502·503 retried with the same body at 1·2·4 s at most 3 times
 * (api-ws-spec 1.1), 5 s timeout. `retryUnanswered` also retries a request that got no answer.
 * A 401 renews the access token (A8) and sends the request once more — the backup for a renewal
 * timer that ran late in a hidden tab or after sleep (api-ws-spec 1장 「로그인 유지」).
 */
export type ApiErrorKind = 'signed_out' | 'invalid' | 'conflict' | 'not_found' | 'busy' | 'limit' | 'server' | 'network'

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly status: number | null = null,
    /** The `code` of the error body, when the server sent one. */
    readonly code: string | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export type ApiOptions = {
  fetch?: typeof fetch
  timeoutMs?: number
  retries?: number
  retryDelayMs?: number
  /**
   * Also retry when no answer came back (network error, timeout). Only for requests the server
   * treats as the same request when repeated: S1 (same id and body) and B1 (same `registration_id`
   * and coordinates, DB V2.5), api-ws-spec 4장.
   */
  retryUnanswered?: boolean
}

const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_RETRIES = 3
const DEFAULT_RETRY_DELAY_MS = 1000

export function kindOf(status: number): ApiErrorKind {
  if (status === 401 || status === 403) return 'signed_out'
  if (status === 400) return 'invalid'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 429) return 'limit'
  if (status === 503) return 'busy'
  return 'server'
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Sends one request and returns the parsed JSON body (null when empty). `messages` gives the
 * text shown for each failure kind. Non-2xx answers other than retried 502·503 throw ApiError.
 */
export async function apiRequest(
  path: string,
  init: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown },
  messages: Record<ApiErrorKind, string>,
  options: ApiOptions = {},
): Promise<unknown> {
  const method = init.method ?? 'GET'
  const body = init.body === undefined ? undefined : JSON.stringify(init.body)
  const retries = options.retries ?? DEFAULT_RETRIES
  const fetchRequest = options.fetch ?? globalThis.fetch
  let freshToken = false
  const owner = getServerAuth()
  for (let attempt = 0; ; attempt++) {
    const auth = getServerAuth()
    if (!auth || auth !== owner) throw new ApiError('signed_out', messages.signed_out)
    const headers: Record<string, string> = { 'X-PoseGood-User-Id': auth.userId }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    try {
      headers.Authorization = `Bearer ${await auth.accessToken(freshToken)}`
    } catch (caughtError) {
      console.error('[features/platform/api.ts:apiRequest] Operation failed', caughtError)
      // The renewal itself said the login is over (the account client signs out), or no answer.
      throw getServerAuth() ? new ApiError('network', messages.network) : new ApiError('signed_out', messages.signed_out)
    }
    const abort = new AbortController()
    if (getServerAuth() !== owner) throw new ApiError('signed_out', messages.signed_out)
    const timer = setTimeout(() => abort.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetchRequest(`${SERVER.apiBase}/api${path}`, {
        method,
        headers,
        body,
        signal: abort.signal,
        cache: 'no-store',
        // Kept for the refresh cookie on a separate API origin (docs/design/fe-server-proposal.md 9.3.2 A-2).
        credentials: 'include',
      })
    } catch (caughtError) {
      console.error('[features/platform/api.ts:apiRequest] Operation failed', caughtError)
      clearTimeout(timer)
      if (options.retryUnanswered && attempt < retries) {
        await wait((options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS) * 2 ** attempt)
        continue
      }
      throw new ApiError('network', messages.network)
    }
    clearTimeout(timer)
    if (getServerAuth() !== owner) throw new ApiError('signed_out', messages.signed_out)
    if (response.ok) return response.json().catch((caughtError) => {
      console.error('[features/platform/api.ts:apiRequest] Operation failed', caughtError)
      return null
    })
    if ((response.status === 502 || response.status === 503) && attempt < retries) {
      await wait((options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS) * 2 ** attempt)
      continue
    }
    const error = (await response.json().catch((caughtError) => {
      console.error('[features/platform/api.ts:error] Operation failed', caughtError)
      return null
    })) as { code?: unknown } | null
    if (response.status === 401 && !freshToken) {
      freshToken = true
      continue
    }
    const kind = kindOf(response.status)
    throw new ApiError(kind, messages[kind], response.status, typeof error?.code === 'string' ? error.code : null)
  }
}
