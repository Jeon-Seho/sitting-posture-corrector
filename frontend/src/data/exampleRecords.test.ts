import { describe, expect, it } from 'vitest'
import { dailyStats, sessionsOn } from '../features/history/recordsSource'
import { validRecord } from '../features/storage/validation'
import { EXAMPLE_DAYS, exampleRecords } from './exampleRecords'

describe('발표용 예시 기록 (fixed seed, never stored)', () => {
  const now = new Date(2026, 9, 14, 20)
  const records = exampleRecords(now)

  it('is the same every run and stays inside the example window', () => {
    expect(exampleRecords(now)).toEqual(records)
    const first = Date.parse(records[0].startedAt)
    expect(first).toBeGreaterThanOrEqual(new Date(2026, 9, 14 - (EXAMPLE_DAYS - 1)).getTime())
    expect(records.every((r) => Date.parse(r.endedAt) <= now.getTime())).toBe(true)
    // The 기록 tab shows only today, so the example always has today's sessions.
    expect(sessionsOn(records, '2026-10-14')).toHaveLength(2)
    expect(sessionsOn(exampleRecords(new Date(2026, 9, 14, 6)), '2026-10-14')).toHaveLength(2)
  })

  it('looks like real records: valid shape, most weekdays measured, the rate improving', () => {
    expect(records.every((r) => validRecord(r))).toBe(true)
    const days = dailyStats(records, '2026-06-17', '2026-10-14')
    expect(days.length).toBeGreaterThan(60)
    const rate = (rows: typeof days) =>
      rows.reduce((n, s) => n + s.good_sec, 0) / rows.reduce((n, s) => n + s.valid_sec, 0)
    expect(rate(days.slice(-20))).toBeGreaterThan(rate(days.slice(0, 20)) + 0.1)
  })
})
