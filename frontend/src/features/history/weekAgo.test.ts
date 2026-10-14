import { describe, expect, it } from 'vitest'
import type { RecordItem } from '../../lib/serviceStore'
import { weekAgoLine } from './weekAgo'

const rec = (id: string, day: number, valid: number, good: number): RecordItem => ({
  id,
  startedAt: new Date(2026, 9, day, 10).toISOString(),
  endedAt: new Date(2026, 9, day, 11).toISOString(),
  mode: 'camera',
  total: valid,
  valid,
  good,
  events: [],
})

describe('same weekday last week (synthetic records)', () => {
  it('says how the day compares with the same weekday a week before', () => {
    expect(weekAgoLine([rec('a', 6, 1000, 600), rec('b', 13, 1000, 750)], '2026-10-13')).toBe(
      '지난주 화요일 60% · 15%p 올랐어요',
    )
    expect(weekAgoLine([rec('a', 6, 1000, 800), rec('b', 13, 1000, 700)], '2026-10-13')).toBe(
      '지난주 화요일 80% · 10%p 내려갔어요',
    )
    expect(weekAgoLine([rec('b', 13, 1000, 700)], '2026-10-13')).toBe('지난주 화요일에는 측정하지 않았어요')
    expect(weekAgoLine([rec('a', 6, 1000, 700)], '2026-10-13')).toBe('지난주 화요일 70%')
  })
})
