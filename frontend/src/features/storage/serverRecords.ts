import { ApiError, apiRequest, type ApiErrorKind } from '../platform/api'
import { getServerAuth } from '../platform/serverAuth'
import { noteServerDay } from '../platform/serverClock'
import { validRecord } from './validation'
import type { RecordItem } from './types'

const messages = Object.fromEntries(['signed_out', 'invalid', 'conflict', 'not_found', 'busy', 'limit', 'server', 'network'].map(k => [k, '서버 기록을 확인하지 못했어요.'])) as Record<ApiErrorKind, string>
/** The old key for results kept on this device until R1 confirmed them (ADR 0027 before 11/13). */
const oldPendingKey = (userId: string) => `posegood.account.v3.${userId}.pending-results`

/** Nothing about a measurement is kept on this device any more: remove what an older app left. */
export function dropOldPendingResults(userId: string) {
  try { if (localStorage.getItem(oldPendingKey(userId)) !== null) localStorage.removeItem(oldPendingKey(userId)) }
  catch (caughtError) { console.error('[features/storage/serverRecords.ts:dropOldPendingResults] Operation failed', caughtError) }
}

/**
 * Measurements that ended without the server's confirmation (session ids, kept in memory):
 * settled when R1 lists them as ended, or when S4 says the server ended them (stored) or does not
 * have them (404, it lost them, e.g. restarted while measuring). Those S4 cannot answer stay for
 * the next check. Relies on S4 answering ended sessions from the DB (BE-11, develop PR #119), so a
 * stored session is never taken for a lost one.
 */
export async function settleUnconfirmed(userId: string, ids: string[], records: RecordItem[]) {
  const remaining: string[] = []
  let lost = 0
  for (const id of ids) {
    if (records.some((r) => r.id === id && r.server?.view?.ended === true)) continue
    try {
      const view = await apiRequest(`/sessions/${encodeURIComponent(id)}`, { method: 'GET' }, messages) as { ended?: unknown } | null
      if (view?.ended !== true) remaining.push(id)
    } catch (error) {
      if (error instanceof ApiError && error.status === 404 && getServerAuth()?.userId === userId) lost += 1
      else remaining.push(id)
    }
  }
  return { remaining, lost }
}

export async function fetchServerRecords(userId: string) {
  const auth = getServerAuth()
  if (!auth || auth.userId !== userId) throw new Error('계정이 변경됐어요.')
  const response = await apiRequest('/records', { method: 'GET' }, messages) as { today?: unknown; records?: unknown }
  if (getServerAuth() !== auth) throw new Error('계정이 변경됐어요.')
  if (!response || typeof response.today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(response.today) ||
    !Array.isArray(response.records) || !response.records.every(validRecord)) throw new Error('서버 기록 응답을 확인하지 못했어요.')
  noteServerDay(response.today)
  return response.records as RecordItem[]
}
