import type { Features } from '../../../../model/prototype/pose'
import type { CalibrationSummary } from '../../../../model/prototype/calibration'

/**
 * The registered posture survives an app restart on this computer (2026-10-13), so a later
 * 「측정하기」 can start without registering again. It belongs to the camera it was taken
 * with: another camera means a new position, so it is not used there. Coordinates of the
 * calibration frames are not stored, only the averaged features.
 */
const KEY = 'posegood.v2.baseline'

export type SavedBaseline = {
  schemaVersion: 1
  deviceId: string
  calibrationId: string
  baseline: Features
  summary: CalibrationSummary | null
  savedAt: string
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function validFeatures(v: unknown): v is Features {
  if (!v || typeof v !== 'object') return false
  const f = v as Record<string, unknown>
  return (
    finite(f.headGap) &&
    finite(f.offset) &&
    finite(f.tilt) &&
    finite(f.quality) &&
    (f.turn === undefined || finite(f.turn))
  )
}

export function validSavedBaseline(v: unknown): v is SavedBaseline {
  if (!v || typeof v !== 'object') return false
  const s = v as Record<string, unknown>
  return (
    s.schemaVersion === 1 &&
    typeof s.deviceId === 'string' &&
    s.deviceId.length <= 256 &&
    typeof s.calibrationId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(s.calibrationId) &&
    validFeatures(s.baseline) &&
    (s.summary === null || typeof s.summary === 'object') &&
    typeof s.savedAt === 'string' &&
    !Number.isNaN(Date.parse(s.savedAt))
  )
}

export function readSavedBaseline(): SavedBaseline | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    return validSavedBaseline(value) ? value : null
  } catch {
    return null
  }
}

export function writeSavedBaseline(saved: Omit<SavedBaseline, 'schemaVersion' | 'savedAt'>) {
  try {
    const value: SavedBaseline = { schemaVersion: 1, savedAt: new Date().toISOString(), ...saved }
    localStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    /* Storage blocked: the posture lasts for this run only. */
  }
}

/** A posture taken with another camera does not apply; an unknown id on either side does. */
export function baselineFits(saved: Pick<SavedBaseline, 'deviceId'>, deviceId: string) {
  return !saved.deviceId || !deviceId || saved.deviceId === deviceId
}
