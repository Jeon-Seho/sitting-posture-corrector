import { afterEach, describe, expect, it } from 'vitest'
import { addDayKey, kstDay, kstDayStart } from '../../lib/kst'
import { noteServerDay, noteServerTime, resetServerClock, serverToday } from './serverClock'

describe('KST days and the server clock (ADR 0029)', () => {
  afterEach(resetServerClock)

  it('reads days in KST whatever the computer time zone', () => {
    expect(kstDay('2026-10-25T14:59:59.999Z')).toBe('2026-10-25')
    expect(kstDay('2026-10-25T15:00:00.000Z')).toBe('2026-10-26')
    expect(new Date(kstDayStart('2026-10-26')).toISOString()).toBe('2026-10-25T15:00:00.000Z')
    expect(addDayKey('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDayKey('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('takes 「오늘」 from the newest server time and never counts on its own', () => {
    noteServerTime('2026-10-25T14:50:00.000Z') // 23:50 KST
    expect(serverToday()).toBe('2026-10-25')
    // An older time (e.g. a long session's start) does not move the day back.
    noteServerTime('2026-10-25T13:00:00.000Z')
    expect(serverToday()).toBe('2026-10-25')
    noteServerTime('2026-10-25T17:00:00.000Z') // 02:00 KST next day
    expect(serverToday()).toBe('2026-10-26')
    noteServerTime('not a time')
    noteServerTime(undefined)
    expect(serverToday()).toBe('2026-10-26')
  })

  it('takes A4 today as it is, and only a newer day moves it', () => {
    noteServerDay('2026-10-26')
    expect(serverToday()).toBe('2026-10-26')
    noteServerDay('2026-10-25')
    noteServerTime('2026-10-25T13:00:00.000Z') // 22:00 KST on the 25th
    expect(serverToday()).toBe('2026-10-26')
    noteServerDay('2026-10-27T00:00:00Z')
    noteServerDay(20261027)
    expect(serverToday()).toBe('2026-10-26')
    noteServerDay('2026-10-27')
    expect(serverToday()).toBe('2026-10-27')
  })
})
