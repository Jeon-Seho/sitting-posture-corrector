import { liveForecastPoints } from '../../../../model/prototype/forecast'
import { extractNormalFeatures, fitNormalPostureProfile, NORMAL_POSTURE_SPEC, validNormalCode, validPoseModelId,
  type NormalCollectionPurpose, type NormalPostureProfile } from '../../../../model/prototype/normalPosture'
import type { Landmark } from '../../../../model/prototype/pose'
import type { Observation } from '../camera/types'

export const NORMAL_COLLECTION_LIMITS = { preparationMs: 3000, targetValidMs: 30_000, maxWallMs: 120_000,
  minSampleIntervalMs: 100, maxSamples: 1200, maxGaps: 600, maxFileBytes: 100_000 } as const
export type DeveloperCollectionPurpose = NormalCollectionPurpose | 'forecast_evaluation'
export interface DeveloperCollectionMetadata<P extends DeveloperCollectionPurpose = DeveloperCollectionPurpose> {
  participantCode: string; sessionCode: string; purpose: P
}
export type NormalCollectionMetadata = DeveloperCollectionMetadata<NormalCollectionPurpose>
export type NormalCollectionPhase = 'idle' | 'preparing' | 'collecting' | 'review' | 'confirmed'
export interface NormalCollectionSnapshot {
  phase: NormalCollectionPhase
  metadata: DeveloperCollectionMetadata | null
  preparationRemainingMs: number
  validMs: number
  targetMs: number
  samples: number
  rejectedFrames: number
  gaps: number
  quality: 'waiting' | 'valid' | 'unmeasurable'
  canConfirm: boolean
  reason: string
}
interface CollectedFrame { poseModelId?: string; timeMs: number; videoTimeMs: number; segment: number; width: number; height: number;
  image: Landmark[]; world: Landmark[]; values: number[] }
interface CollectionGap { timeMs: number; reason: 'quality' | 'gap' | 'hidden' | 'interrupted' }
interface CollectionDatasetBase {
  id: string
  source: 'webcam'
  collectionMethod: 'manual_30s'
  createdAt: string
  featureVersion: typeof NORMAL_POSTURE_SPEC.featureVersion
  validMs: number
  timing: { unit: 'ms'; origin: 'explicit_collection_start'; preparationMs: number; maxGapMs: number; interpolation: false }
  frames: CollectedFrame[]
  gaps: CollectionGap[]
}
export interface NormalCollectionDataset extends CollectionDatasetBase {
  schema_version: 'normal-posture-collection-v1'
  label: 'normal_assumed'
  labelDisplay: '정상자세(수동)'
  review: 'user_confirmed_normal'
  metadata: NormalCollectionMetadata & { poseModelId?: string }
  profile: NormalPostureProfile
}
export interface ForecastEvaluationDataset extends CollectionDatasetBase {
  schema_version: 'forecast-evaluation-collection-v1'
  dataRole: 'evaluation_only'
  trainingAllowed: false
  review: 'user_confirmed_evaluation'
  metadata: DeveloperCollectionMetadata<'forecast_evaluation'> & { poseModelId?: string }
}
export type DeveloperCollectionDataset = NormalCollectionDataset | ForecastEvaluationDataset
export const emptyNormalCollection = (): NormalCollectionSnapshot => ({ phase: 'idle', metadata: null, preparationRemainingMs: 3000,
  validMs: 0, targetMs: 30_000, samples: 0, rejectedFrames: 0, gaps: 0, quality: 'waiting', canConfirm: false, reason: '' })
const copyLandmark = ({ x, y, z, visibility }: Landmark): Landmark => ({ x, y, z, ...(Number.isFinite(visibility) ? { visibility } : {}) })

/** Explicit opt-in collection only. No browser persistence, network or inferred labels. */
export class NormalCollectionCapture<P extends DeveloperCollectionPurpose = DeveloperCollectionPurpose> {
  private phase: NormalCollectionPhase = 'preparing'
  private frames: CollectedFrame[] = []
  private gaps: CollectionGap[] = []
  private validMs = 0
  private rejected = 0
  private segment = 0
  private lastObserved: number | null = null
  private lastVideoTime: number | null = null
  private lastValid: number | null = null
  private quality: NormalCollectionSnapshot['quality'] = 'waiting'
  private reason = ''
  private profile: NormalPostureProfile | null = null
  private poseModelId: string | undefined
  constructor(readonly metadata: DeveloperCollectionMetadata<P>, readonly id: string, readonly createdAt: string, readonly startedMs: number) {
    if (!validNormalCode(metadata.participantCode) || !validNormalCode(metadata.sessionCode) ||
      !['training_normal', 'personal_calibration', 'forecast_evaluation'].includes(metadata.purpose)) throw new Error('익명 코드는 영문·숫자·밑줄·하이픈 2~48자로 입력해 주세요.')
    this.metadata = { participantCode: metadata.participantCode, sessionCode: metadata.sessionCode, purpose: metadata.purpose }
  }
  get active() { return this.phase === 'preparing' || this.phase === 'collecting' }
  snapshot(now: number): NormalCollectionSnapshot {
    return { phase: this.phase, metadata: { ...this.metadata }, preparationRemainingMs: Math.max(0, NORMAL_COLLECTION_LIMITS.preparationMs - (now - this.startedMs)),
      validMs: this.validMs, targetMs: NORMAL_COLLECTION_LIMITS.targetValidMs, samples: this.frames.length, rejectedFrames: this.rejected,
      gaps: this.gaps.length, quality: this.quality,
      canConfirm: this.phase === 'review' && this.validMs >= NORMAL_POSTURE_SPEC.minimumValidMs && this.frames.length >= NORMAL_POSTURE_SPEC.minimumFrames,
      reason: this.reason }
  }
  tick(now: number, hidden = false) {
    if (!this.active) return
    if (hidden) { this.invalidate(now, 'hidden'); this.finish('탭을 벗어나 수집을 중단했습니다.'); return }
    if (now - this.startedMs >= NORMAL_COLLECTION_LIMITS.maxWallMs) { this.finish('최대 2분 수집 시간이 끝났습니다.'); return }
    if (this.phase === 'preparing' && now - this.startedMs >= NORMAL_COLLECTION_LIMITS.preparationMs) this.phase = 'collecting'
    if (this.lastValid !== null && now - this.lastValid > NORMAL_POSTURE_SPEC.maximumGapMs) this.invalidate(now, 'gap')
  }
  private invalidate(timeMs: number, reason: CollectionGap['reason']) {
    this.lastValid = null
    if (this.quality !== 'unmeasurable') {
      this.segment++
      if (this.gaps.length < NORMAL_COLLECTION_LIMITS.maxGaps) this.gaps.push({ timeMs: Math.max(0, timeMs - this.startedMs), reason })
    }
    this.quality = 'unmeasurable'
  }
  observe(frame: Observation) {
    if (!this.active) return
    if (!Number.isFinite(frame.timeMs) || (this.lastObserved !== null && frame.timeMs <= this.lastObserved)) {
      this.invalidate(this.lastObserved ?? this.startedMs, 'gap'); this.finish('카메라 관측 시각이 역전되어 수집을 중단했습니다.'); return
    }
    this.lastObserved = frame.timeMs
    this.tick(frame.timeMs)
    if (this.phase !== 'collecting') return
    if ((frame.poseModelId !== undefined && !validPoseModelId(frame.poseModelId)) ||
      (this.frames.length > 0 && this.poseModelId !== frame.poseModelId)) {
      this.invalidate(frame.timeMs, 'interrupted'); this.finish('좌표 추출 모델이 바뀌거나 정보가 유효하지 않아 수집을 중단했습니다. 같은 모델로 다시 수집해 주세요.'); return
    }
    if (this.lastVideoTime !== null && frame.videoTimeMs <= this.lastVideoTime) {
      this.rejected++; this.invalidate(frame.timeMs, 'quality'); return
    }
    this.lastVideoTime = Number.isFinite(frame.videoTimeMs) ? frame.videoTimeMs : null
    const values = liveForecastPoints(frame.landmarks, frame.worldLandmarks)
    if (!values || !extractNormalFeatures(values) || !Number.isFinite(frame.videoTimeMs) || !Number.isFinite(frame.width) || !Number.isFinite(frame.height) ||
      frame.width <= 0 || frame.height <= 0 || frame.landmarks.slice(0, 13).some(p => !Number.isFinite(p.z))) {
      this.rejected++; this.invalidate(frame.timeMs, 'quality'); return
    }
    if (this.lastValid !== null && frame.timeMs - this.lastValid > NORMAL_POSTURE_SPEC.maximumGapMs) this.invalidate(frame.timeMs, 'gap')
    this.lastValid = frame.timeMs; this.quality = 'valid'
    const previous = this.frames.at(-1), timeMs = frame.timeMs - this.startedMs
    if (previous && timeMs - previous.timeMs < NORMAL_COLLECTION_LIMITS.minSampleIntervalMs) return
    if (previous && previous.segment === this.segment && timeMs - previous.timeMs <= NORMAL_POSTURE_SPEC.maximumGapMs) this.validMs += timeMs - previous.timeMs
    this.poseModelId = frame.poseModelId
    this.frames.push({ timeMs, videoTimeMs: frame.videoTimeMs, segment: this.segment, width: frame.width, height: frame.height,
      ...(frame.poseModelId ? { poseModelId: frame.poseModelId } : {}),
      image: frame.landmarks.slice(0, 13).map(copyLandmark), world: frame.worldLandmarks.slice(0, 13).map(copyLandmark), values })
    if (this.validMs >= NORMAL_COLLECTION_LIMITS.targetValidMs && this.frames.length >= NORMAL_POSTURE_SPEC.minimumFrames) this.finish('유효 관측 30초를 모았습니다. 구간을 확인해 주세요.')
    else if (this.frames.length >= NORMAL_COLLECTION_LIMITS.maxSamples) this.finish('메모리 수집 한도에 도달했습니다.')
  }
  finish(reason = '수집을 마쳤습니다. 구간을 확인해 주세요.') {
    if (!this.active) return
    this.phase = 'review'; this.reason = reason; this.lastValid = null
  }
  interrupt(reason: string, now: number) { if (this.active) { this.invalidate(now, 'interrupted'); this.finish(reason) } }
  confirm(this: NormalCollectionCapture<NormalCollectionPurpose>): NormalPostureProfile
  confirm(): NormalPostureProfile | null
  confirm(): NormalPostureProfile | null {
    if (!this.snapshot(this.startedMs).canConfirm) throw new Error('구간을 확인하려면 유효 관측 30초를 먼저 모아 주세요.')
    if (this.metadata.purpose === 'forecast_evaluation') {
      this.phase = 'confirmed'
      return null
    }
    this.profile = fitNormalPostureProfile(this.frames.map(f => ({ timeMs: f.timeMs, values: f.values, segment: f.segment })),
      { ...this.metadata, purpose: this.metadata.purpose, id: this.id, createdAt: this.createdAt, ...(this.poseModelId ? { poseModelId: this.poseModelId } : {}) })
    this.phase = 'confirmed'
    return structuredClone(this.profile)
  }
  exportDataset(this: NormalCollectionCapture<NormalCollectionPurpose>): NormalCollectionDataset
  exportDataset(): DeveloperCollectionDataset
  exportDataset(): DeveloperCollectionDataset {
    if (this.phase !== 'confirmed') throw new Error('수집 구간을 확인한 뒤 내보낼 수 있습니다.')
    const common: CollectionDatasetBase = { id: this.id, source: 'webcam', collectionMethod: 'manual_30s',
      createdAt: this.createdAt, featureVersion: NORMAL_POSTURE_SPEC.featureVersion, validMs: this.validMs,
      timing: { unit: 'ms', origin: 'explicit_collection_start', preparationMs: NORMAL_COLLECTION_LIMITS.preparationMs, maxGapMs: NORMAL_POSTURE_SPEC.maximumGapMs, interpolation: false },
      frames: structuredClone(this.frames), gaps: structuredClone(this.gaps) }
    if (this.metadata.purpose === 'forecast_evaluation') return { ...common, schema_version: 'forecast-evaluation-collection-v1',
      dataRole: 'evaluation_only', trainingAllowed: false, review: 'user_confirmed_evaluation',
      metadata: { ...this.metadata, purpose: 'forecast_evaluation', ...(this.poseModelId ? { poseModelId: this.poseModelId } : {}) } }
    if (!this.profile) throw new Error('목표 자세 구간을 확인한 뒤 내보낼 수 있습니다.')
    return { ...common, schema_version: 'normal-posture-collection-v1', label: 'normal_assumed',
      labelDisplay: '정상자세(수동)', review: 'user_confirmed_normal',
      metadata: { ...this.metadata, purpose: this.metadata.purpose, ...(this.poseModelId ? { poseModelId: this.poseModelId } : {}) }, profile: structuredClone(this.profile) }
  }
}
