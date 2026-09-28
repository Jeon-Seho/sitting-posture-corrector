import { describe, expect, it } from 'vitest'
import { newMachine } from './engine'
import { DEFAULT_RULES } from '../data/posture'
import { KEYS, recordFromDraft, resumeMachine, summary, upsertRecord, validateProfile, type RecordItem } from './serviceStore'
const item: RecordItem = { id: 'one', startedAt: '2026-09-28T00:00:00Z', endedAt: '2026-09-28T01:00:00Z', mode: 'demo', valid: 100, good: 90, total: 100, events: [] }
describe('service records', () => {
  it('retries replace the same session instead of duplicating it', () => {
    const records = upsertRecord([item], { ...item, good: 95 })
    expect(records).toHaveLength(1); expect(summary(records).rate).toBe(.95)
  })
  it('weights maintenance by valid duration and leaves empty data unavailable', () => {
    expect(summary([]).rate).toBe(null)
    expect(summary([item, { ...item, id: 'two', valid: 900, good: 0 }]).rate).toBe(.09)
  })
  it('restores accumulated data without carrying an active confirmation timer', () => {
    const machine = newMachine(); machine.total = 50; machine.good = 40; machine.hold = 2; machine.onsetAt = 48
    const restored = resumeMachine(machine)
    expect(restored.total).toBe(50); expect(restored.good).toBe(40); expect(restored.hold).toBe(0); expect(restored.onsetAt).toBe(null)
    expect(machine.hold).toBe(2)
  })
  it('local data deletion also clears the remembered measurement mode', () => {
    expect(Object.values(KEYS)).toContain('posegood.v2.mode')
  })
  it('trims profile input and rejects missing fields or out-of-range age', () => {
    expect(validateProfile({ name: ' 합성 ', age: 30, occupation: ' 테스트 ' })).toEqual({ name: '합성', age: 30, occupation: '테스트' })
    expect(validateProfile({ name: '  ', age: 30, occupation: '테스트' })).toBe(null)
    expect(validateProfile({ name: '합성', age: 0, occupation: '테스트' })).toBe(null)
    expect(validateProfile({ name: '합성', age: 121, occupation: '테스트' })).toBe(null)
  })
  it('closes an interrupted draft as a record without counting paused or unknown time as valid', () => {
    const machine = newMachine(); Object.assign(machine, { total: 200, paused: 10, unknown: 20, good: 150, collapse: 20 })
    const active = { id: 1, type: 'tilt' as const, startAt: 180, confirmedAt: 183, endAt: null, durationSec: 0, alerts: 1, firstAlertAt: 183,
      recovered: false, recoverySec: null, endedBySession: false, endReason: null, blockId: 0 }
    machine.active = active; machine.events = [active]
    const record = recordFromDraft({ id: 'draft', startedAt: '2026-09-28T00:00:00Z', mode: 'camera', rules: DEFAULT_RULES, machine }, '2026-09-28T00:04:00Z')
    expect(record).toMatchObject({ id: 'draft', mode: 'camera', total: 200, valid: 170, good: 150 })
    expect(record.events[0]).toMatchObject({ endAt: 200, endReason: 'paused' })
    expect(machine.events[0].endAt).toBe(null)
  })
})
