import { BASELINE_LANDMARKS, features, type Anchors, type Landmark } from '../../../../model/prototype/pose'
import { validLandmarks, validUuid } from '../session/server/validation'

export type SavedBaseline = {
  schema_version: '2.0'
  baseline_id: string
  registered_at: string
  landmarks: Anchors
}

export function validBaseline(value: unknown): value is SavedBaseline {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<SavedBaseline>
  return v.schema_version === '2.0' && validUuid(v.baseline_id) &&
    typeof v.registered_at === 'string' && Number.isFinite(Date.parse(v.registered_at)) &&
    validLandmarks(v.landmarks) && baselineFeatures(v.landmarks, 640, 480) !== null
}

/** DB stores normalized mean coordinates. Rebuild with the current frame's aspect ratio.
 * Visibility 1 denotes an accepted baseline, not a newly measured confidence value. */
export function baselineFeatures(landmarks: Anchors, width: number, height: number) {
  const points: Landmark[] = []
  for (const [name, index] of Object.entries(BASELINE_LANDMARKS)) {
    const point = landmarks[name as keyof Anchors]
    points[index] = { ...point, z: 0, visibility: 1 }
  }
  return features(points, width, height)
}
