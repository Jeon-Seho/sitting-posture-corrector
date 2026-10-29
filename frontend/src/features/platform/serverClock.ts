import { useSyncExternalStore } from 'react'
import { kstDay } from '../../lib/kst'

/**
 * 「오늘」 comes from the server (ADR 0029): the newest KST day the app has received — A4 `today`,
 * and the KST day of WS `ready.started_at`, `closed.ended_at`. The app never counts time forward on
 * its own; the day changes when the next server value arrives.
 * Until the server sends these fields (FE proposal BE-6) the computer's clock stands in, read as KST.
 */
let newest: string | null = null
const listeners = new Set<() => void>()
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

/** Records a server day ("YYYY-MM-DD", KST). Ignores anything else, and older days. */
export function noteServerDay(day: unknown) {
  if (typeof day !== 'string' || !DAY_KEY.test(day) || (newest !== null && day <= newest)) return
  const before = serverToday()
  newest = day
  if (serverToday() !== before) for (const listener of listeners) listener()
}

/** Records a server time (ISO 8601) by its KST day. Ignores anything that is not a time. */
export function noteServerTime(iso: unknown) {
  if (typeof iso !== 'string' || !Number.isFinite(Date.parse(iso))) return
  noteServerDay(kstDay(iso))
}

/** Today's KST day key, e.g. "2026-10-26". */
export function serverToday(): string {
  return newest ?? kstDay(Date.now())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Re-renders when a newer server value moves 「오늘」 to another day. */
export function useServerToday(): string {
  return useSyncExternalStore(subscribe, serverToday, serverToday)
}

/** Tests only. */
export function resetServerClock() {
  newest = null
}
