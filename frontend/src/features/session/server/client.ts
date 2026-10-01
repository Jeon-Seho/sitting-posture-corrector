import type { Rules } from '../../../lib/engine'
import type { ServerObservation, ServerPendingRequest, SessionView } from './contracts'
import { validFeatureResponse, validSessionView } from './validation'
import { accountClient, SERVER_ACCOUNTS } from '../../accounts/client'

export type ServerReply = { view: SessionView; observation?: ServerObservation }
export type SessionClient = {
  send: (request: ServerPendingRequest, signal: AbortSignal) => Promise<ServerReply>
  get: (signal: AbortSignal) => Promise<SessionView>
}

export class ServerRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message)
    this.name = 'ServerRequestError'
  }
}

/** A timeout cannot establish whether the server accepted a mutation. Its caller retains the body. */
export function createSessionClient(
  id: string,
  rules: Rules,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): SessionClient {
  const fetchRequest = options.fetch ?? (SERVER_ACCOUNTS ? accountClient.fetch : globalThis.fetch)
  const timeoutMs = options.timeoutMs ?? 5000
  const base = `/api/v1/sessions/${encodeURIComponent(id)}`

  async function request(path: string, signal: AbortSignal, method = 'GET', body?: unknown) {
    const abort = new AbortController()
    const cancel = () => abort.abort()
    if (signal.aborted) cancel()
    signal.addEventListener('abort', cancel, { once: true })
    let expired = false
    const timer = setTimeout(() => {
      expired = true
      abort.abort()
    }, timeoutMs)
    try {
      const response = await fetchRequest(path, {
        method,
        signal: abort.signal,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
        credentials: 'omit',
      })
      if (!response.ok) {
        const message =
          response.status === 404
            ? '서버에서 이 세션을 찾지 못했습니다. 서버 재시작으로 세션이 사라졌을 수 있습니다.'
            : response.status === 409
              ? '서버 요청 순서나 고정 설정이 충돌했습니다. 현재 기록을 보존하고 측정을 중단했습니다.'
              : response.status === 429
                ? '개발용 서버 관측·세션 한도에 도달했습니다. 현재 기록을 보존했습니다.'
                : `서버 요청에 실패했습니다 (${response.status}). 같은 요청을 다시 시도할 수 있습니다.`
        throw new ServerRequestError(message, response.status)
      }
      return (await response.json()) as unknown
    } catch (error) {
      if (error instanceof ServerRequestError) throw error
      if (signal.aborted) throw new ServerRequestError('요청을 중단했습니다.')
      if (expired)
        throw new ServerRequestError(
          '서버 응답 시간이 초과되었습니다. 처리 여부가 확인되지 않아 같은 요청을 유지합니다.',
        )
      throw new ServerRequestError(
        '서버에 연결하지 못했습니다. 입력을 멈추고 같은 요청을 유지합니다.',
      )
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
    }
  }

  return {
    async get(signal) {
      const value = await request(base, signal)
      if (!validSessionView(value, id, rules))
        throw new ServerRequestError('서버 세션 응답이 계약과 일치하지 않습니다.')
      return value
    },
    async send(pending, signal) {
      const path =
        pending.kind === 'create'
          ? base
          : `${base}/${pending.kind === 'features' ? 'features' : 'end'}`
      const value = await request(
        path,
        signal,
        pending.kind === 'create' ? 'PUT' : 'POST',
        pending.body,
      )
      if (pending.kind === 'features') {
        if (!validFeatureResponse(value, pending.body, id, rules))
          throw new ServerRequestError('서버 특징·판정 응답이 계약과 일치하지 않습니다.')
        return { view: value.session, observation: value.observation }
      }
      if (
        !validSessionView(value, id, rules) ||
        (pending.kind === 'end' && (!value.ended || value.summary.total_ms !== pending.body.end_ms))
      ) {
        throw new ServerRequestError('서버 세션 응답이 계약과 일치하지 않습니다.')
      }
      return { view: value }
    },
  }
}
