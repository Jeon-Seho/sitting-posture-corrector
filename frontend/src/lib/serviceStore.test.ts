import { describe, expect, it } from 'vitest'
import { newMachine } from './engine'
import { KEYS, resumeMachine, summary, upsertRecord, type RecordItem } from './serviceStore'
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
})
