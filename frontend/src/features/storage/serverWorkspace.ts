import type { Rules } from '../../lib/engine'
import { apiRequest, type ApiErrorKind, type ApiOptions } from '../platform/api'
import { validRules } from './validation'

/**
 * The account's settings on the server: W1 `GET /workspace` reads them, W2 `PUT /workspace`
 * saves them (api-ws-spec 7장). The posture rules live only here, not on this device: S1 sends them
 * and the server refuses a session whose policy differs from the account's (409).
 */
export type ServerWorkspace = {
  profile: { name: string; age: number | null; occupation: string | null }
  rules: Rules
  preferences: { alerts_on: boolean }
  consents: { optional_profile: boolean }
}

const MESSAGES: Record<ApiErrorKind, string> = {
  signed_out: '로그인이 필요해요. 다시 로그인해 주세요.',
  invalid: '설정 값을 확인해 주세요.',
  conflict: '설정을 저장하지 못했어요. 다시 시도해 주세요.',
  not_found: '서버 설정을 찾지 못했어요.',
  busy: '서버가 다른 작업을 처리하고 있어요. 잠시 뒤 다시 시도해 주세요.',
  limit: '서버 설정을 저장하지 못했어요.',
  server: '서버 설정을 처리하지 못했어요.',
  network: '서버에 연결하지 못했어요. 연결을 확인해 주세요.',
}

function parsed(value: unknown): ServerWorkspace {
  const w = value as Partial<ServerWorkspace> | null
  if (!w?.profile || !validRules(w.rules) || typeof w.preferences?.alerts_on !== 'boolean' || !w.consents)
    throw new Error('서버 설정 응답을 확인하지 못했어요.')
  return w as ServerWorkspace
}

export async function fetchWorkspace(options: ApiOptions = {}) {
  return parsed(await apiRequest('/workspace', { method: 'GET' }, MESSAGES, options))
}

/** W2 takes profile, rules and preferences together: the latest profile and preferences go back unchanged. */
export async function saveWorkspaceRules(rules: Rules, options: ApiOptions = {}) {
  const latest = await fetchWorkspace(options)
  const body = { profile: latest.profile, rules, preferences: latest.preferences }
  return parsed(await apiRequest('/workspace', { method: 'PUT', body }, MESSAGES, options))
}
