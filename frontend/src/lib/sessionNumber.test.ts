import { describe, expect, it } from 'vitest'
import { daySessionNumber, localDay, sessionLabel } from './sessionNumber'

// Local times so the test does not depend on the machine's time zone.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString()

describe('per-day session numbers', () => {
  const starts = [at(13, 9), at(13, 14), at(13, 18, 30), at(14, 8)]

  it('numbers sessions of one day in start order', () => {
    expect(starts.slice(0, 3).map((s) => daySessionNumber(starts, s))).toEqual([1, 2, 3])
  })

  it('restarts at 1 on the next day', () => {
    expect(daySessionNumber(starts, at(14, 8))).toBe(1)
    expect(daySessionNumber(starts, at(14, 20))).toBe(2)
  })

  it('numbers a new session after the saved ones of the same day', () => {
    expect(daySessionNumber(starts, at(13, 21))).toBe(4)
    expect(daySessionNumber([], at(13, 21))).toBe(1)
  })

  it('uses the local calendar day and a readable label', () => {
    expect(localDay(at(13, 23, 59))).toBe('2026-10-13')
    expect(localDay(at(14, 0, 1))).toBe('2026-10-14')
    expect(sessionLabel(at(13, 14), 2)).toBe('2026-10-13 · 세션 2')
  })
})
