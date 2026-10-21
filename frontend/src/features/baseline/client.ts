import { SERVER } from '../platform/serverConfig'
import { getServerAuth } from '../platform/serverAuth'
import { BASELINE_JOINT_NAMES, type BaselineLandmarks, type CapturedBaseline } from './landmarkCapture'

/** B1·B2 response (BE api-spec 6장). */
export type ServerBaseline = {
  baselineId: string
  registeredAt: string
  landmarks: BaselineLandmarks
}

export type BaselineErrorKind = 'signed_out' | 'invalid' | 'conflict' | 'busy' | 'server' | 'network'

export class BaselineRequestError extends Error {
  constructor(
    readonly kind: BaselineErrorKind,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message)
    this.name = 'BaselineRequestError'
  }
}

const MESSAGES: Record<BaselineErrorKind, string> = {
  signed_out: '로그인이 필요해요. 다시 로그인한 뒤 등록해 주세요.',
  invalid: '등록한 자세를 서버가 받지 않았어요. 다시 등록해 주세요.',
  conflict: '다른 화면에서 계정이나 자세가 바뀌었어요. 다시 등록해 주세요.',
  busy: '서버가 다른 작업을 처리하고 있어요. 잠시 뒤 다시 등록해 주세요.',
  server: '서버에 자세를 저장하지 못했어요. 잠시 뒤 다시 등록해 주세요.',
  network: '서버에 연결하지 못했어요. 연결을 확인한 뒤 다시 등록해 주세요.',
}

type Options = { fetch?: typeof fetch; timeoutMs?: number; retries?: number; retryDelayMs?: number }

const DEFAULT_TIMEOUT_MS = 5000
/**
 * 502·503 are retried with the same body at 1·2·4 s, at most 3 times (api-ws-spec 1.1); B1
 * returns the same row for the same `registered_at`.
 */
const DEFAULT_RETRIES = 3
const DEFAULT_RETRY_DELAY_MS = 1000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const unit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1

export function parseServerBaseline(value: unknown): ServerBaseline | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (v.schema_version !== '2.0' || typeof v.baseline_id !== 'string' || !UUID.test(v.baseline_id)) return null
  if (typeof v.registered_at !== 'string' || Number.isNaN(Date.parse(v.registered_at))) return null
  const marks = v.landmarks
  if (!marks || typeof marks !== 'object') return null
  const landmarks = {} as BaselineLandmarks
  for (const name of BASELINE_JOINT_NAMES) {
    const p = (marks as Record<string, unknown>)[name] as Record<string, unknown> | undefined
    if (!p || !unit(p.x) || !unit(p.y)) return null
    landmarks[name] = { x: p.x, y: p.y }
  }
  return { baselineId: v.baseline_id, registeredAt: v.registered_at, landmarks }
}

function kindOf(status: number): BaselineErrorKind {
  if (status === 401 || status === 403) return 'signed_out'
  if (status === 400) return 'invalid'
  if (status === 409) return 'conflict'
  if (status === 503) return 'busy'
  return 'server'
}

async function send(path: string, init: RequestInit, options: Options) {
  const fetchRequest = options.fetch ?? globalThis.fetch
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    return await fetchRequest(`${SERVER.apiBase}/api${path}`, {
      ...init,
      signal: abort.signal,
      cache: 'no-store',
      // The login cookie must also reach a separate API origin (fe-domain-idea.md 3.2 A-2).
      credentials: 'include',
    })
  } catch {
    throw new BaselineRequestError('network', MESSAGES.network)
  } finally {
    clearTimeout(timer)
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** B2 `GET /v2/baselines/current`; null when nothing is registered yet (404). */
export async function fetchCurrentBaseline(options: Options = {}): Promise<ServerBaseline | null> {
  const auth = getServerAuth()
  if (!auth) throw new BaselineRequestError('signed_out', MESSAGES.signed_out)
  const response = await send('/v2/baselines/current', { headers: { 'X-PoseGood-User-Id': auth.userId } }, options)
  if (response.status === 404) return null
  if (!response.ok) throw new BaselineRequestError(kindOf(response.status), MESSAGES[kindOf(response.status)], response.status)
  const parsed = parseServerBaseline(await response.json().catch(() => null))
  if (!parsed) throw new BaselineRequestError('server', MESSAGES.server, response.status)
  return parsed
}

/** The B1 body; `registeredAt` is when the capture ended and stays the same on retries. */
export function baselineBody(captured: CapturedBaseline, registeredAt: string) {
  return {
    registered_at: registeredAt,
    calibration_ms: captured.calibrationMs,
    sample_count: captured.sampleCount,
    landmarks: captured.landmarks,
  }
}

/** B1 `POST /v2/baselines`: saves the captured posture and returns what the server stored. */
export async function registerBaseline(
  captured: CapturedBaseline,
  registeredAt: string,
  options: Options = {},
): Promise<ServerBaseline> {
  const body = JSON.stringify(baselineBody(captured, registeredAt))
  const retries = options.retries ?? DEFAULT_RETRIES
  for (let attempt = 0; ; attempt++) {
    const auth = getServerAuth()
    if (!auth) throw new BaselineRequestError('signed_out', MESSAGES.signed_out)
    let token: string
    try {
      token = await auth.csrfToken()
    } catch {
      throw new BaselineRequestError('network', MESSAGES.network)
    }
    const response = await send(
      '/v2/baselines',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-TOKEN': token,
          'X-PoseGood-User-Id': auth.userId,
        },
        body,
      },
      options,
    )
    if (response.ok) {
      const parsed = parseServerBaseline(await response.json().catch(() => null))
      if (!parsed) throw new BaselineRequestError('server', MESSAGES.server, response.status)
      return parsed
    }
    if ((response.status === 502 || response.status === 503) && attempt < retries) {
      await wait((options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS) * 2 ** attempt)
      continue
    }
    const kind = kindOf(response.status)
    throw new BaselineRequestError(kind, MESSAGES[kind], response.status)
  }
}
