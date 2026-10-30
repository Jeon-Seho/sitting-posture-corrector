import { describe, expect, it } from 'vitest'
import { dailyStats, sessionsOn } from '../features/history/recordsSource'
import { validRecord } from '../features/storage/validation'
import { DEFAULT_RULES } from './posture'
import { kstDay, kstDayStart, addDayKey } from '../lib/kst'
import { EXAMPLE_DAYS, exampleRecords } from './exampleRecords'

describe('발표용 예시 기록 (fixed seed, never stored)', () => {
  const now = new Date('2026-10-30T20:00:00+09:00')
  const records = exampleRecords(now)

  it('is the same every run and stays inside the example window', () => {
    expect(exampleRecords(now)).toEqual(records)
    const first = Date.parse(records[0].startedAt)
    expect(first).toBeGreaterThanOrEqual(kstDayStart(addDayKey(kstDay(now), -(EXAMPLE_DAYS - 1))))
    expect(records.every((r) => Date.parse(r.endedAt) <= now.getTime())).toBe(true)
    // The 기록 tab shows only today, so the example always has today's sessions.
    expect(sessionsOn(records, '2026-10-30')).toHaveLength(2)
    expect(sessionsOn(exampleRecords(new Date('2026-10-30T06:00:00+09:00')), '2026-10-30')).toHaveLength(2)
  })

  it('looks like real records: valid shape, most weekdays measured, the rate improving', () => {
    expect(records.every((r) => validRecord(r))).toBe(true)
    const days = dailyStats(records, addDayKey(kstDay(now), -(EXAMPLE_DAYS - 1)), '2026-10-30')
    expect(days.length).toBeGreaterThan(60)
    const rate = (rows: typeof days) =>
      rows.reduce((n, s) => n + s.good_sec, 0) / rows.reduce((n, s) => n + s.valid_sec, 0)
    expect(rate(days.slice(-20))).toBeGreaterThan(rate(days.slice(0, 20)) + 0.1)
  })
  it('uses current rules, date projections and explicitly synthetic record types', () => {
    expect(records.every(record => record.mode === 'demo' && record.rules?.holdSeconds === DEFAULT_RULES.holdSeconds && record.days?.length === 1)).toBe(true)
    expect(sessionsOn(records, '2026-10-30').some(record => record.valid < 300)).toBe(true)
    for (const record of records) for (const event of record.events) {
      expect(event.type).toBe('referenceChange')
      expect(event.firstAlertAt).toBe(event.confirmedAt)
      if (event.alerts > 1) expect(event.durationSec).toBeGreaterThanOrEqual(DEFAULT_RULES.holdSeconds + DEFAULT_RULES.realertSeconds)
    }
  })
  it('does not put previous-day or future sessions into early-morning examples', () => {
    const at = new Date('2026-10-30T00:05:00+09:00')
    const rows = exampleRecords(at)
    expect(rows.every(record => Date.parse(record.endedAt) <= at.getTime() && validRecord(record))).toBe(true)
    expect(sessionsOn(rows, '2026-10-30').every(record => kstDay(record.startedAt) === '2026-10-30')).toBe(true)
  })

})
