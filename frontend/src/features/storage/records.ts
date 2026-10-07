import { closeOpenEvent, type Machine } from '../../lib/engine'
import { validProfile } from './validation'
import type { Draft, Profile, RecordItem } from './types'

export function upsertRecord(records: RecordItem[], record: RecordItem) {
  return [record, ...records.filter((r) => r.id !== record.id)].sort((a, b) =>
    b.endedAt.localeCompare(a.endedAt),
  )
}
export function summary(records: RecordItem[]) {
  const valid = records.reduce((n, r) => n + r.valid, 0),
    good = records.reduce((n, r) => n + r.good, 0)
  return {
    valid,
    good,
    rate: valid > 0 ? good / valid : null,
    count: records.reduce((n, r) => n + r.events.length, 0),
  }
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
  return {
    id: draft.id,
    startedAt: draft.startedAt,
    endedAt,
    mode: draft.mode,
    rules: draft.rules,
    total: m.total,
    valid: Math.max(0, m.total - m.paused - m.unknown),
    good: m.good,
    events: m.events,
    ...(m.evaluationCounts?{evaluationCounts:structuredClone(m.evaluationCounts)}:{}),
  }
}
