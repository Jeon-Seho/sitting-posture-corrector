import { describe, expect, it } from 'vitest'
import { collapseIntervals } from './stats'
import { periodStats } from './comparison'
import { DEFAULT_RULES } from '../data/posture'
import { closeOpenEvent, newMachine, step, sampleAt } from './engine'
import { validRecord } from './serviceStore'

// Synthetic constant samples only, no real camera or user storage.
const sample = (prob: number) => ({ ...sampleAt(0), prob, confidence: 1, state: 'good' as const })
const run = () => {
  const m = newMachine()
  step(m, 3, 'running', DEFAULT_RULES, sample(0.9))
  step(m, 2, 'running', DEFAULT_RULES, sample(0.1))
  step(m, 100, 'paused', DEFAULT_RULES, sample(0.9))
  step(m, 20, 'running', DEFAULT_RULES, { ...sample(0.9), state: 'unknown' })
  step(m, 3, 'running', DEFAULT_RULES, sample(0.9))
  return m
}
describe('same-session collapse cycle on valid time', () => {
  it('excludes rest and unknown while preserving the existing interrupt timer policy', () => {
    const m = run()
    expect(m.events.map((e) => e.validStartAt).sort((a, b) => a! - b!)).toEqual([0, 5])
    expect(collapseIntervals(m.events)).toEqual([5])
    expect(m.paused).toBe(100)
    expect(m.unknown).toBe(20)
  })
  it('does not double count duplicate events and accepts reverse event list order', () => {
    const events = run().events
    expect(collapseIntervals([...events, events[0]])).toEqual([5])
    expect(collapseIntervals([...events].reverse())).toEqual([5])
  })
  it('does not guess excluded durations from legacy cross-block records', () => {
    const events = run().events.map(({ validStartAt: _, ...event }) => event)
    expect(collapseIntervals(events)).toEqual([])
    expect(collapseIntervals(events.map((e) => ({ ...e, blockId: 0 })))).toEqual([125])
  })
  it('does not compute intervals between sessions or invent statistics for zero valid time', () => {
    const records = run().events.map((event, i) => ({
      id: `synthetic-${i}`,
      startedAt: '2026-09-30T00:00:00Z',
      endedAt: '2026-09-30T00:05:00Z',
      mode: 'camera' as const,
      total: 128,
      valid: 8,
      good: 2,
      events: [event],
    }))
    expect(periodStats(records, '2026-09-30', '2026-09-30').meanInterval).toBeNull()
    expect(
      periodStats(
        records.map((r) => ({ ...r, total: 0, valid: 0, good: 0, events: [] })),
        '',
        '',
      ).perHour,
    ).toBeNull()
  })
  it('validates optional cumulative time and keeps old complete records compatible', () => {
    const m = run()
    closeOpenEvent(m)
    const record = {
      id: 'synthetic',
      startedAt: '2026-09-30T00:00:00Z',
      endedAt: '2026-09-30T00:05:00Z',
      mode: 'camera',
      total: m.total,
      valid: 8,
      good: m.good,
      events: m.events,
    }
    expect(validRecord(record)).toBe(true)
    expect(
      validRecord({ ...record, events: record.events.map(({ validStartAt: _, ...e }) => e) }),
    ).toBe(true)
    expect(
      validRecord({ ...record, events: record.events.map((e) => ({ ...e, validStartAt: NaN })) }),
    ).toBe(false)
    expect(
      validRecord({ ...record, events: record.events.map((e) => ({ ...e, validStartAt: -1 })) }),
    ).toBe(false)
  })
})
