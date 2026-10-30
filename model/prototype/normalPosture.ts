/** Research-only, fitted personal normal envelope; not a pretrained posture classifier. */

export const NORMAL_POSTURE_SPEC = {
  featureVersion: 'mediapipe-shoulder-normalized-centroids-v1' as const,
  minimumValidMs: 30_000,
  minimumFrames: 100,
  maximumGapMs: 250,
  quantile: .95,
  spreadMultiplier: 1.5,
  // Development floors in shoulder-width units, not validated medical thresholds.
  floors: [.12, .12, .12, .12, .12, .12, .10, .10, .10],
}
export type NormalCollectionPurpose = 'training_normal' | 'personal_calibration'
export interface NormalProfileMetadata {
  poseModelId?: string
  id: string
  participantCode: string
  sessionCode: string
  purpose: NormalCollectionPurpose
  createdAt: string
}
export interface NormalPostureProfile {
  schema_version: 'normal-posture-profile-v1'
  id: string
  featureVersion: typeof NORMAL_POSTURE_SPEC.featureVersion
  domainValidated: false
  baseline: number[]
  center: number[]
  tolerance: number[]
  provenance: NormalProfileMetadata & { frames: number; validMs: number; review: 'user_confirmed_normal'; source: 'webcam' }
  fitting: { quantile: number; spreadMultiplier: number; floors: number[] }
}
export interface NormalProfileSample { timeMs: number; values: number[]; segment?: number }
const vector = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every(x => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 100)
const quantile = (v: number[], q: number) => [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) * q)]
export const validNormalCode = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{2,48}$/.test(v)
export const validPoseModelId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/.test(v)

/** Missing legacy provenance is unknown, never evidence of extractor compatibility. */
export function normalProfileMatchesPoseModel(profile: NormalPostureProfile, poseModelId: string | undefined) {
  return validPoseModelId(poseModelId) && profile.provenance.poseModelId === poseModelId
}

/** Same 39D order/coordinate definition as liveForecastPoints, never image/display coordinates. */
export function extractNormalFeatures(values: number[]): number[] | null {
  if (!vector(values, 39)) return null
  const mean = (start: number, count: number) => [0, 1, 2].map(axis =>
    values.slice(start * 3, (start + count) * 3).filter((_, i) => i % 3 === axis).reduce((a, b) => a + b, 0) / count)
  return [...mean(0, 9), ...mean(9, 2), ...[0, 1, 2].map(axis => values[36 + axis] - values[33 + axis])]
}
function metadataValid(meta: NormalProfileMetadata) {
  return meta && typeof meta.id === 'string' && /^[A-Za-z0-9_-]{2,80}$/.test(meta.id) &&
    validNormalCode(meta.participantCode) && validNormalCode(meta.sessionCode) &&
    ['training_normal', 'personal_calibration'].includes(meta.purpose) && Number.isFinite(Date.parse(meta.createdAt)) &&
    (meta.poseModelId === undefined || validPoseModelId(meta.poseModelId))
}
export function fitNormalPostureProfile(samples: NormalProfileSample[], metadata: NormalProfileMetadata): NormalPostureProfile {
  if (!metadataValid(metadata)) throw new Error('익명 참여자·세션 코드와 수집 목적을 확인해 주세요.')
  let validMs = 0
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i], previous = samples[i - 1]
    if (!Number.isFinite(s.timeMs) || s.timeMs < 0 || !extractNormalFeatures(s.values) ||
      (previous && s.timeMs <= previous.timeMs)) throw new Error('정상 구간의 좌표 또는 시간 순서가 잘못됐습니다.')
    if (previous && s.segment === previous.segment && s.timeMs - previous.timeMs <= NORMAL_POSTURE_SPEC.maximumGapMs) validMs += s.timeMs - previous.timeMs
  }
  if (samples.length < NORMAL_POSTURE_SPEC.minimumFrames || validMs < NORMAL_POSTURE_SPEC.minimumValidMs) {
    throw new Error('개인 정상 범위에는 유효 관측 30초와 최소 100개 표본이 필요합니다.')
  }
  const rows = samples.map(s => extractNormalFeatures(s.values)!)
  const baseline = Array.from({ length: 39 }, (_, i) => quantile(samples.map(s => s.values[i]), .5))
  const center = Array.from({ length: 9 }, (_, i) => quantile(rows.map(row => row[i]), .5))
  const tolerance = center.map((v, i) => Math.max(NORMAL_POSTURE_SPEC.floors[i],
    quantile(rows.map(row => Math.abs(row[i] - v)), NORMAL_POSTURE_SPEC.quantile) * NORMAL_POSTURE_SPEC.spreadMultiplier))
  return { schema_version: 'normal-posture-profile-v1', id: metadata.id,
    featureVersion: NORMAL_POSTURE_SPEC.featureVersion, domainValidated: false, baseline, center, tolerance,
    provenance: { ...metadata, frames: samples.length, validMs, review: 'user_confirmed_normal', source: 'webcam' },
    fitting: { quantile: NORMAL_POSTURE_SPEC.quantile, spreadMultiplier: NORMAL_POSTURE_SPEC.spreadMultiplier, floors: [...NORMAL_POSTURE_SPEC.floors] } }
}

export function readNormalPostureProfile(value: unknown): NormalPostureProfile {
  const p = value as NormalPostureProfile
  if (!p || p.schema_version !== 'normal-posture-profile-v1' || p.featureVersion !== NORMAL_POSTURE_SPEC.featureVersion ||
    p.domainValidated !== false || !metadataValid(p.provenance) || p.id !== p.provenance.id ||
    p.provenance.source !== 'webcam' || p.provenance.review !== 'user_confirmed_normal' ||
    !Number.isInteger(p.provenance.frames) || p.provenance.frames < NORMAL_POSTURE_SPEC.minimumFrames ||
    !Number.isFinite(p.provenance.validMs) || p.provenance.validMs < NORMAL_POSTURE_SPEC.minimumValidMs ||
    !vector(p.baseline, 39) || !vector(p.center, 9) || !vector(p.tolerance, 9) ||
    p.tolerance.some((v, i) => v < NORMAL_POSTURE_SPEC.floors[i]) ||
    p.fitting?.quantile !== NORMAL_POSTURE_SPEC.quantile || p.fitting.spreadMultiplier !== NORMAL_POSTURE_SPEC.spreadMultiplier ||
    !vector(p.fitting.floors, 9) || p.fitting.floors.some((v, i) => v !== NORMAL_POSTURE_SPEC.floors[i])) {
    throw new Error('지원하지 않거나 손상된 개인 정상 범위 파일입니다.')
  }
  return { schema_version: p.schema_version, id: p.id, featureVersion: p.featureVersion, domainValidated: false,
    baseline: [...p.baseline], center: [...p.center], tolerance: [...p.tolerance],
    provenance: { id: p.provenance.id, participantCode: p.provenance.participantCode, sessionCode: p.provenance.sessionCode,
      purpose: p.provenance.purpose, createdAt: p.provenance.createdAt, frames: p.provenance.frames, validMs: p.provenance.validMs,
      ...(p.provenance.poseModelId ? { poseModelId: p.provenance.poseModelId } : {}),
      source: 'webcam', review: 'user_confirmed_normal' },
    fitting: { quantile: p.fitting.quantile, spreadMultiplier: p.fitting.spreadMultiplier, floors: [...p.fitting.floors] } }
}

/**
 * score=1 is the fitted envelope boundary, not a probability or a health score.
 * Registration never moves the learned center: otherwise a rejected pose could
 * become score zero merely by registering it again.
 */
export function scoreNormalPosture(profile: NormalPostureProfile, values: number[]) {
  const features = extractNormalFeatures(values)
  if (!features || !vector(profile.center, 9) || !vector(profile.tolerance, 9) || profile.tolerance.some(x => x <= 0)) return null
  const featureRatios = features.map((v, i) => Math.abs(v - profile.center[i]) / profile.tolerance[i])
  return { score: Math.max(...featureRatios), featureRatios }
}
