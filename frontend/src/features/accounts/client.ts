import type { AccountUser, AccountWorkspace, Registration, WorkspaceUpdate } from './contracts'
import type { RecordItem } from '../storage/types'
import { validRecord } from '../storage/validation'
import { sameSnapshot } from '../storage/serverSnapshots'
import { validUser, validWorkspace } from './validation'

export const ACCOUNT_ACCESS_LOST = 'posegood:account-access-lost'
export class AccountApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly code = '',
  ) {
    super(message)
    this.name = 'AccountApiError'
  }
}

function errorMessage(status: number, code: string) {
  if (code === 'AUTH_CHANGED') return '로그인한 계정이 바뀌었습니다. 다시 로그인해 주세요.'
  if (status === 401) return '로그인 정보나 현재 비밀번호를 확인해 주세요.'
  if (status === 403) return '요청을 확인하지 못했습니다. 새로고침한 뒤 다시 시도해 주세요.'
  if (status === 409)
    return '이미 사용 중인 정보이거나 저장된 기록과 충돌합니다. 입력을 확인해 주세요.'
  if (status === 400) return '입력 내용을 확인해 주세요.'
  if (status === 429) return '요청이 많습니다. 잠시 뒤 다시 시도해 주세요.'
  return '서버에 연결하지 못했습니다. 입력은 유지됩니다. 다시 시도해 주세요.'
}

/** Cookie authentication and CSRF are confined to this same-origin API boundary. */
export function createAccountClient(fetchRequest: typeof fetch = globalThis.fetch) {
  let identity: string | null = null
  let authGeneration = 0
  let csrf: Promise<{ header_name: string; token: string }> | null = null
  const protectedPath = (path: string) =>
    /^\/api\/v1\/(workspace|records|sessions)(\/|$)/.test(path) ||
    /^\/api\/v1\/auth\/(logout|password|account)$/.test(path)

  function setIdentity(userId: string | null) {
    authGeneration++
    identity = userId
    csrf = null
  }

  async function csrfToken(signal?: AbortSignal) {
    if (!csrf) {
      csrf = (async () => {
        const response = await fetchRequest('/api/v1/auth/csrf', {
          credentials: 'same-origin',
          cache: 'no-store',
          signal,
        })
        if (!response.ok)
          throw new AccountApiError(errorMessage(response.status, ''), response.status)
        const value = (await response.json()) as { header_name?: unknown; token?: unknown }
        if (
          value.header_name !== 'X-CSRF-TOKEN' ||
          typeof value.token !== 'string' ||
          value.token.length === 0 ||
          value.token.length > 4096
        )
          throw new AccountApiError('요청 확인 응답을 읽지 못했습니다.')
        return { header_name: value.header_name, token: value.token }
      })().catch((error) => {
        csrf = null
        throw error
      })
    }
    return csrf
  }

  async function fetchAuthenticated(input: RequestInfo | URL, init: RequestInit = {}) {
    if (typeof input !== 'string' || !input.startsWith('/api/v1/'))
      throw new AccountApiError('올바르지 않은 요청 주소입니다.')
    const owner = identity
    const ownerGeneration = authGeneration
    const protectedRequest = protectedPath(input)
    if (protectedRequest && !owner) throw new AccountApiError('먼저 로그인해 주세요.', 401)
    const headers = new Headers(init.headers)
    const method = (init.method ?? 'GET').toUpperCase()
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const token = await csrfToken(init.signal ?? undefined)
      headers.set(token.header_name, token.token)
    }
    if (protectedRequest) {
      if (owner !== identity || ownerGeneration !== authGeneration)
        throw new AccountApiError('로그인한 계정이 바뀌었습니다.', 409, 'AUTH_CHANGED')
      headers.set('X-PoseGood-User-Id', owner!)
    }
    const response = await fetchRequest(input, {
      ...init,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
    })
    if (response.status === 403) csrf = null // The next manual attempt obtains a fresh token.
    if (!response.ok && protectedRequest) {
      const error = (await response
        .clone()
        .json()
        .catch(() => ({}))) as { code?: unknown }
      if (response.status === 401 || error.code === 'AUTH_CHANGED') {
        // Throw instead of returning terminal 409 to the measurement queue: its original body stays durable.
        if (owner === identity && ownerGeneration === authGeneration) {
          setIdentity(null)
          if (typeof window !== 'undefined') window.dispatchEvent(new Event(ACCOUNT_ACCESS_LOST))
        }
        throw new AccountApiError(
          errorMessage(response.status, String(error.code ?? '')),
          response.status,
          String(error.code ?? ''),
        )
      }
    }
    return response
  }

  async function request(path: string, method = 'GET', body?: unknown, signal?: AbortSignal) {
    const abort = new AbortController()
    const cancel = () => abort.abort()
    if (signal?.aborted) cancel()
    signal?.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(cancel, 10000)
    try {
      const response = await fetchAuthenticated(`/api/v1/${path}`, {
        method,
        signal: abort.signal,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!response.ok) {
        const value = (await response.json().catch(() => ({}))) as { code?: unknown }
        const code = typeof value.code === 'string' ? value.code : ''
        throw new AccountApiError(errorMessage(response.status, code), response.status, code)
      }
      return response.status === 204 ? null : ((await response.json()) as unknown)
    } catch (error) {
      if (error instanceof AccountApiError) throw error
      if (signal?.aborted) throw error
      throw new AccountApiError(
        '서버 응답을 확인하지 못했습니다. 같은 내용으로 다시 시도해 주세요.',
      )
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
    }
  }

  const userResponse = (value: unknown): AccountUser => {
    if (!validUser(value)) throw new AccountApiError('계정 응답을 읽지 못했습니다.')
    return value
  }
  const workspaceResponse = (value: unknown): AccountWorkspace => {
    if (!validWorkspace(value))
      throw new AccountApiError('저장된 자료를 읽지 못했습니다. 기존 자료는 유지됩니다.')
    return value
  }

  async function authenticate(path: 'auth/login' | 'auth/register', body: unknown) {
    const attempt = ++authGeneration
    const user = userResponse(await request(path, 'POST', body))
    // A boundary reset or newer sign-in invalidates this result, even if its HTTP request succeeded.
    if (attempt !== authGeneration)
      throw new AccountApiError(
        '로그인 확인 중 계정이 바뀌었습니다. 다시 로그인해 주세요.',
        409,
        'AUTH_CHANGED',
      )
    identity = user.user_id
    csrf = null
    return user
  }

  return {
    fetch: fetchAuthenticated as typeof fetch,
    assertIdentity(userId: string) {
      if (identity !== userId)
        throw new AccountApiError(
          '로그인한 계정이 바뀌었습니다. 다시 로그인해 주세요.',
          409,
          'AUTH_CHANGED',
        )
    },
    setIdentity,
    async me(signal?: AbortSignal) {
      return userResponse(await request('auth/me', 'GET', undefined, signal))
    },
    login(email: string, password: string) {
      return authenticate('auth/login', { email, password })
    },
    register(value: Registration) {
      return authenticate('auth/register', value)
    },
    async logout() {
      await request('auth/logout', 'POST')
      setIdentity(null)
    },
    async password(current_password: string, new_password: string) {
      await request('auth/password', 'PUT', { current_password, new_password })
      csrf = null
    },
    async deleteAccount(password: string) {
      await request('auth/account', 'DELETE', { password })
      setIdentity(null)
    },
    async workspace(signal?: AbortSignal) {
      return workspaceResponse(await request('workspace', 'GET', undefined, signal))
    },
    async updateWorkspace(value: WorkspaceUpdate) {
      return workspaceResponse(
        await request('workspace', 'PUT', {
          profile: value.profile,
          rules: value.rules,
          preferences: value.preferences,
        }),
      )
    },
    async saveRecord(record: RecordItem) {
      const value = await request('records', 'POST', record)
      if (
        !validRecord(value) ||
        !sameSnapshot(value, {
          ...record,
          startedAt: value.startedAt,
          endedAt: value.endedAt,
        })
      )
        throw new AccountApiError('저장 확인 응답이 측정 결과와 일치하지 않습니다.')
      return value
    },
    async records() {
      const value = await request('records')
      if (!Array.isArray(value) || !value.every(validRecord))
        throw new AccountApiError('기록 응답을 읽지 못했습니다.')
      return value as RecordItem[]
    },
  }
}

export const accountClient = createAccountClient()
export const SERVER_ACCOUNTS = import.meta.env.VITE_SERVER_ACCOUNTS === 'true'
export const accountError = (error: unknown) =>
  error instanceof AccountApiError ? error.message : '처리하지 못했습니다. 다시 시도해 주세요.'
