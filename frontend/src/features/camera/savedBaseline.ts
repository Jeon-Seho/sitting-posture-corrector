import type { Features } from '../../../../model/prototype/pose'
import type { CalibrationSummary } from '../../../../model/prototype/calibration'

/**
 * The registered posture survives an app restart on this computer (2026-10-13), so a later
 * 「측정하기」 can start without registering again. Coordinates of the calibration frames are
 * not stored, only the averaged features.
 *
 * There is one posture whatever camera is used (2026-10-16, team decision, plan 0053): a person
 * adjusts the camera to their posture instead of registering again per camera, and training
 * data keeps one reference per person. `deviceId` only records which camera it was taken with.
 * Postures kept per camera for a few hours on 10/16 (`posegood.v2.baselines`) are folded into
 * this one, keeping the newest.
 */
const KEY = 'posegood.v2.baseline'
const LIST_KEY = 'posegood.v2.baselines'

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

function readSingle(): SavedBaseline | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    return validSavedBaseline(value) ? value : null
  } catch {
    return null
  }
}

/** The newest posture of the short-lived per-camera list (2026-10-16), if any. */
function readList(): SavedBaseline | null {
  try {
    const raw = localStorage.getItem(LIST_KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? (value.find(validSavedBaseline) ?? null) : null
  } catch {
    return null
  }
}

/** The registered posture on this computer, whatever camera it was taken with. */
export function readSavedBaseline(): SavedBaseline | null {
  const single = readSingle()
  const listed = readList()
  if (!single || !listed) return single ?? listed
  return Date.parse(listed.savedAt) > Date.parse(single.savedAt) ? listed : single
}

/** Saves the posture, replacing the earlier one; returns what was saved. */
export function writeSavedBaseline(saved: Omit<SavedBaseline, 'schemaVersion' | 'savedAt'>): SavedBaseline {
  const value: SavedBaseline = { schemaVersion: 1, savedAt: new Date().toISOString(), ...saved }
  try {
    localStorage.setItem(KEY, JSON.stringify(value))
    localStorage.removeItem(LIST_KEY)
  } catch {
    /* Storage blocked: the posture lasts for this run only. */
  }
  return value
}
