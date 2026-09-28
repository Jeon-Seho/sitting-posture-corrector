import type { LiveState, Machine, Rules } from './engine'
import { DEFAULT_RULES } from '../data/posture'
export type Profile = { name: string; age: number; occupation: string }
export type Mode = 'camera' | 'demo'
export type RecordItem = { id: string; startedAt: string; endedAt: string; mode: Mode; valid: number; good: number; total: number; events: LiveState['events'] }
export type Draft = { id: string; startedAt: string; mode: Mode; rules: Rules; machine: Machine }
export const KEYS = { profile: 'posegood.v2.profile', records: 'posegood.v2.records', draft: 'posegood.v2.draft', settings: 'posegood.v2.settings', demo: 'posegood.v2.demo', mode: 'posegood.v2.mode' }
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

/*
 * 저장값 읽기 검증. 지금은 합성·더미 기록뿐이라 형식이 바뀌면 맞지 않는 항목을 버리고 기본값으로 채운다.
 * 필드가 늘어나면 여기 검사만 함께 고친다. 서버·DB 스키마는 데이터 계약 확정 후 맞춘다.
 */
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isMode = (v: unknown): v is Mode => v === 'camera' || v === 'demo'
export function parseProfile(value: unknown): Profile | null {
  if (!isObject(value) || typeof value.name !== 'string' || typeof value.occupation !== 'string' || !isNumber(value.age)) return null
  return validateProfile({ name: value.name, age: value.age, occupation: value.occupation })
}
export function parseRules(value: unknown): Rules {
  const rules = { ...DEFAULT_RULES }
  if (!isObject(value)) return rules
  for (const key of Object.keys(rules) as (keyof Rules)[]) if (isNumber(value[key])) rules[key] = value[key] as number
  return rules
}
function isRecord(value: unknown): value is RecordItem {
  return isObject(value) && typeof value.id === 'string' && typeof value.startedAt === 'string' && typeof value.endedAt === 'string'
    && isMode(value.mode) && isNumber(value.total) && isNumber(value.valid) && isNumber(value.good) && Array.isArray(value.events)
}
export function parseRecords(value: unknown): RecordItem[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}
export function parseDraft(value: unknown): Draft | null {
  if (!isObject(value) || typeof value.id !== 'string' || typeof value.startedAt !== 'string' || !isMode(value.mode)) return null
  const m = value.machine
  if (!isObject(m) || !['total', 'paused', 'unknown', 'good'].every(k => isNumber(m[k])) || !Array.isArray(m.events)) return null
  return { id: value.id, startedAt: value.startedAt, mode: value.mode, rules: parseRules(value.rules), machine: m as Machine }
}
export function parseMode(value: unknown): Mode {
  return isMode(value) ? value : 'camera'
}
