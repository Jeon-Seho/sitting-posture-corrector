import { apiRequest, type ApiErrorKind } from '../platform/api'
import { getServerAuth } from '../platform/serverAuth'
import { noteServerDay } from '../platform/serverClock'
import { validRecord } from './validation'
import type { RecordItem } from './types'
import { sameSnapshot } from './serverSnapshots'

const messages = Object.fromEntries(['signed_out', 'invalid', 'conflict', 'not_found', 'busy', 'limit', 'server', 'network'].map(k => [k, '서버 기록을 확인하지 못했어요. 임시 자료는 유지돼요.'])) as Record<ApiErrorKind, string>
const key = (userId: string) => `posegood.account.v3.${userId}.pending-results`

export function pendingRecords(userId: string): RecordItem[] {
  const raw = localStorage.getItem(key(userId))
  if (raw === null) return []
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed) || !parsed.every(validRecord)) throw new Error('미확인 기록이 손상됐어요. 원본을 유지합니다.')
  return parsed
}

/** Checkpoints and closed results are durable, per account, and never mix into confirmed history. */
export function rememberResult(userId: string, record: RecordItem) {
  if (!validRecord(record)) throw new Error('결과 형식을 확인하지 못했어요.')
  const previous = pendingRecords(userId)
  const old = previous.find(r => r.id === record.id)
  // A late observation must not replace a more complete or confirmed checkpoint.
  if (old && (old.total > record.total || (old.server?.confirmed && !record.server?.confirmed))) return
  localStorage.setItem(key(userId), JSON.stringify([...previous.filter(r => r.id !== record.id), record]))
}

export function reconcileResults(userId: string, records: RecordItem[]) {
  const remaining = pendingRecords(userId).filter(local => !records.some(remote =>
    remote.id === local.id && remote.server?.view?.ended === true &&
    remote.server.baselineId === local.server?.baselineId && remote.total >= local.total &&
    sameSnapshot(remote.rules, local.rules) &&
    // Measurement timestamps are not revision numbers. Require the same server start and
    // monotonic acknowledged counters; an older server snapshot cannot erase newer evidence.
    Date.parse(remote.startedAt) === Date.parse(local.startedAt) &&
    remote.valid >= local.valid && remote.good >= local.good))
  if (remaining.length) localStorage.setItem(key(userId), JSON.stringify(remaining))
  else localStorage.removeItem(key(userId))
  return remaining
}

export async function fetchServerRecords(userId: string) {
  const auth = getServerAuth()
  if (!auth || auth.userId !== userId) throw new Error('계정이 변경됐어요.')
  const response = await apiRequest('/v2/records', { method: 'GET' }, messages) as { today?: unknown; records?: unknown }
  if (getServerAuth() !== auth) throw new Error('계정이 변경됐어요.')
  if (!response || typeof response.today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(response.today) ||
    !Array.isArray(response.records) || !response.records.every(validRecord)) throw new Error('서버 기록 응답을 확인하지 못했어요.')
  noteServerDay(response.today)
  return response.records as RecordItem[]
}
