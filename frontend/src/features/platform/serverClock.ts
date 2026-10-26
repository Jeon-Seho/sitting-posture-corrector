import { useSyncExternalStore } from 'react'
import { kstDay } from '../../lib/kst'

/**
 * 「오늘」 comes from the server (ADR 0029): the KST day of the newest server time the app has
 * received — A4 `server_time`, WS `ready.started_at`, `closed.ended_at`. The app never counts time
 * forward on its own; the day changes when the next server time arrives.
 * Until the server sends these fields (FE proposal BE-6) the computer's clock stands in, read as KST.
 */
let newest: number | null = null
const listeners = new Set<() => void>()

/** Records a server time (ISO 8601). Ignores anything that is not a time, and older times. */
export function noteServerTime(iso: unknown) {
  if (typeof iso !== 'string') return
  const at = Date.parse(iso)
  if (!Number.isFinite(at) || (newest !== null && at <= newest)) return
  const before = serverToday()
  newest = at
  if (serverToday() !== before) for (const listener of listeners) listener()
}

/** Today's KST day key, e.g. "2026-10-26". */
export function serverToday(): string {
  return kstDay(newest ?? Date.now())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Re-renders when a newer server time moves 「오늘」 to another day. */
export function useServerToday(): string {
  return useSyncExternalStore(subscribe, serverToday, serverToday)
}

/** Tests only. */
export function resetServerClock() {
  newest = null
}
