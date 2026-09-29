import { describe, expect, it } from 'vitest'
import { compareFirstAndRecent, periodStats } from './comparison'
import type { RecordItem } from './serviceStore'

// 합성 기록만 사용한다. 날짜는 현지 시간 기준.
const NOW = new Date(2026, 8, 28, 12)
const event = (id: number, startAt: number, recoverySec: number | null, alerts = 1) => ({
  id, type: 'forwardHead' as const, startAt, confirmedAt: startAt + 3, endAt: startAt + 30, durationSec: 30, alerts,
  firstAlertAt: startAt + 3, recovered: recoverySec !== null, recoverySec, endedBySession: false, endReason: null, blockId: 0,
})
const record = (id: string, month: number, day: number, valid: number, good: number, events: RecordItem['events'] = []): RecordItem => {
  const end = new Date(2026, month, day, 10)
  return { id, startedAt: new Date(end.getTime() - valid * 1000).toISOString(), endedAt: end.toISOString(), mode: 'camera', total: valid, valid, good, events }
}

describe('first-vs-recent comparison', () => {
  it('reports no records', () => {
    expect(compareFirstAndRecent([], NOW)).toEqual({ status: 'empty' })
  })

  it('waits until the recent window no longer overlaps the first window', () => {
    // 첫 측정 9/25 → 초기 9/25~10/1, 최근 구간이 10/2부터 시작하려면 10/8까지 기다린다.
    const result = compareFirstAndRecent([record('a', 8, 25, 3600, 3000)], NOW)
    expect(result).toEqual({ status: 'waiting', firstDay: '2026-09-25', daysLeft: 10 })
    expect(compareFirstAndRecent([record('a', 8, 15, 3600, 3000)], NOW).status).toBe('short')
  })

  it('compares the first seven days with the last seven days and skips the middle', () => {
    const records = [
      record('early-1', 8, 1, 1200, 600, [event(1, 100, 20), event(2, 400, 40, 2), event(3, 1000, null)]),
      record('early-2', 8, 7, 1200, 600),
      record('middle', 8, 15, 9999, 0, [event(1, 10, 5)]),
      record('recent', 8, 27, 3600, 2700, [event(1, 50, 10)]),
    ]
    const result = compareFirstAndRecent(records, NOW)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.early).toMatchObject({ from: '2026-09-01', to: '2026-09-07', sessions: 2, valid: 2400, keepRate: 0.5, events: 3, alerts: 4 })
    expect(result.early.meanInterval).toBe(450)
    expect(result.early.meanRecovery).toBe(30)
    expect(result.early.perHour).toBeCloseTo(4.5)
    expect(result.recent).toMatchObject({ from: '2026-09-22', to: '2026-09-28', sessions: 1, valid: 3600, keepRate: 0.75, meanInterval: null })
  })

  it('marks the comparison short when either window lacks valid time', () => {
    const result = compareFirstAndRecent([record('early', 8, 1, 3600, 3000), record('recent', 8, 28, 600, 500)], NOW)
    expect(result.status).toBe('short')
  })

  it('keeps unmeasurable-only periods as unavailable rather than zero', () => {
    const stats = periodStats([record('none', 8, 1, 0, 0)], '2026-09-01', '2026-09-07')
    expect(stats.keepRate).toBe(null)
    expect(stats.perHour).toBe(null)
  })
})
