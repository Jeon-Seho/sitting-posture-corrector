import { afterEach, describe, expect, it } from 'vitest'
import { addDayKey, kstDay, kstDayStart } from '../../lib/kst'
import { recordTimes } from '../session/useSessionPersistence'
import { EMPTY_SUMMARY } from '../session/live/messages'
import { noteServerTime, resetServerClock, serverToday } from './serverClock'

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

  it('stores a record with the server start and end', () => {
    const summary = { ...EMPTY_SUMMARY, total_ms: 90_000 }
    const local = '2026-10-26T01:00:03.000Z'
    expect(recordTimes({ startedAt: '2026-10-26T01:00:00.000Z', endedAt: '2026-10-26T01:01:30.000Z', summary }, local)).toEqual({
      startedAt: '2026-10-26T01:00:00.000Z',
      endedAt: '2026-10-26T01:01:30.000Z',
    })
    // No `closed` (lost connection, S4): server start + the server's measured total, as the server stores it.
    expect(recordTimes({ startedAt: '2026-10-26T01:00:00.000Z', endedAt: null, summary }, local)).toEqual({
      startedAt: '2026-10-26T01:00:00.000Z',
      endedAt: '2026-10-26T01:01:30.000Z',
    })
    // Before the server sends the fields (BE-6) the computer's start stands in.
    expect(recordTimes({ startedAt: null, endedAt: null, summary }, local).startedAt).toBe(local)
  })
})
