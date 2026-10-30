import { FORECAST_OBSERVATION_MAX_GAP_MS, liveForecastPoints, pointDistance, type ForecastReading } from '../../../../model/prototype/forecast'
import { validNormalCode, validPoseModelId } from '../../../../model/prototype/normalPosture'
import type { Landmark } from '../../../../model/prototype/pose'
import type { Observation } from '../camera/types'
import { IMAGE_POSTURE_SPEC, type ImagePosturePolicy } from '../../../../model/prototype/imagePosture'

export const AUTO_NORMAL_THRESHOLDS = [.005, .03, .06] as const
export type AutoNormalThreshold = typeof AUTO_NORMAL_THRESHOLDS[number]
export const AUTO_NORMAL_LIMITS = { maximumDeviation: .06, minimumIntervalMs: 100, maximumGapMs: FORECAST_OBSERVATION_MAX_GAP_MS,
  maximumRows: 6000, recentRows: 20 } as const
export const AUTO_NORMAL_WINDOW = { inputSteps: 30, gridMs: 100, horizonMs: 300, spanMs: 3200, strideMs: 100 } as const
export const AUTO_NORMAL_CLEAN_SELECTION = { policy: 'auto-normal-clean-v1', maximumPostureScore: .5, minimumStableMs: 1000,
  requiredRuleState: 'near_reference', imagePosturePolicy: IMAGE_POSTURE_SPEC.policy } as const
export type AutoNormalExclusion = 'outside' | 'stability' | 'quality' | 'registration' | 'timing' | 'provenance' | 'rate' | 'synthetic' | 'paused' | 'full'
export interface AutoNormalDiagnostics {
  received: number; excluded: Record<AutoNormalExclusion, number>; interruptions: number
  longestSegmentMs: number; candidateWindows: number
}
const emptyDiagnostics = (): AutoNormalDiagnostics => ({ received: 0,
  excluded: { outside: 0, stability: 0, quality: 0, registration: 0, timing: 0, provenance: 0, rate: 0, synthetic: 0, paused: 0, full: 0 },
  interruptions: 0, longestSegmentMs: 0, candidateWindows: 0 })
export interface AutoNormalObservation {
  frame: Observation
  reading: ForecastReading
  runId: string
  baseline: number[]
  source: 'camera' | 'synthetic'
  /** Engine run clock; frame.timeMs remains the original camera clock. */
  observationTimeMs: number
}
export type AutoNormalStatus = 'waiting' | 'stabilizing' | 'collecting' | 'outside' | 'quality' | 'paused' | 'full'
export interface AutoNormalRow {
  poseModelId?: string
  row: number; timeMs: number; observationTimeMs: number; videoTimeMs: number; segment: number
  runId: string; referenceId: string; participantCode: string; deviation: number; maximumDeviation: AutoNormalThreshold
  label: 'normal_auto_assumed'; displayLabel: '정상자세(자동)'; labelSource: 'auto_rule'; review: 'not_reviewed'
  width: number; height: number; image: Landmark[]; world: Landmark[]; values: number[]
  imagePosturePolicy?: ImagePosturePolicy; imagePostureScore?: number
  selectionPolicy?: typeof AUTO_NORMAL_CLEAN_SELECTION.policy; postureScore?: number; stableForMs?: number
  postureEntryRatio?: number; postureRecoveryRatio?: number
}
export interface AutoNormalReference { id: string; runId: string; participantCode: string; observationTimeMs: number; values: number[]; poseModelId?: string }
export type AutoNormalRecentRow = Pick<AutoNormalRow, 'row' | 'observationTimeMs' | 'deviation' | 'maximumDeviation' | 'displayLabel' | 'segment' | 'runId' | 'selectionPolicy'>
export interface AutoNormalSnapshot {
  enabled: boolean; participantCode: string; status: AutoNormalStatus; reason: string; total: number; full: boolean
  recentRows: AutoNormalRecentRow[]; maximumRows: number
  maximumDeviation: AutoNormalThreshold; diagnostics: AutoNormalDiagnostics
  requiresReviewRows: number
}
export interface AutoNormalDataset {
  schema_version: 'normal-posture-auto-collection-v2'; id: string; createdAt: string; source: 'webcam'
  label: 'normal_auto_assumed'; displayLabel: '정상자세(자동)'; labelSource: 'auto_rule'; review: 'not_reviewed'
  purpose: 'early_experiment_only'; domainValidated: false
  trainingAllowed?: false
  reviewGate?: { status: 'requires_review'; reason: 'legacy_selection'; affectedRows: number }
  selection: { metric: 'balanced_face_ears_shoulders_distance'; thresholdSource: 'row.maximumDeviation'; configuredMaximumDeviation: AutoNormalThreshold;
    allowedMaximumDeviations: AutoNormalThreshold[]; inclusive: true; maximumHz: number; interpolation: false; cleanGate: typeof AUTO_NORMAL_CLEAN_SELECTION }
  timing: { unit: 'ms'; timeMs: 'camera_observation_clock'; observationTimeMs: 'measurement_run_clock'; videoTimeMs: 'video_clock'; maximumGapMs: number }
  references: AutoNormalReference[]; rows: AutoNormalRow[]
  diagnostics: AutoNormalDiagnostics & { window: typeof AUTO_NORMAL_WINDOW; windowMeaning: 'candidate_resampled_windows_not_training_completion' }
}
const label = { label: 'normal_auto_assumed', displayLabel: '정상자세(자동)', labelSource: 'auto_rule', review: 'not_reviewed' } as const
const validValues = (values: number[]) => Array.isArray(values) && values.length === 39 && values.every(Number.isFinite)
const copyLandmark = ({ x, y, z, visibility }: Landmark): Landmark => ({ x, y, z, ...(Number.isFinite(visibility) ? { visibility } : {}) })
const usableStates = new Set(['near_reference', 'deviation_pending', 'unexpected_motion_candidate', 'persistent_deviation_candidate', 'recovery_pending'])

/** Experimental pseudo-label collection; never fits or applies a normal model. */
export class AutoNormalCapture {
  private enabled = true
  private status: AutoNormalStatus = 'waiting'
  private reason = '자세 측정에서 기준을 등록하면 자동으로 모읍니다.'
  private rows: AutoNormalRow[] = []
  private references: AutoNormalReference[] = []
  private activeReference: AutoNormalReference | null = null
  private activeRun: string | null = null
  private lastObserved: number | null = null
  private lastVideo: number | null = null
  private lastRunTime: number | null = null
  private lastStored: number | null = null
  private segment = 0
  private continuous = false
  private maximumDeviation: AutoNormalThreshold = AUTO_NORMAL_LIMITS.maximumDeviation
  private diagnostics = emptyDiagnostics()
  private segmentStart: number | null = null
  private segmentWindows = 0
  private qualifiedAt: number | null = null
  private qualificationKey: string | null = null
  constructor(private participantCode: string, readonly id: string, readonly createdAt: string) {
    if (!validNormalCode(participantCode)) throw new Error('익명 코드는 영문·숫자·밑줄·하이픈 2~48자로 입력해 주세요.')
  }
  snapshot(): AutoNormalSnapshot {
    return { enabled: this.enabled, participantCode: this.participantCode, status: this.status, reason: this.reason,
      total: this.rows.length, full: this.rows.length >= AUTO_NORMAL_LIMITS.maximumRows, maximumRows: AUTO_NORMAL_LIMITS.maximumRows,
      maximumDeviation: this.maximumDeviation, diagnostics: structuredClone(this.diagnostics),
      requiresReviewRows: this.rows.filter(row => row.selectionPolicy !== AUTO_NORMAL_CLEAN_SELECTION.policy).length,
      recentRows: this.rows.slice(-AUTO_NORMAL_LIMITS.recentRows).reverse().map(({ row, observationTimeMs, deviation, maximumDeviation, displayLabel, segment, runId, selectionPolicy }) =>
        ({ row, observationTimeMs, deviation, maximumDeviation, displayLabel, segment, runId, selectionPolicy })) }
  }
  private update(status: AutoNormalStatus, reason: string) {
    const changed = this.status !== status || this.reason !== reason
    this.status = status; this.reason = reason; return changed
  }
  private breakSegment() { if (this.continuous) this.segment++; this.continuous = false; this.segmentStart = null; this.segmentWindows = 0; this.qualifiedAt = null; this.qualificationKey = null }
  private reject(kind: AutoNormalExclusion, reason: string) {
    this.diagnostics.excluded[kind]++
    return this.markGap(reason)
  }
  markGap(reason = '관측이 끊겼습니다. 새 유효 관측을 기다립니다.') {
    if (this.continuous) this.diagnostics.interruptions++
    this.breakSegment()
    if (!this.enabled || this.rows.length >= AUTO_NORMAL_LIMITS.maximumRows) return false
    return this.update('quality', reason)
  }
  endRun() {
    this.breakSegment(); this.activeRun = null; this.activeReference = null
    this.lastObserved = null; this.lastVideo = null; this.lastRunTime = null; this.lastStored = null
    if (!this.enabled || this.rows.length >= AUTO_NORMAL_LIMITS.maximumRows) return false
    return this.update('waiting', '다음 자세 측정에서 자동 수집을 이어갑니다.')
  }
  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return
    this.enabled = enabled; this.breakSegment()
    if (this.rows.length >= AUTO_NORMAL_LIMITS.maximumRows) this.update('full', '6,000행 한도에 도달했습니다. 다운로드한 뒤 비워 주세요.')
    else this.update(enabled ? 'waiting' : 'paused', enabled ? '새 유효 관측을 기다립니다.' : '자동 수집을 일시정지했습니다.')
  }
  setMaximumDeviation(value: number) {
    if (!AUTO_NORMAL_THRESHOLDS.includes(value as AutoNormalThreshold)) throw new Error('선별 기준은 0.5%, 3%, 6% 중 선택해 주세요.')
    if (this.maximumDeviation === value) return
    this.maximumDeviation = value as AutoNormalThreshold
    this.breakSegment()
    if (!this.enabled || this.rows.length >= AUTO_NORMAL_LIMITS.maximumRows) return
    this.update('waiting', `선별 기준을 ${(value * 100).toFixed(value === .005 ? 1 : 0)}%로 바꿨습니다. 다음 행부터 새 구간으로 모읍니다.`)
  }
  setParticipantCode(code: string) {
    if (this.enabled) throw new Error('자동 수집을 잠시 멈춘 뒤 익명 코드를 바꿔 주세요.')
    if (!validNormalCode(code)) throw new Error('익명 코드는 영문·숫자·밑줄·하이픈 2~48자로 입력해 주세요.')
    this.participantCode = code; this.activeReference = null; this.breakSegment()
  }
  discard() {
    this.rows = []; this.references = []; this.activeReference = null; this.activeRun = null
    this.lastObserved = null; this.lastVideo = null; this.lastRunTime = null; this.lastStored = null; this.segment = 0; this.continuous = false
    this.segmentStart = null; this.segmentWindows = 0; this.diagnostics = emptyDiagnostics()
    this.qualifiedAt = null; this.qualificationKey = null
    this.update(this.enabled ? 'waiting' : 'paused', this.enabled ? '새 유효 관측을 기다립니다.' : '자동 수집을 일시정지했습니다.')
  }
  observe(input: AutoNormalObservation): boolean {
    this.diagnostics.received++
    if (!this.enabled) { this.diagnostics.excluded.paused++; return false }
    if (this.rows.length >= AUTO_NORMAL_LIMITS.maximumRows) { this.diagnostics.excluded.full++; return false }
    const { frame, reading, runId, baseline, source, observationTimeMs } = input
    if (source !== 'camera') { this.diagnostics.excluded.synthetic++; this.breakSegment(); return this.update('waiting', '합성 데모는 수집하지 않습니다.') }
    if (frame.poseModelId !== undefined && !validPoseModelId(frame.poseModelId)) return this.reject('provenance', '좌표 추출 모델 정보를 확인할 수 없어 제외했습니다.')
    if (!runId || !Number.isFinite(observationTimeMs) || observationTimeMs < 0 || reading.timeMs !== observationTimeMs) return this.reject('timing', '관측과 판정 시각이 맞지 않아 제외했습니다.')
    if (runId !== this.activeRun) {
      this.breakSegment(); this.activeRun = runId; this.activeReference = null
      this.lastObserved = null; this.lastVideo = null; this.lastRunTime = null; this.lastStored = null
    }
    if (!Number.isFinite(frame.timeMs) || frame.timeMs < 0 || !Number.isFinite(frame.videoTimeMs) || frame.videoTimeMs < 0 ||
      (this.lastObserved !== null && frame.timeMs <= this.lastObserved) || (this.lastVideo !== null && frame.videoTimeMs <= this.lastVideo) ||
      (this.lastRunTime !== null && observationTimeMs <= this.lastRunTime)) return this.reject('timing', '중복되거나 역전된 프레임을 제외했습니다.')
    if (this.lastObserved !== null && (frame.timeMs - this.lastObserved > AUTO_NORMAL_LIMITS.maximumGapMs ||
      observationTimeMs - this.lastRunTime! > AUTO_NORMAL_LIMITS.maximumGapMs)) { this.diagnostics.interruptions++; this.breakSegment() }
    this.lastObserved = frame.timeMs; this.lastVideo = frame.videoTimeMs; this.lastRunTime = observationTimeMs
    if (!usableStates.has(reading.ruleState) && reading.state !== 'unmeasurable') return this.reject('registration', '기준 등록을 기다립니다.')
    if (reading.state === 'unmeasurable') return this.reject('quality', '측정 품질이나 관측 간격을 확인하고 있습니다.')
    if (reading.imagePosture) {
      if (reading.imagePosture.status !== 'ready' || reading.imagePosture.score == null || !Number.isFinite(reading.imagePosture.score) || reading.imagePosture.score < 0)
        return this.reject('quality', '몸 전체 위치 비교가 유효한 프레임만 모읍니다.')
      if (reading.imagePosture.score > 1) {
        this.diagnostics.excluded.outside++; this.breakSegment()
        return this.update('outside', '등록 때보다 몸 전체 위치·크기가 크게 달라져 제외합니다.')
      }
    }
    if (!validValues(baseline) || reading.deviation === null || !Number.isFinite(reading.deviation) || reading.deviation < 0) return this.reject('provenance', '기준과 현재 관측의 수치를 확인할 수 없어 제외했습니다.')
    const values = liveForecastPoints(frame.landmarks, frame.worldLandmarks)
    if (!values || !Number.isFinite(frame.width) || !Number.isFinite(frame.height) || frame.width <= 0 || frame.height <= 0 ||
      frame.landmarks.slice(0, 13).some(p => !Number.isFinite(p.z))) return this.reject('quality', '얼굴과 양쪽 어깨가 보이는 프레임만 모읍니다.')
    // Protect provenance: never attach a stale reading or a different registration to this frame.
    if (Math.abs(pointDistance(values, baseline) - reading.deviation) > 1e-8) return this.reject('provenance', '현재 프레임과 기준의 오차가 맞지 않아 제외했습니다.')
    const thresholdLabel = `${this.maximumDeviation * 100}%`
    if (reading.deviation > this.maximumDeviation) {
      this.diagnostics.excluded.outside++; this.breakSegment(); return this.update('outside', `기준 오차가 ${thresholdLabel}보다 커서 이 프레임은 제외합니다.`)
    }
    const referenceChanged = !this.activeReference || this.activeReference.values.some((v, i) => v !== baseline[i]) ||
      this.activeReference.participantCode !== this.participantCode || this.activeReference.poseModelId !== frame.poseModelId
    if (referenceChanged && this.activeReference) { this.breakSegment(); this.activeReference = null }
    const clean = reading.imagePosture?.policy === AUTO_NORMAL_CLEAN_SELECTION.imagePosturePolicy
    if (clean) {
      if (reading.postureScore == null || !Number.isFinite(reading.postureScore) || reading.postureScore < 0 ||
        reading.postureScore + 1e-9 < reading.imagePosture!.score!)
        return this.reject('quality', '종합 이탈 점수를 확인할 수 없어 제외합니다.')
      if (reading.ruleState !== AUTO_NORMAL_CLEAN_SELECTION.requiredRuleState || reading.postureScore > AUTO_NORMAL_CLEAN_SELECTION.maximumPostureScore) {
        this.diagnostics.excluded.outside++; this.breakSegment()
        return this.update('outside', '종합 0.5배 이내·실측 룰 범위 안의 구간만 정상 후보로 모읍니다.')
      }
      const key = JSON.stringify([runId, this.participantCode, frame.poseModelId, baseline])
      if (this.qualificationKey !== key) { this.breakSegment(); this.qualificationKey = key }
      this.qualifiedAt ??= observationTimeMs
      if (observationTimeMs - this.qualifiedAt < AUTO_NORMAL_CLEAN_SELECTION.minimumStableMs) {
        this.diagnostics.excluded.stability++
        return this.update('stabilizing', `정상 후보 유지 ${((observationTimeMs - this.qualifiedAt) / 1000).toFixed(1)} / 1.0초 · 확인 뒤 수집합니다.`)
      }
    }
    if (this.lastStored !== null && frame.timeMs - this.lastStored < AUTO_NORMAL_LIMITS.minimumIntervalMs) {
      this.diagnostics.excluded.rate++; return this.update('collecting', `오차 ${thresholdLabel} 이하의 실제 프레임을 자동 추가 중입니다.`)
    }
    if (this.continuous && this.lastStored !== null && frame.timeMs - this.lastStored > AUTO_NORMAL_LIMITS.maximumGapMs) { this.diagnostics.interruptions++; this.breakSegment() }
    if (!this.activeReference) {
      this.activeReference = { id: `${runId}-reference-${this.references.length + 1}`, runId, participantCode: this.participantCode,
        observationTimeMs, values: [...baseline], ...(frame.poseModelId ? { poseModelId: frame.poseModelId } : {}) }
      this.references.push(this.activeReference)
    }
    this.rows.push({ row: this.rows.length + 1, timeMs: frame.timeMs, observationTimeMs, videoTimeMs: frame.videoTimeMs,
      segment: this.segment, runId, referenceId: this.activeReference.id, participantCode: this.participantCode,
      ...(frame.poseModelId ? { poseModelId: frame.poseModelId } : {}),
      deviation: reading.deviation, maximumDeviation: this.maximumDeviation, ...label, width: frame.width, height: frame.height,
      ...(reading.imagePosture ? { imagePosturePolicy: reading.imagePosture.policy, imagePostureScore: reading.imagePosture.score! } : {}),
      ...(clean ? { selectionPolicy: AUTO_NORMAL_CLEAN_SELECTION.policy, postureScore: reading.postureScore!, stableForMs: observationTimeMs - this.qualifiedAt! } : {}),
      ...(reading.postureEntryRatio !== undefined ? { postureEntryRatio: reading.postureEntryRatio, postureRecoveryRatio: reading.postureRecoveryRatio } : {}),
      image: frame.landmarks.slice(0, 13).map(copyLandmark), world: frame.worldLandmarks.slice(0, 13).map(copyLandmark), values })
    this.lastStored = frame.timeMs; this.continuous = true
    this.segmentStart ??= frame.timeMs
    const span = frame.timeMs - this.segmentStart
    const windows = Math.max(0, Math.floor((span - AUTO_NORMAL_WINDOW.spanMs + 1e-6) / AUTO_NORMAL_WINDOW.strideMs) + 1)
    this.diagnostics.candidateWindows += windows - this.segmentWindows
    this.segmentWindows = windows
    this.diagnostics.longestSegmentMs = Math.max(this.diagnostics.longestSegmentMs, span)
    this.update(this.rows.length >= AUTO_NORMAL_LIMITS.maximumRows ? 'full' : 'collecting', this.rows.length >= AUTO_NORMAL_LIMITS.maximumRows
      ? '6,000행 한도에 도달했습니다. 다운로드한 뒤 비워 주세요.' : `오차 ${thresholdLabel} 이하의 실제 프레임을 자동 추가 중입니다.`)
    return true
  }
  exportDataset(): AutoNormalDataset {
    if (!this.rows.length) throw new Error('자동으로 모인 행이 아직 없습니다.')
    const requiresReview = this.rows.filter(row => row.selectionPolicy !== AUTO_NORMAL_CLEAN_SELECTION.policy).length
    return { schema_version: 'normal-posture-auto-collection-v2', id: this.id, createdAt: this.createdAt, source: 'webcam', ...label,
      purpose: 'early_experiment_only', domainValidated: false,
      ...(requiresReview ? { trainingAllowed: false as const, reviewGate: { status: 'requires_review' as const, reason: 'legacy_selection' as const, affectedRows: requiresReview } } : {}),
      selection: { metric: 'balanced_face_ears_shoulders_distance', thresholdSource: 'row.maximumDeviation', configuredMaximumDeviation: this.maximumDeviation,
        allowedMaximumDeviations: [...AUTO_NORMAL_THRESHOLDS],
        inclusive: true, maximumHz: 1000 / AUTO_NORMAL_LIMITS.minimumIntervalMs, interpolation: false, cleanGate: { ...AUTO_NORMAL_CLEAN_SELECTION } },
      timing: { unit: 'ms', timeMs: 'camera_observation_clock', observationTimeMs: 'measurement_run_clock', videoTimeMs: 'video_clock', maximumGapMs: AUTO_NORMAL_LIMITS.maximumGapMs },
      references: structuredClone(this.references), rows: structuredClone(this.rows),
      diagnostics: { ...structuredClone(this.diagnostics), window: { ...AUTO_NORMAL_WINDOW }, windowMeaning: 'candidate_resampled_windows_not_training_completion' } }
  }
}
