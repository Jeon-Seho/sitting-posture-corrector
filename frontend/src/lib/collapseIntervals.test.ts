import { describe, expect, it } from 'vitest'
import { collapseIntervals } from './stats'
import { periodStats } from './comparison'
import type { CollapseEvent } from './engine'
import { validRecord } from './serviceStore'

/**
 * Two collapses of one measurement, as the server reports them (fixed values; the app's own
 * judging engine was removed on 2026-10-21): the second one after a 100 s rest and 20 s of
 * unmeasurable time, so 5 s apart on valid time and in a new block.
 */
const event = (id: number, startAt: number, validStartAt: number, blockId: number): CollapseEvent => ({
  id,
  type: 'forwardHead',
  startAt,
  validStartAt,
  confirmedAt: startAt + 3,
  endAt: null,
  durationSec: 0,
  alerts: 1,
  firstAlertAt: startAt + 3,
  recovered: false,
  recoverySec: null,
  endedBySession: false,
  endReason: null,
  blockId,
})
const run = () => ({ events: [event(1, 0, 0, 0), event(2, 125, 5, 1)] })
const closed = (events: CollapseEvent[]) =>
  events.map((e) => ({ ...e, endAt: e.startAt + 3, durationSec: 3, endReason: 'ended' as const, endedBySession: true }))

describe('same-session collapse cycle on valid time', () => {
  it('excludes rest and unknown while preserving the existing interrupt timer policy', () => {
    const m = run()
    expect(m.events.map((e) => e.validStartAt).sort((a, b) => a! - b!)).toEqual([0, 5])
    expect(collapseIntervals(m.events)).toEqual([5])
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
    const record = {
      id: 'synthetic',
      startedAt: '2026-09-30T00:00:00Z',
      endedAt: '2026-09-30T00:05:00Z',
      mode: 'camera',
      total: 128,
      valid: 8,
      good: 2,
      events: closed(run().events),
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
