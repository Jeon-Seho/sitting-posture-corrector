import { kstDay } from './kst'

/**
 * A session is one measurement from 「시작」 to 「종료」. Sessions are numbered per KST
 * calendar day in start order: the first session of 2026-10-13 is 1, the next is 2, and
 * the count restarts at 1 on 2026-10-14.
 */

/** KST calendar day of an ISO time, e.g. "2026-10-13". */
export const localDay = kstDay

/**
 * Number of the session that started at `startedAt` among `otherStarts`. Earlier starts on the
 * same local day come first; a start equal to `startedAt` (the session itself) is not counted.
 */
export function daySessionNumber(otherStarts: readonly string[], startedAt: string): number {
  const day = localDay(startedAt)
  const at = Date.parse(startedAt)
  return otherStarts.filter((s) => localDay(s) === day && Date.parse(s) < at).length + 1
}

/** "2026-10-13 · 세션 2" */
export function sessionLabel(startedAt: string, number: number): string {
  return `${localDay(startedAt)} · 세션 ${number}`
}
