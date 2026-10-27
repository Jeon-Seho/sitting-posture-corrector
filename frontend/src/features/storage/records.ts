import { validProfile } from './validation'
import type { Profile, RecordItem } from './types'

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
    count: records.reduce((n, r) => n + (r.dayPartition?.eventCount ?? r.events.length), 0),
  }
}
export function validateProfile(input: Profile): Profile | null {
  const next: Profile = { name: input.name.trim() }
  if (input.age !== undefined) next.age = input.age
  if (input.occupation !== undefined) next.occupation = input.occupation.trim()
  return validProfile(next) ? next : null
}
