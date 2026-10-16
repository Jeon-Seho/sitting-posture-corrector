import type { Features } from '../../../../model/prototype/pose'
import type { CalibrationSummary } from '../../../../model/prototype/calibration'

/**
 * The registered posture survives an app restart on this computer (2026-10-13), so a later
 * 「측정하기」 can start without registering again. It belongs to the camera it was taken
 * with: another camera means a new position, so it is not used there. Coordinates of the
 * calibration frames are not stored, only the averaged features.
 *
 * Since 2026-10-16 one posture is kept per camera (plan 0053), so switching between a laptop
 * camera and a USB camera, or unplugging and plugging one back, finds that camera's posture.
 * The older single-posture key is still read once and carried over.
 */
const KEY = 'posegood.v2.baseline'
const LIST_KEY = 'posegood.v2.baselines'
/** Enough for every camera a person plugs into one computer; the oldest is dropped first. */
const MAX_CAMERAS = 8

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

function readLegacy(): SavedBaseline | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    return validSavedBaseline(value) ? value : null
  } catch {
    return null
  }
}

/** Postures by camera, newest first. Damaged entries are skipped. */
export function readSavedBaselines(): SavedBaseline[] {
  try {
    const raw = localStorage.getItem(LIST_KEY)
    if (raw) {
      const value: unknown = JSON.parse(raw)
      if (Array.isArray(value)) return value.filter(validSavedBaseline).slice(0, MAX_CAMERAS)
    }
  } catch {
    return []
  }
  const legacy = readLegacy()
  return legacy ? [legacy] : []
}

/** The newest posture on this computer, whatever camera it was taken with. */
export function readSavedBaseline(): SavedBaseline | null {
  return readSavedBaselines()[0] ?? null
}

/** Saves a posture for its camera, replacing that camera's earlier one; returns the new list. */
export function writeSavedBaseline(
  saved: Omit<SavedBaseline, 'schemaVersion' | 'savedAt'>,
  list: SavedBaseline[] = readSavedBaselines(),
): SavedBaseline[] {
  const value: SavedBaseline = { schemaVersion: 1, savedAt: new Date().toISOString(), ...saved }
  const next = [value, ...list.filter((s) => s.deviceId !== value.deviceId)].slice(0, MAX_CAMERAS)
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(next))
    localStorage.removeItem(KEY)
  } catch {
    /* Storage blocked: the posture lasts for this run only. */
  }
  return next
}

/** A posture taken with another camera does not apply; an unknown id on either side does. */
export function baselineFits(saved: Pick<SavedBaseline, 'deviceId'>, deviceId: string) {
  return !saved.deviceId || !deviceId || saved.deviceId === deviceId
}

/**
 * The posture for the connected camera: the one taken with it, else one whose camera was
 * unknown. When the connected camera itself is unknown, the newest posture is used.
 */
export function baselineFor(list: SavedBaseline[], deviceId: string): SavedBaseline | null {
  if (!deviceId) return list[0] ?? null
  return list.find((s) => s.deviceId === deviceId) ?? list.find((s) => !s.deviceId) ?? null
}
