import { SERVER } from './serverConfig'
import { getServerAuth } from './serverAuth'

/**
 * One way to call the API (BE api-spec 1장): `/api` prefix, login cookie, `X-PoseGood-User-Id`,
 * `X-CSRF-TOKEN` on writes, 502·503 retried with the same body at 1·2·4 s at most 3 times
 * (api-ws-spec 1.1), 5 s timeout.
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
  for (let attempt = 0; ; attempt++) {
    const auth = getServerAuth()
    if (!auth) throw new ApiError('signed_out', messages.signed_out)
    const headers: Record<string, string> = { 'X-PoseGood-User-Id': auth.userId }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (method !== 'GET') {
      try {
        headers['X-CSRF-TOKEN'] = await auth.csrfToken()
      } catch {
        throw new ApiError('network', messages.network)
      }
    }
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetchRequest(`${SERVER.apiBase}/api${path}`, {
        method,
        headers,
        body,
        signal: abort.signal,
        cache: 'no-store',
        // The login cookie must also reach a separate API origin (docs/design/fe-deploy.md 3.2 A-2).
        credentials: 'include',
      })
    } catch {
      throw new ApiError('network', messages.network)
    } finally {
      clearTimeout(timer)
    }
    if (response.ok) return response.json().catch(() => null)
    if ((response.status === 502 || response.status === 503) && attempt < retries) {
      await wait((options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS) * 2 ** attempt)
      continue
    }
    const error = (await response.json().catch(() => null)) as { code?: unknown } | null
    const kind = kindOf(response.status)
    throw new ApiError(kind, messages[kind], response.status, typeof error?.code === 'string' ? error.code : null)
  }
}
