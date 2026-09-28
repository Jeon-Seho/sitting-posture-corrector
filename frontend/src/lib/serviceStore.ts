import type { LiveState, Machine, Rules } from './engine'
export type Profile = { name: string; age: number; occupation: string }
export type RecordItem = { id: string; startedAt: string; endedAt: string; mode: 'camera' | 'demo'; valid: number; good: number; total: number; events: LiveState['events'] }
export type Draft = { id: string; startedAt: string; mode: 'camera' | 'demo'; rules: Rules; machine: Machine }
export const KEYS = { profile: 'posegood.v2.profile', records: 'posegood.v2.records', draft: 'posegood.v2.draft', settings: 'posegood.v2.settings' }
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
