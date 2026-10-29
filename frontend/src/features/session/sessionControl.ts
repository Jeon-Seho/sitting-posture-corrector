import { useSyncExternalStore } from 'react'

/**
 * The running measurement registers how to end it and publishes its status, so a small camera
 * window can show the posture and end it from outside the measure screen (2026-10-20).
 * Only one measurement runs at a time. 2026-10-26: the web's small windows are gone (plan 0054);
 * kept for the desktop app's small window, which comes next.
 */
export type EndMeasurement = (reason: string) => void

/*
 * A pause left for 10 minutes is ended by the server on its own clock, which then tells the app
 * (2026-10-20, FE proposal 3.2); the app keeps no timer for it.
 */
export const WINDOW_END_REASON = '작은 창을 닫아 측정을 끝냈어요. 그때까지의 기록은 저장했어요.'

let current: EndMeasurement | null = null

export function registerMeasurementEnd(end: EndMeasurement) {
  current = end
  return () => {
    if (current === end) current = null
  }
}

/** Ends the running measurement. False when none is running. */
export function endRunningMeasurement(reason: string) {
  if (!current) return false
  current(reason)
  return true
}

/**
 * What the small window shows: `alert` is a confirmed posture alert (the same moment the app
 * alerts), `unknown` the posture cannot be judged, `paused` a pause. null: no measurement.
 */
export type MeasurementStatus = 'good' | 'alert' | 'unknown' | 'paused'

let status: MeasurementStatus | null = null
const listeners = new Set<() => void>()

export function publishMeasurementStatus(next: MeasurementStatus | null) {
  if (status === next) return
  status = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useMeasurementStatus() {
  return useSyncExternalStore(subscribe, () => status, () => status)
}
