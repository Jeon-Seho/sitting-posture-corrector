import { describe, expect, it } from 'vitest'
import type { RecordItem } from '../../lib/serviceStore'
import { activityLevel, addDays, dailyStats, sessionsOn } from './recordsSource'

const at = (day: number, hour: number) => new Date(2026, 9, day, hour).toISOString()
const rec = (id: string, day: number, hour: number, valid: number, good: number, total = valid): RecordItem => ({
  id,
  startedAt: at(day, hour),
  endedAt: new Date(Date.parse(at(day, hour)) + total * 1000).toISOString(),
  mode: 'camera',
  total,
  valid,
  good,
  events: [],
})

describe('records data shaped like the server API (synthetic records)', () => {
  const records = [rec('a', 11, 9, 600, 300), rec('b', 13, 9, 1200, 900, 1300), rec('c', 13, 15, 600, 600)]

  it('lists one day newest first, like GET /records?date', () => {
    expect(sessionsOn(records, '2026-10-13').map((r) => r.id)).toEqual(['c', 'b'])
    expect(sessionsOn(records, '2026-10-12')).toEqual([])
  })

  it('sums days in a range, like GET /stats/daily', () => {
    expect(dailyStats(records, '2026-10-01', '2026-10-31')).toMatchObject([
      { date: '2026-10-11', valid_sec: 600, good_ratio: 0.5, session_count: 1 },
      { date: '2026-10-13', valid_sec: 1800, good_sec: 1500, session_count: 2, excluded_sec: 100 },
    ])
    expect(dailyStats(records, '2026-10-12', '2026-10-12')).toEqual([])
  })

  it('steps days across months and grades measured time', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect([0, 300, 600, 1800, 3600].map(activityLevel)).toEqual([0, 1, 2, 3, 4])
  })
})
