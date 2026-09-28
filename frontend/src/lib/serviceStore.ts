import type { LiveState, Machine, Rules } from './engine'
export type Profile = { name: string; age: number; occupation: string }
export type Mode = 'camera' | 'demo'
export type RecordItem = { id: string; startedAt: string; endedAt: string; mode: Mode; valid: number; good: number; total: number; events: LiveState['events'] }
export type Draft = { id: string; startedAt: string; mode: Mode; rules: Rules; machine: Machine }
export const KEYS = { profile: 'posegood.v2.profile', records: 'posegood.v2.records', draft: 'posegood.v2.draft', settings: 'posegood.v2.settings', mode: 'posegood.v2.mode' }
export function readLocal<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback } catch { return fallback }
}
export function writeLocal(key: string, value: unknown) { localStorage.setItem(key, JSON.stringify(value)) }
export function upsertRecord(records: RecordItem[], record: RecordItem) {
  return [record, ...records.filter(r => r.id !== record.id)].sort((a, b) => b.endedAt.localeCompare(a.endedAt))
}
export function summary(records: RecordItem[]) {
  const valid = records.reduce((n, r) => n + r.valid, 0), good = records.reduce((n, r) => n + r.good, 0)
  return { valid, good, rate: valid > 0 ? good / valid : null, count: records.reduce((n, r) => n + r.events.length, 0) }
}
export function resumeMachine(machine: Machine): Machine {
  const restored = structuredClone(machine)
  if (restored.active) {
    const event = restored.events.find(e => e.id === restored.active!.id)
    if (event) { event.endAt = restored.total; event.durationSec = restored.total - event.startAt; event.endReason = 'paused'; event.recovered = false }
  }
  restored.active = null; restored.hold = 0; restored.recover = 0; restored.onsetAt = null
  restored.blockId++; restored.interrupted = true
  return restored
}
/** 입력값을 다듬어 저장 가능한 프로필로 만든다. 필수값이 비었거나 나이가 범위를 벗어나면 null. */
export function validateProfile(input: Profile): Profile | null {
  const next = { name: input.name.trim(), age: input.age, occupation: input.occupation.trim() }
  if (!next.name || !next.occupation || !Number.isInteger(next.age) || next.age < 1 || next.age > 120) return null
  return next
}
/** 중단된 측정을 마지막 저장 지점까지의 기록으로 닫는다. 진행 중 이벤트는 일시정지로 끊는다. */
export function recordFromDraft(draft: Draft, endedAt: string): RecordItem {
  const m = draft.machine
  return { id: draft.id, startedAt: draft.startedAt, endedAt, mode: draft.mode, total: m.total,
    valid: Math.max(0, m.total - m.paused - m.unknown), good: m.good, events: resumeMachine(m).events }
}
