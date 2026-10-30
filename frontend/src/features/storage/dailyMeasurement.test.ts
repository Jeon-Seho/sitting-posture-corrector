import { describe, expect, it } from 'vitest'
import { DailyMeasurementLedger, recordsByDay } from './dailyMeasurement'
import { validRecord } from './validation'
import { kstDay } from '../../lib/kstDay'
import { historyFor, dailyHistory } from '../../lib/history'
import { dailyStats, sessionsOn, addDays } from '../history/recordsSource'
import { DEFAULT_RULES } from '../../data/posture'
import type { CollapseEvent } from '../../lib/engine'
import type { RecordItem } from './types'

const start = '2026-10-26T23:59:58+09:00'
const event = (alerts = 1): CollapseEvent => ({ id: 1, type: 'referenceChange', startAt: 0, validStartAt: 0,
  confirmedAt: 1, endAt: 6, durationSec: 6, alerts, firstAlertAt: 1, recovered: true, recoverySec: 5,
  endedBySession: false, endReason: null, blockId: 0 })
function measured() {
  const ledger = new DailyMeasurementLedger(start)
  ledger.observe({ total: 2, valid: 2, good: 2, events: [] })
  ledger.observe({ total: 4, valid: 2, good: 2, events: [] })
  ledger.observe({ total: 6, valid: 4, good: 2, events: [] })
  const record: RecordItem = { id: 'explicit-synthetic', startedAt: start, endedAt: '2026-10-27T00:00:04+09:00',
    total: 6, valid: 4, good: 2, mode: 'camera', events: [], rules: DEFAULT_RULES, days: ledger.snapshot() }
  return { ledger, record }
}
describe('KST daily measurement partitions with explicit synthetic counters', () => {
  it('uses KST midnight regardless of the timestamp offset or host timezone', () => {
    expect(kstDay('2026-10-26T14:59:59.999Z')).toBe('2026-10-26')
    expect(kstDay('2026-10-26T15:00:00Z')).toBe('2026-10-27')
    expect(kstDay('2026-10-26T08:00:00-07:00')).toBe('2026-10-27')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('stores both dates with exact observed good/unknown counters without stopping the session', () => {
    const { record } = measured()
    expect(validRecord(record)).toBe(true)
    expect(record.days).toMatchObject([
      { date: '2026-10-26', total: 2, valid: 2, good: 2 },
      { date: '2026-10-27', total: 4, valid: 2, good: 0 },
    ])
    expect(sessionsOn([record], '2026-10-26')[0]).toMatchObject({ total: 2, valid: 2, good: 2 })
    expect(sessionsOn([record], '2026-10-27')[0]).toMatchObject({ total: 4, valid: 2, good: 0 })
    expect(dailyStats([record], '2026-10-26', '2026-10-27')).toMatchObject([
      { date: '2026-10-26', valid_sec: 2, good_sec: 2, excluded_sec: 0 },
      { date: '2026-10-27', valid_sec: 2, good_sec: 0, excluded_sec: 2 },
    ])
    expect(historyFor([record], 'camera', 'today', '2026-10-27')[0].valid).toBe(2)
    expect(dailyHistory([record]).map(d => d.valid)).toEqual([2, 2])
  })
  it('splits a single uniform observation crossing midnight and keeps its sums', () => {
    const ledger = new DailyMeasurementLedger('2026-10-26T23:59:59.750+09:00')
    ledger.observe({ total: 1, valid: 1, good: 1, events: [] })
    expect(ledger.snapshot().map(r => r.total)).toEqual([0.25, 0.75])
    expect(ledger.snapshot().reduce((n, r) => n + r.good, 0)).toBe(1)
  })
  it('attributes an event once and reminders to their actual observed dates', () => {
    const ledger = new DailyMeasurementLedger(start)
    const first = { ...event(), endAt: null, durationSec: 0, recovered: false, recoverySec: null }
    ledger.observe({ total: 2, valid: 2, good: 0, events: [first], lastAlertAt: 1 })
    ledger.observe({ total: 6, valid: 6, good: 0, events: [event(2)], lastAlertAt: 5 })
    const record: RecordItem = { ...measured().record, valid: 6, good: 0, events: [event(2)], days: ledger.snapshot() }
    expect(validRecord(record)).toBe(true)
    const days = dailyStats([record], '2026-10-26', '2026-10-27')
    expect(days.map(d => d.event_count)).toEqual([1, 0])
    expect(days.map(d => d.alert_count)).toEqual([1, 1])
    expect(recordsByDay([record])[0].events[0].continued).toBe(true)
    expect(recordsByDay([record])[1].events[0].recovered).toBe(true)
  })
  it('recovers the saved daily counters without double-counting a repeated checkpoint', () => {
    const { record } = measured()
    const restored = new DailyMeasurementLedger(start, record.days)
    restored.observe({ total: 6, valid: 4, good: 2, events: [] })
    restored.observe({ total: 8, valid: 6, good: 4, events: [] })
    expect(restored.snapshot().map(day => day.total)).toEqual([2, 6])
    expect(restored.snapshot().reduce((n, day) => n + day.good, 0)).toBe(4)
  })
  it('rejects corrupt daily totals and persisted display-only projections', () => {
    const { record } = measured()
    const broken = structuredClone(record); broken.days![1].good = 2
    expect(validRecord(broken)).toBe(false)
    expect(validRecord(recordsByDay([record])[0])).toBe(false)
  })
  it('keeps old aggregate-only records intact instead of guessing their daily good time', () => {
    const { record } = measured(); delete record.days
    expect(recordsByDay([record])).toEqual([record])
    expect(validRecord(record)).toBe(true)
  })
  it('does not turn a long unmeasurable gap into valid daily time', () => {
    const ledger = new DailyMeasurementLedger(start)
    ledger.observe({ total: 86_405, valid: 0, good: 0, events: [] })
    expect(ledger.snapshot()).toHaveLength(3)
    expect(ledger.snapshot().reduce((n, row) => n + row.total, 0)).toBe(86_405)
    expect(ledger.snapshot().every(row => row.valid === 0 && row.good === 0)).toBe(true)
  })
  it('handles fractional inference clock ticks at the midnight boundary', () => {
    const ledger = new DailyMeasurementLedger('2026-10-26T23:59:59.900+09:00')
    let elapsed = 0
    for (let i = 0; i < 60; i++) {
      elapsed += 1 / 60
      ledger.observe({ total: elapsed, valid: elapsed, good: elapsed, events: [] })
    }
    expect(ledger.snapshot()).toHaveLength(2)
    expect(ledger.snapshot()[0].total).toBeCloseTo(0.1)
    expect(ledger.snapshot()[1].total).toBeCloseTo(0.9)
  })
  it('accepts a tiny but real first observation fraction after midnight', () => {
    const startedAt = '2026-10-26T23:59:59.950+09:00'
    const ledger = new DailyMeasurementLedger(startedAt)
    ledger.observe({ total: 0.050001, valid: 0.050001, good: 0.050001, events: [] })
    expect(validRecord({ id: 'explicit-fraction', startedAt, endedAt: '2026-10-27T00:00:00.001+09:00',
      total: 0.050001, valid: 0.050001, good: 0.050001, mode: 'camera', events: [], days: ledger.snapshot() })).toBe(true)
  })
})
