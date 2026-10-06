/** Experimental feature transport; no video, landmarks or participant identifiers. */
import { validFeatures, type Features } from './pose'

export const FEATURE_VERSION = 'shoulder-relative-deltas-v1' as const

/** Signed current−baseline values, already normalized by shoulder width. */
export interface FeatureDeltas {
  head_gap_delta: number
  lateral_offset_delta: number
  shoulder_tilt_delta: number
  current_quality: number
  baseline_quality: number
}

export function featureDeltas(
  current: Features | null,
  baseline: Features | null,
): FeatureDeltas | null {
  // Preserve the local prototype's unvalidated 0.65 quality threshold.
  if (!validFeatures(current) || !validFeatures(baseline)) return null

  const deltas: FeatureDeltas = {
    head_gap_delta: current.headGap - baseline.headGap,
    lateral_offset_delta: current.offset - baseline.offset,
    shoulder_tilt_delta: current.tilt - baseline.tilt,
    current_quality: current.quality,
    baseline_quality: baseline.quality,
  }

  // Finite inputs can still overflow during subtraction. Never clamp raw deltas.
  return Object.values(deltas).every(Number.isFinite) ? deltas : null
}
