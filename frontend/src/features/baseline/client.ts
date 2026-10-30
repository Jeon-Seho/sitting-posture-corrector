import { ApiError, apiRequest, type ApiErrorKind, type ApiOptions } from '../platform/api'
import { noteServerTime } from '../platform/serverClock'
import { BASELINE_JOINT_NAMES, type BaselineLandmarks, type CapturedBaseline } from './landmarkCapture'

/** B1·B2 response (BE api-spec 6장). */
export type ServerBaseline = {
  baselineId: string
  registeredAt: string
  landmarks: BaselineLandmarks
}

const MESSAGES: Record<ApiErrorKind, string> = {
  signed_out: '로그인이 필요해요. 다시 로그인한 뒤 등록해 주세요.',
  invalid: '등록한 자세를 서버가 받지 않았어요. 다시 등록해 주세요.',
  conflict: '다른 화면에서 계정이나 자세가 바뀌었어요. 다시 등록해 주세요.',
  not_found: '서버에 자세를 저장하지 못했어요. 잠시 뒤 다시 등록해 주세요.',
  busy: '서버가 다른 작업을 처리하고 있어요. 잠시 뒤 다시 등록해 주세요.',
  limit: '서버에 자세를 저장하지 못했어요. 잠시 뒤 다시 등록해 주세요.',
  server: '서버에 자세를 저장하지 못했어요. 잠시 뒤 다시 등록해 주세요.',
  network: '서버에 연결하지 못했어요. 연결을 확인한 뒤 다시 등록해 주세요.',
}

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

function parsed(value: unknown): ServerBaseline {
  const baseline = parseServerBaseline(value)
  if (!baseline) throw new ApiError('server', MESSAGES.server)
  return baseline
}

/** B2 `GET /v2/baselines/current`; null when nothing is registered yet (404). */
export async function fetchCurrentBaseline(options: ApiOptions = {}): Promise<ServerBaseline | null> {
  try {
    return parsed(await apiRequest('/v2/baselines/current', {}, MESSAGES, options))
  } catch (cause) {
    console.error('[features/baseline/client.ts:fetchCurrentBaseline] Operation failed', cause,
      cause instanceof ApiError && cause.kind === 'not_found' && cause.status === 404 ? 'expected:baseline-missing' : 'unexpected')
    if (cause instanceof ApiError && cause.kind === 'not_found') return null
    throw cause
  }
}

/**
 * The B1 body (DB V2.5, BE `fix/repo-backend-sync` `cab11c1`): `registrationId` is one UUID per
 * capture, the same on retries. The server sets the registration time itself; sending
 * `registered_at` is refused (400).
 */
export function baselineBody(captured: CapturedBaseline, registrationId: string) {
  return {
    registration_id: registrationId,
    calibration_ms: captured.calibrationMs,
    sample_count: captured.sampleCount,
    landmarks: captured.landmarks,
  }
}

/**
 * B1 `POST /v2/baselines`: saves the captured posture and returns what the server stored. A
 * repeat with the same `registration_id` and coordinates returns the same row (different
 * coordinates: 409), so a request that got no answer is sent again. The response's
 * `registered_at` is the server's time and also moves 「오늘」 (ADR 0029).
 */
export async function registerBaseline(
  captured: CapturedBaseline,
  registrationId: string,
  options: ApiOptions = {},
): Promise<ServerBaseline> {
  const saved = parsed(
    await apiRequest('/v2/baselines', { method: 'POST', body: baselineBody(captured, registrationId) }, MESSAGES, {
      retryUnanswered: true,
      ...options,
    }),
  )
  noteServerTime(saved.registeredAt)
  return saved
}
