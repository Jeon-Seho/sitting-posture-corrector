import {
  extractNormalFeatures,
  normalProfileMatchesPoseModel,
  readNormalPostureProfile,
  scoreNormalPosture,
  validPoseModelId,
  type NormalPostureProfile,
} from './normalPosture'

export type NormalReferenceStatus = 'accepted' | 'rejected' | 'incompatible' | 'insufficient'
export type NormalReferenceReason = 'within_normal_range' | 'outside_normal_range' |
  'profile_missing' | 'profile_invalid' | 'profile_not_personal' |
  'pose_model_unknown' | 'pose_model_mismatch' | 'candidate_invalid'
export interface NormalReferenceFeature {
  index: number
  group: 'face' | 'ears' | 'shoulders'
  axis: 'x' | 'y' | 'z'
  /** Signed displacement in shoulder-width units, not a diagnosed posture type. */
  delta: number
  /** Absolute displacement divided by the learned feature tolerance. */
  ratio: number
}
export interface NormalReferenceValidation {
  status: NormalReferenceStatus
  reason: NormalReferenceReason
  score: number | null
  strongestFeature: NormalReferenceFeature | null
  profileId: string | null
}

/**
 * Check a quality-approved registration candidate against the user's confirmed
 * personal normal envelope. The caller owns reference duration/quality gating.
 * Unknown or different extractors cannot establish compatibility. This helper
 * never fits, recenters, or changes the supplied profile/candidate.
 */
export function validateNormalReference(
  profile: NormalPostureProfile | null,
  candidate: { values: number[] | null; poseModelId?: string },
): NormalReferenceValidation {
  const unavailable = (status: 'incompatible' | 'insufficient', reason: NormalReferenceReason,
    profileId: string | null = null): NormalReferenceValidation =>
    ({ status, reason, score: null, strongestFeature: null, profileId })
  if (!profile) return unavailable('insufficient', 'profile_missing')
  let checked: NormalPostureProfile
  try { checked = readNormalPostureProfile(profile) }
  catch { return unavailable('insufficient', 'profile_invalid') }
  if (checked.provenance.purpose !== 'personal_calibration') {
    return unavailable('incompatible', 'profile_not_personal', checked.id)
  }
  if (!validPoseModelId(checked.provenance.poseModelId) || !validPoseModelId(candidate.poseModelId)) {
    return unavailable('incompatible', 'pose_model_unknown', checked.id)
  }
  if (!normalProfileMatchesPoseModel(checked, candidate.poseModelId)) {
    return unavailable('incompatible', 'pose_model_mismatch', checked.id)
  }
  const features = candidate.values && extractNormalFeatures(candidate.values)
  const scored = candidate.values && scoreNormalPosture(checked, candidate.values)
  if (!features || !scored) return unavailable('insufficient', 'candidate_invalid', checked.id)
  const index = scored.featureRatios.indexOf(scored.score)
  const strongestFeature: NormalReferenceFeature | null = scored.score === 0 ? null : {
    index,
    group: (['face', 'ears', 'shoulders'] as const)[Math.floor(index / 3)],
    axis: (['x', 'y', 'z'] as const)[index % 3],
    delta: features[index] - checked.center[index],
    ratio: scored.featureRatios[index],
  }
  const accepted = scored.score <= 1
  return { status: accepted ? 'accepted' : 'rejected',
    reason: accepted ? 'within_normal_range' : 'outside_normal_range',
    score: scored.score, strongestFeature, profileId: checked.id }
}
