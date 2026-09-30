import { DEFAULT_RULES } from '../data/posture'
import { closeOpenEvent, type CollapseEvent, type LiveState, type Machine, type Rules } from './engine'
export type Profile = { name: string; age: number; occupation: string }
export type Mode = 'camera' | 'demo'
export type RecordItem = { id: string; startedAt: string; endedAt: string; mode: 'camera' | 'demo'; valid: number; good: number; total: number; events: LiveState['events']; rules?: Rules }
export type Draft = { id: string; startedAt: string; savedAt?: string; mode: 'camera' | 'demo'; rules: Rules; machine: Machine }
export const KEYS = { profile: 'posegood.v2.profile', records: 'posegood.v2.records', draft: 'posegood.v2.draft', settings: 'posegood.v2.settings', demo: 'posegood.v2.demo' }
export function readLocal<T>(key: string, fallback: T): T {
  let raw: string | null
  try { raw = localStorage.getItem(key) } catch { throw new Error(`${labels[key]} 저장소에 접근하지 못했습니다.`) }
  if (raw === null) return fallback
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!validLocal(key, parsed)) throw new Error('Invalid local data')
    return parsed as T
  } catch { throw new Error(`${labels[key]} 자료를 읽을 수 없습니다. 기존 자료는 유지됩니다.`) }
}
export function writeLocal(key: string, value: unknown) {
  // A failed read must never turn damaged data into an empty overwrite.
  readLocal(key, null)
  if (!validLocal(key, value)) throw new Error(`${labels[key]} 값이 올바르지 않습니다.`)
  localStorage.setItem(key, JSON.stringify(value))
}
export function upsertRecord(records: RecordItem[], record: RecordItem) {
  return [record, ...records.filter(r => r.id !== record.id)].sort((a, b) => b.endedAt.localeCompare(a.endedAt))
}
export function summary(records: RecordItem[]) {
  const valid = records.reduce((n, r) => n + r.valid, 0), good = records.reduce((n, r) => n + r.good, 0)
  return { valid, good, rate: valid > 0 ? good / valid : null, count: records.reduce((n, r) => n + r.events.length, 0) }
}
export function resumeMachine(machine: Machine): Machine {
  const restored = structuredClone(machine)
  closeOpenEvent(restored, 'paused')
  if (!restored.interrupted) restored.blockId++
  restored.interrupted = true
  return restored
}
export function validateProfile(input: Profile): Profile | null {
  const next = { name: input.name.trim(), age: input.age, occupation: input.occupation.trim() }
  return validProfile(next) ? next : null
}
/** Close at the last checkpoint; never add offline time to a recovered session. */
export function recordFromDraft(draft: Draft, endedAt: string): RecordItem {
  const m = resumeMachine(draft.machine)
  return { id: draft.id, startedAt: draft.startedAt, endedAt, mode: draft.mode, rules: draft.rules,
    total: m.total, valid: Math.max(0, m.total - m.paused - m.unknown), good: m.good, events: m.events }
}

const labels: Record<string, string> = { [KEYS.profile]: '프로필', [KEYS.records]: '측정 기록', [KEYS.draft]: '중간 기록', [KEYS.settings]: '설정', [KEYS.demo]: '시연 옵션' }
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const positive = (v: unknown): v is number => finite(v) && v > 0
const nonnegative = (v: unknown): v is number => finite(v) && v >= 0
const integer = (v: unknown): v is number => nonnegative(v) && Number.isSafeInteger(v)
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))
const mode = (v: unknown) => v === 'camera' || v === 'demo'
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(a), Math.abs(b))

export function validRules(v: unknown): v is Rules {
  return object(v) && positive(v.holdSeconds) && v.holdSeconds <= 10
    && positive(v.recoverSeconds) && v.recoverSeconds <= 10
    && positive(v.realertSeconds) && v.realertSeconds <= 180
    && positive(v.threshold) && v.threshold <= 1
}
export function validProfile(v: unknown): v is Profile {
  return object(v) && text(v.name, 50) && integer(v.age) && v.age >= 1 && v.age <= 120 && text(v.occupation, 80)
}
function validEvent(v: unknown, total: number): v is CollapseEvent {
  if (!object(v) || !integer(v.id) || v.id < 1 || !['forwardHead', 'tilt'].includes(String(v.type))
    || !nonnegative(v.startAt) || !nonnegative(v.confirmedAt) || v.startAt > v.confirmedAt || v.confirmedAt > total + 1e-5
    || !nonnegative(v.durationSec) || !integer(v.alerts) || !integer(v.blockId)
    || typeof v.recovered !== 'boolean' || typeof v.endedBySession !== 'boolean'
    || ![null, 'paused', 'unknown', 'ended'].includes(v.endReason as null)
    || !(v.firstAlertAt === null || (nonnegative(v.firstAlertAt) && v.firstAlertAt >= v.confirmedAt - 1e-5 && v.firstAlertAt <= total + 1e-5))
    || (v.alerts === 0) !== (v.firstAlertAt === null)
    || !(v.recoverySec === null || nonnegative(v.recoverySec))) return false
  if (v.endAt === null) return !v.recovered && !v.endedBySession && v.endReason === null && v.recoverySec === null && v.durationSec === 0
  return nonnegative(v.endAt) && v.endAt >= v.confirmedAt - 1e-5 && v.endAt <= total + 1e-5
    && near(v.durationSec, v.endAt - v.startAt)
    && (v.recovered ? v.endReason === null && !v.endedBySession
      && (v.firstAlertAt === null ? v.recoverySec === null : finite(v.recoverySec) && near(v.recoverySec, v.endAt - v.firstAlertAt))
      : v.recoverySec === null && v.endReason !== null && v.endedBySession === (v.endReason === 'ended'))
}
function validEvents(v: unknown, total: number): v is CollapseEvent[] {
  return Array.isArray(v) && v.every(e => validEvent(e, total)) && new Set(v.map(e => e.id)).size === v.length
}
export function validMachine(v: unknown): v is Machine {
  if (!object(v) || !['loop', 'total', 'paused', 'unknown', 'good', 'collapse', 'hold', 'recover', 'lastAlertAt'].every(k => nonnegative(v[k]))
    || !integer(v.nextId) || v.nextId < 1 || !integer(v.alertTick) || !integer(v.blockId) || typeof v.interrupted !== 'boolean'
    || !(v.onsetAt === null || (nonnegative(v.onsetAt) && v.onsetAt <= (v.total as number)))
    || !validEvents(v.events, v.total as number)) return false
  const total = v.total as number, paused = v.paused as number, unknown = v.unknown as number
  if (paused + unknown > total + 1e-5 || !near((v.good as number) + (v.collapse as number), Math.max(0, total - paused - unknown))
    || (v.lastAlertAt as number) > total + 1e-5 || v.events.some(e => e.id >= (v.nextId as number) || e.blockId > (v.blockId as number))
    || v.events.reduce((n, e) => n + e.alerts, 0) !== v.alertTick) return false
  const open = v.events.filter(e => e.endAt === null)
  if (v.active === null) return open.length === 0
  const active = v.active
  return validEvent(active, total) && open.length === 1
    && (Object.keys(open[0]) as (keyof CollapseEvent)[]).every(key => active[key] === open[0][key])
}
export function validRecord(v: unknown): v is RecordItem {
  return object(v) && text(v.id, 128) && date(v.startedAt) && date(v.endedAt) && Date.parse(v.endedAt) >= Date.parse(v.startedAt)
    && mode(v.mode) && nonnegative(v.total) && nonnegative(v.valid) && nonnegative(v.good)
    && v.good <= v.valid + 1e-5 && v.valid <= v.total + 1e-5 && validEvents(v.events, v.total)
    && v.events.every(e => e.endAt !== null) && (v.rules === undefined || validRules(v.rules))
}
export function validDraft(v: unknown): v is Draft {
  return object(v) && text(v.id, 128) && date(v.startedAt) && mode(v.mode) && validRules(v.rules) && validMachine(v.machine)
    && (v.savedAt === undefined || (date(v.savedAt) && Date.parse(v.savedAt) >= Date.parse(v.startedAt)))
}
function validLocal(key: string, value: unknown) {
  if (key === KEYS.profile) return validProfile(value)
  if (key === KEYS.records) return Array.isArray(value) && value.every(validRecord) && new Set(value.map(r => r.id)).size === value.length
  if (key === KEYS.draft) return validDraft(value)
  if (key === KEYS.settings) return validRules(value)
  if (key === KEYS.demo) return typeof value === 'boolean'
  return false
}
export function saveDraft(draft: Draft) {
  const previous = readLocal<Draft | null>(KEYS.draft, null)
  if (previous && previous.id !== draft.id) throw new Error('다른 중간 기록이 있습니다. 먼저 복구하거나 종료해 주세요.')
  writeLocal(KEYS.draft, draft)
}
export function removeSavedDraft(id: string) {
  const draft = readLocal<Draft | null>(KEYS.draft, null)
  if (draft?.id === id) localStorage.removeItem(KEYS.draft)
}
export function loadLocalState() {
  const issues: string[] = []
  const read = <T,>(key: string, fallback: T): T => {
    try { return readLocal(key, fallback) } catch (e) { issues.push((e as Error).message); return fallback }
  }
  const profile = read<Profile | null>(KEYS.profile, null), records = read<RecordItem[]>(KEYS.records, [])
  const draft = read<Draft | null>(KEYS.draft, null), settings = read(KEYS.settings, DEFAULT_RULES), demo = read(KEYS.demo, false)
  return { profile, records, draft: draft && !records.some(r => r.id === draft.id) ? draft : null, settings, demo, issues }
}
