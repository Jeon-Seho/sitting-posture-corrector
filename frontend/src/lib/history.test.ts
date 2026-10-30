import { describe, expect, it } from 'vitest'
import { dailyHistory, historyFor } from './history'
import type { RecordItem } from './serviceStore'

const item = (
  id: string,
  day: number,
  mode: RecordItem['mode'],
  valid: number,
  good: number,
): RecordItem => {
  const iso = new Date(`2026-09-${String(day).padStart(2, '0')}T12:00:00+09:00`).toISOString()
  return { id, startedAt: iso, endedAt: iso, mode, total: valid, valid, good, events: [] }
}
describe('local history (synthetic records)', () => {
  // 「오늘」 comes from the server as a KST day (ADR 0029).
  const now = '2026-09-30'
  const records = [
    item('old', 1, 'camera', 100, 100),
    item('edge', 24, 'camera', 100, 90),
    item('today', 30, 'camera', 900, 0),
    item('demo', 30, 'demo', 100, 100),
    item('future', 31, 'camera', 100, 100),
  ]
  it('filters today, last 7 and 30 days by KST start date and keeps synthetic modes separate', () => {
    expect(historyFor(records, 'camera', 'today', now).map((r) => r.id)).toEqual(['today'])
    expect(historyFor(records, 'camera', 'week', now).map((r) => r.id)).toEqual(['edge', 'today'])
    expect(historyFor(records, 'camera', 'month', now).map((r) => r.id)).toEqual([
      'old',
      'edge',
      'today',
    ])
    expect(historyFor(records, 'demo', 'all', now).map((r) => r.id)).toEqual(['demo'])
    expect(historyFor(records, 'all', 'today', now).map((r) => r.id)).toEqual(['today', 'demo'])
  })
  it('creates only measured dates, weights same-day sessions by valid duration and preserves zero denominators', () => {
    const days = dailyHistory([
      item('one', 30, 'camera', 100, 90),
      item('two', 30, 'camera', 900, 0),
      item('zero', 29, 'camera', 0, 0),
    ])
    expect(days).toHaveLength(2)
    expect(days[0].rate).toBeNull()
    expect(days[1]).toMatchObject({ sessions: 2, valid: 1000, good: 90, rate: 0.09 })
  })
  it('puts a record on its KST start day whatever the computer time zone', () => {
    // 23:30 KST is 14:30 UTC the same day; 00:30 KST is 15:30 UTC the day before.
    const late = { ...item('late', 1, 'camera', 1, 1), startedAt: '2026-09-29T14:30:00.000Z' }
    const early = { ...item('early', 1, 'camera', 1, 1), startedAt: '2026-09-29T15:30:00.000Z' }
    expect(historyFor([late, early], 'all', 'today', '2026-09-30').map((r) => r.id)).toEqual(['early'])
    expect(dailyHistory([late, early]).map((d) => d.date)).toEqual(['2026-09-29', '2026-09-30'])
  })
})
