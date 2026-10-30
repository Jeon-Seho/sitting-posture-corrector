/** Research-only LSTM + reference experiment. No service/CEP output. */
import type { Landmark } from './pose'
import { readNormalPostureProfile, scoreNormalPosture, type NormalPostureProfile } from './normalPosture'
import { validateNormalReference, type NormalReferenceValidation } from './referenceValidation'
import { ImagePostureAnchor, type ImagePostureInput, type ImagePostureReading } from './imagePosture'

interface ForecastWeightsBase {
  model_id: string
  source_sha256: string
  domain_validated: false
  config: { steps: number; dimensions: number; hidden: number; horizon: number; point_definition: string }
  mean: number[]
  scale: number[]
  weights: Record<string, number[]>
}
export interface ForecastWeightsV1 extends ForecastWeightsBase { schema_version: 'forecast-weights-v1' }
export interface ForecastWeightsV2 extends ForecastWeightsBase {
  schema_version: 'forecast-weights-v2'
  data_domain: 'mediapipe'
  pose_model_id: string
  feature_definition: 'mediapipe-world13-shoulder-normalized-xyz-v1'
  training: {
    mode: 'participant_holdout' | 'pilot'
    evaluation_scope: 'participant_holdout_forecast_only' | 'training_fit_only'
    participant_generalization_evaluated: boolean
    labels_used: { manual_confirmed_windows: number; automatic_weak_windows: number }
    split_window_counts: { train: number; validation: number; test: number }
    split_participant_counts: { train: number; validation: number; test: number }
  }
}
export type ForecastWeights = ForecastWeightsV1 | ForecastWeightsV2
const FORECAST_POSE_MODELS = new Set(['mediapipe-pose-lite-f16-v1/tasks-vision-1.0.1',
  'mediapipe-pose-full-f16-v1/tasks-vision-1.0.1', 'mediapipe-pose-heavy-f16-v1/tasks-vision-1.0.1'])
const integerCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
function validForecastV2Metadata(value: ForecastWeightsV2) {
  if (value.data_domain !== 'mediapipe' || !FORECAST_POSE_MODELS.has(value.pose_model_id) ||
    value.feature_definition !== 'mediapipe-world13-shoulder-normalized-xyz-v1' ||
    !value.model_id.length || value.model_id.length > 160) return false
  const t = value.training
  if (!t || !t.labels_used || !t.split_window_counts || !t.split_participant_counts) return false
  const windows = t.split_window_counts, participants = t.split_participant_counts, labels = t.labels_used
  const splits = ['train', 'validation', 'test'] as const
  if (splits.some(split => !integerCount(windows[split]) || !integerCount(participants[split]) || participants[split] > windows[split]) ||
    !integerCount(labels.manual_confirmed_windows) || !integerCount(labels.automatic_weak_windows) ||
    labels.manual_confirmed_windows + labels.automatic_weak_windows !== windows.train ||
    windows.train < 1 || participants.train < 1) return false
  if (t.mode === 'pilot') return t.evaluation_scope === 'training_fit_only' && t.participant_generalization_evaluated === false &&
    windows.validation === 0 && windows.test === 0 && participants.validation === 0 && participants.test === 0
  return t.mode === 'participant_holdout' && t.evaluation_scope === 'participant_holdout_forecast_only' &&
    t.participant_generalization_evaluated === true && windows.validation > 0 && windows.test > 0 && participants.validation > 0 && participants.test > 0
}
/** V1 remains an explicitly approximate legacy experiment; V2 requires the actual known extractor. */
export function forecastModelMatchesPoseModel(model: ForecastWeights, poseModelId: string | undefined): boolean {
  return model.schema_version === 'forecast-weights-v1' ||
    (model.schema_version === 'forecast-weights-v2' && typeof poseModelId === 'string' &&
      FORECAST_POSE_MODELS.has(poseModelId) && model.pose_model_id === poseModelId)
}
const SHAPES: Record<string, number> = {
  'lstm.weight_ih_l0': 192 * 39, 'lstm.weight_hh_l0': 192 * 48,
  'lstm.bias_ih_l0': 192, 'lstm.bias_hh_l0': 192,
  'output.weight': 39 * 48, 'output.bias': 39,
}
export function readForecastWeights(value: unknown): ForecastWeights {
  const v = value as ForecastWeights
  if (!v || !['forecast-weights-v1', 'forecast-weights-v2'].includes(v.schema_version) || v.domain_validated !== false ||
    typeof v.model_id !== 'string' || !/^[a-f0-9]{64}$/.test(v.source_sha256) ||
    v.config?.steps !== 30 || v.config.dimensions !== 39 || v.config.hidden !== 48 || v.config.horizon !== 3 ||
    v.config.point_definition !== (v.schema_version === 'forecast-weights-v2' ? 'MediaPipe-13-world-shoulder-normalized-v1' : 'Panoptic-face9-body4-not-MediaPipe')) throw new Error('지원하지 않는 예측 모델입니다.')
  if (v.schema_version === 'forecast-weights-v2' && !validForecastV2Metadata(v)) throw new Error('MediaPipe 모델의 학습 출처·분할·특징 정보를 확인해 주세요.')
  const valid = (a: unknown, n: number): a is number[] => Array.isArray(a) && a.length === n && Array.from(a).every(Number.isFinite)
  if (!valid(v.mean, 39) || !valid(v.scale, 39) || v.scale.some(x => x <= 0) ||
    !v.weights || Object.entries(SHAPES).some(([k, n]) => !valid(v.weights[k], n))) throw new Error('예측 모델 수치가 손상됐습니다.')
  return v
}
export function predictLstm(model: ForecastWeights, input: number[][]): number[] {
  if (input.length !== 30 || input.some(row => row.length !== 39 || row.some(v => !Number.isFinite(v)))) throw new Error('잘못된 시계열 입력')
  const w = model.weights, h = new Float64Array(48), c = new Float64Array(48)
  let last = new Float64Array(39), previous = last
  const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))
  for (const row of input) {
    const x = Float64Array.from(row, (v, i) => (v - model.mean[i]) / model.scale[i])
    const gates = new Float64Array(192)
    for (let j = 0; j < 192; j++) {
      let sum = w['lstm.bias_ih_l0'][j] + w['lstm.bias_hh_l0'][j]
      for (let i = 0; i < 39; i++) sum += w['lstm.weight_ih_l0'][j * 39 + i] * x[i]
      for (let i = 0; i < 48; i++) sum += w['lstm.weight_hh_l0'][j * 48 + i] * h[i]
      gates[j] = sum
    }
    for (let i = 0; i < 48; i++) {
      c[i] = sigmoid(gates[48 + i]) * c[i] + sigmoid(gates[i]) * Math.tanh(gates[96 + i])
      h[i] = sigmoid(gates[144 + i]) * Math.tanh(c[i])
    }
    previous = last; last = x
  }
  return Array.from({ length: 39 }, (_, j) => {
    let correction = w['output.bias'][j]
    for (let i = 0; i < 48; i++) correction += w['output.weight'][j * 48 + i] * h[i]
    return (last[j] + 3 * (last[j] - previous[j]) + correction) * model.scale[j] + model.mean[j]
  })
}

// Approximate semantic correspondence only. Eye/mouth definitions and world axes differ.
export const LIVE_FORECAST_ORDER = [0, 6, 5, 4, 1, 2, 3, 10, 9, 7, 8, 11, 12]
export function liveForecastPoints(image: Landmark[], world: Landmark[]): number[] | null {
  if (image.length < 13 || world.length < 13 || LIVE_FORECAST_ORDER.some(i => {
    const p = image[i], q = world[i]
    return !p || !q || ![p.x, p.y, q.x, q.y, q.z].every(Number.isFinite) ||
      p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 ||
      !Number.isFinite(p.visibility) || (p.visibility ?? 0) < .5
  })) return null
  const l = world[11], r = world[12], span = Math.hypot(l.x - r.x, l.y - r.y, l.z - r.z)
  if (span < .05) return null
  const center = [(l.x + r.x) / 2, (l.y + r.y) / 2, (l.z + r.z) / 2]
  return LIVE_FORECAST_ORDER.flatMap(i => [world[i].x, world[i].y, world[i].z].map((v, a) => (v - center[a]) / span))
}
export function pointDistance(a: number[], b: number[]): number {
  const values = Array.from({ length: 13 }, (_, i) => Math.hypot(...a.slice(i * 3, i * 3 + 3).map((v, j) => v - b[i * 3 + j])))
  const average = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length
  return (average(values.slice(0, 9)) + average(values.slice(9, 11)) + average(values.slice(11))) / 3
}
export type ForecastState = 'needs_reference' | 'registering' | 'warming' | 'near_reference' |
  'deviation_pending' | 'unexpected_motion_candidate' | 'persistent_deviation_candidate' | 'recovery_pending' | 'unmeasurable'
export const FORECAST_MAX_SAMPLE_GAP_MS = 170
/** /dev observes every raw frame; predictor sampling has a separate 100 ms clock. */
export const FORECAST_OBSERVATION_MAX_GAP_MS = 250
/** /dev predictor-only tolerance between two valid endpoints, never a rule/collection allowance. */
export const FORECAST_PREDICTION_MAX_GAP_MS = 500
/** Brief frame delays during reference capture are tolerated; tracking still uses 170ms. */
export const FORECAST_REGISTRATION_MAX_SAMPLE_GAP_MS = 1000
export interface ForecastReading {
  schema_version: 'forecast-experiment-v1'
  timeMs: number
  state: ForecastState
  ruleState: ForecastState
  deviation: number | null
  error: number | null
  errorLimit: number | null
  durationMs: number
  progress: number
  returnedExcursions: number
  modelId: string
  domainValidated: false
  /** Explicit opt-in: raw observation rules are independent of predictor readiness. */
  evaluationMode?: 'observed-v2'
  /** Exact resampled observation timestamp used for the optional prediction residual. */
  predictionTimeMs?: number | null
  /** Predictor input cadence allowance only; raw rules remain limited to 250 ms. */
  predictionInputMaxGapMs?: number
  normalScore?: number | null
  normalProfileId?: string
  /** Observed /dev diagnostics: rule counters are independent of predictor policy. */
  ruleDurationMs?: number
  ruleReturnedExcursions?: number
  ruleRecoveryMs?: number
  predictionRecoveryMs?: number
  /** Composite in registration allowance units; applied entry/recovery ratios are separate. */
  postureScore?: number | null
  postureEntryRatio?: number
  postureRecoveryRatio?: number
  /** Scalar image diagnostics only; no raw image/reference coordinates. */
  imagePosture?: ImagePostureReading
}
export interface ForecastOptions { mode?: 'observed'; normalProfile?: NormalPostureProfile | null; poseModelId?: string; imagePostureGuard?: boolean }
export const DEV_POSTURE_DECISION = { entryRatio: .7, recoveryRatio: .7 * 2 / 3 } as const
const legacyDistanceLimits = { entry: .12, recovery: .08 }
const developerDistanceLimits = { entry: .12 * DEV_POSTURE_DECISION.entryRatio, recovery: .12 * DEV_POSTURE_DECISION.recoveryRatio,
  continuousEntry: true }
/** Transient model output for visualization. Never serialized in diagnostic readings. */
export interface ForecastDisplay {
  predictor: 'lstm' | 'hold_last' | 'constant_velocity'
  modelId: string
  inputAtMs: number
  targetAtMs: number
  inputValues: number[]
  values: number[]
}
export type ForecastPredictionResetReason = 'quality' | 'gap' | 'time' | 'reset'
/** Transient input diagnostics, without coordinates or changes to the reading/export contract. */
export interface ForecastPredictionStatus {
  collectedSteps: number
  requiredSteps: 30
  resetCount: number
  lastResetReason: ForecastPredictionResetReason | null
  lastGapMs: number | null
  bridgedGapCount: number
}
export class ForecastPolicy {
  private farAt: number | null = null
  private predictableAt: number | null = null
  private nearAt: number | null = null
  private persistent = false
  returned = 0
  reset() { this.farAt = null; this.predictableAt = null; this.nearAt = null; this.persistent = false }
  get durationStart() { return this.farAt }
  get recoveryStart() { return this.nearAt }
  step(t: number, deviation: number, error: number | null, limit: number, ruleOnly = false, learnedRange = false,
    thresholds: { entry: number; recovery: number; continuousEntry?: boolean } = legacyDistanceLimits): ForecastState {
    // In /dev, a brief crossing must not keep aging inside the entry/recovery band.
    // Recovery hysteresis starts only after a sustained event has been established.
    const outside = thresholds.continuousEntry
      ? deviation > (this.persistent ? thresholds.recovery : thresholds.entry)
      : (learnedRange ? deviation > thresholds.entry : deviation >= thresholds.entry) || (this.farAt !== null && deviation > thresholds.recovery)
    if (outside) {
      this.nearAt = null
      this.farAt ??= t
      if (error !== null && error <= limit) this.predictableAt ??= t
      else this.predictableAt = null
      const age = t - this.farAt
      if ((age >= 3000 && (ruleOnly || (this.predictableAt !== null && t - this.predictableAt >= 1000))) || age >= 5000) this.persistent = true
      if (this.persistent) return 'persistent_deviation_candidate'
      return !ruleOnly && error !== null && error > limit ? 'unexpected_motion_candidate' : 'deviation_pending'
    }
    if (this.farAt !== null && !this.persistent) this.returned++
    this.farAt = null; this.predictableAt = null
    if (this.persistent) {
      this.nearAt ??= t
      if (t - this.nearAt < 3000) return 'recovery_pending'
      this.persistent = false
    }
    this.nearAt = null
    return 'near_reference'
  }
}
const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) * q)]
}
export class LiveForecastExperiment {
  private history: { time: number; values: number[] }[] = []
  private queued: { due: number; prediction: number[] }[] = []
  private baseline: number[] | null = null
  private registration: number[][] | null = null
  private registrationStart: number | null = null
  private registrationErrors: number[] = []
  private lastRaw: number | null = null
  private lastSample: number | null = null
  private limit = .02
  private policy = new ForecastPolicy()
  private rule = new ForecastPolicy()
  private readonly predict: (window: number[][]) => number[]
  private readonly modelId: string
  private observedPrevious: { time: number; values: number[] } | null = null
  private nextGrid: number | null = null
  private residual: { time: number; error: number } | null = null
  private display: ForecastDisplay | null = null
  private predictionResetCount = 0
  private predictionResetReason: ForecastPredictionResetReason | null = null
  private observationGapMs: number | null = null
  private predictionBridgedGaps = 0
  private readonly normalProfile: NormalPostureProfile | null
  private normalScore: number | null = null
  private referenceCheck: NormalReferenceValidation | null = null
  private readonly imageAnchor: ImagePostureAnchor | null
  private postureScore: number | null = null
  constructor(readonly model: ForecastWeights | null, readonly predictor: 'lstm' | 'hold_last' | 'constant_velocity' = 'lstm',
    readonly options: ForecastOptions = {}) {
    if (options.imagePostureGuard && options.mode !== 'observed') throw new Error('영상 기준 보완은 /dev 관측 모드에서만 사용할 수 있습니다.')
    this.imageAnchor = options.imagePostureGuard ? new ImagePostureAnchor() : null
    this.normalProfile = options.mode === 'observed' && options.normalProfile
      ? readNormalPostureProfile(structuredClone(options.normalProfile)) : null
    if (this.normalProfile && this.normalProfile.provenance.purpose !== 'personal_calibration') {
      throw new Error('학습 자료용 프로필은 측정에 적용할 수 없습니다. 개인 기준 등록용 프로필을 사용해 주세요.')
    }
    if (predictor === 'lstm') {
      if (!model) throw new Error('LSTM 예측에는 학습 모델이 필요합니다. 모델 없이 실행하려면 위치 유지 또는 등속 예측을 선택해 주세요.')
      if (model.schema_version === 'forecast-weights-v2' && options.mode !== 'observed') throw new Error('MediaPipe 재학습 모델은 추출기 정보를 확인하는 /dev에서 실행해 주세요.')
      this.predict = window => predictLstm(model, window)
      this.modelId = model.model_id
    } else {
      this.predict = window => {
        const last = window[window.length - 1]
        return predictor === 'hold_last' ? [...last] : last.map((v, i) => v + 3 * (v - window[window.length - 2][i]))
      }
      this.modelId = predictor
    }
  }
  register() {
    this.imageAnchor?.beginRegistration()
    this.referenceCheck = null
    this.baseline = null; this.registration = []; this.registrationStart = null; this.registrationErrors = []
    this.policy = new ForecastPolicy(); this.rule = new ForecastPolicy()
    this.breakContinuity()
  }
  private resetRules() {
    this.policy.reset(); this.rule.reset()
    this.normalScore = null
    this.postureScore = null; this.imageAnchor?.clearContinuity()
  }
  private breakContinuity(reason: ForecastPredictionResetReason = 'reset') {
    this.resetPrediction(reason); this.resetRules()
    if (this.registration) { this.registration = []; this.registrationStart = null; this.registrationErrors = []; this.imageAnchor?.clearRegistrationSamples() }
  }
  private resetPrediction(reason: ForecastPredictionResetReason = 'reset') {
    this.history = []; this.queued = []; this.lastSample = null
    this.observedPrevious = null; this.nextGrid = null; this.residual = null
    this.display = null
    this.predictionResetCount++; this.predictionResetReason = reason
  }
  /** The guide may pause a brief missing reference frame, but forecasts must not bridge it. */
  pauseReference() {
    if (this.options.mode === 'observed' && this.registration) this.resetPrediction('quality')
  }
  get ready() { return this.baseline !== null }
  get referenceValidation(): NormalReferenceValidation | null { return this.referenceCheck ? structuredClone(this.referenceCheck) : null }
  get residualLimit() { return this.limit }
  get referenceValues(): number[] | null { return this.baseline ? [...this.baseline] : null }
  get predictionStatus(): ForecastPredictionStatus {
    return { collectedSteps: this.history.length, requiredSteps: 30, resetCount: this.predictionResetCount,
      lastResetReason: this.predictionResetReason, lastGapMs: this.observationGapMs,
      bridgedGapCount: this.predictionBridgedGaps }
  }
  get predictionDisplay(): ForecastDisplay | null {
    const display = this.display
    if (!display || this.lastRaw === null || display.targetAtMs <= this.lastRaw ||
      this.lastRaw - display.inputAtMs > FORECAST_OBSERVATION_MAX_GAP_MS) return null
    return { ...display, inputValues: [...display.inputValues], values: [...display.values] }
  }
  private forecast(time: number, input: number[]) {
    const prediction = this.predict(this.history.map(point => point.values))
    this.queued.push({ due: time + 300, prediction })
    this.display = { predictor: this.predictor, modelId: this.modelId, inputAtMs: time,
      targetAtMs: time + 300, inputValues: [...input], values: [...prediction] }
  }
  private reading(t: number, state: ForecastState, ruleState = state, deviation: number | null = null,
    error: number | null = null, progress = 0): ForecastReading {
    return { schema_version: 'forecast-experiment-v1', timeMs: t, state, ruleState, deviation, error,
      errorLimit: this.baseline ? this.limit : null, progress, returnedExcursions: this.policy.returned,
      durationMs: this.policy.durationStart === null ? 0 : t - this.policy.durationStart,
      modelId: this.modelId, domainValidated: false,
      ...(this.options.mode === 'observed' ? { evaluationMode: 'observed-v2' as const,
        predictionTimeMs: error === null ? null : this.residual?.time ?? null,
        predictionInputMaxGapMs: FORECAST_PREDICTION_MAX_GAP_MS,
        ruleDurationMs: this.rule.durationStart === null ? 0 : t - this.rule.durationStart,
        ruleReturnedExcursions: this.rule.returned,
        ruleRecoveryMs: this.rule.recoveryStart === null ? 0 : t - this.rule.recoveryStart,
        predictionRecoveryMs: this.policy.recoveryStart === null ? 0 : t - this.policy.recoveryStart } : {}),
      ...(this.normalProfile ? { normalScore: this.normalScore, normalProfileId: this.normalProfile.id } : {}),
      ...(this.imageAnchor ? { postureScore: this.postureScore, postureEntryRatio: DEV_POSTURE_DECISION.entryRatio,
        postureRecoveryRatio: DEV_POSTURE_DECISION.recoveryRatio, imagePosture: this.imageAnchor.snapshot } : {}) }
  }
  unavailable(t: number, reason: ForecastPredictionResetReason = 'quality') {
    if (this.options.mode === 'observed') this.validateTime(t)
    this.breakContinuity(reason); this.lastRaw = t; return this.reading(t, 'unmeasurable')
  }
  /** A delivery watchdog is not a new observation. Never advance source time or fill future frames. */
  delayed(t: number): ForecastReading {
    if (this.options.mode !== 'observed') return this.unavailable(t)
    if (!Number.isFinite(t) || t < 0) {
      this.breakContinuity('time')
      throw new Error('관측 시각이 역전됐습니다.')
    }
    const age = this.lastRaw === null ? null : Math.max(0, t - this.lastRaw)
    this.observationGapMs = age
    this.display = null; this.residual = null; this.resetRules()
    if (age !== null && age > FORECAST_PREDICTION_MAX_GAP_MS && this.observedPrevious) {
      this.resetPrediction('gap')
    }
    return this.reading(t, 'unmeasurable')
  }
  private validateTime(t: number) {
    if (!Number.isFinite(t) || t < 0 || (this.lastRaw !== null && t <= this.lastRaw)) {
      this.breakContinuity('time')
      throw new Error('관측 시각이 역전됐습니다.')
    }
  }

  /** Only interpolate between two valid, already received observations. Never cross a quality gap. */
  private sampleObserved(t: number, values: number[]) {
    const previous = this.observedPrevious
    if (previous && t - previous.time > FORECAST_OBSERVATION_MAX_GAP_MS) {
      this.predictionBridgedGaps++
      // Interpolated inputs over a cadence delay are not observed residual targets.
      this.queued = []; this.residual = null
    }
    if (!previous) this.nextGrid = t
    while (this.nextGrid !== null && this.nextGrid <= t + 1e-6) {
      const time = this.nextGrid
      const fraction = previous ? Math.min(1, (time - previous.time) / (t - previous.time)) : 1
      const sample = previous ? values.map((v, i) => previous.values[i] + fraction * (v - previous.values[i])) : [...values]
      const due = this.queued.find(p => Math.abs(p.due - time) < 1e-5)
      this.queued = this.queued.filter(p => p.due > time + 1e-5)
      if (due) {
        this.residual = { time, error: pointDistance(due.prediction, sample) }
        if (this.registration) this.registrationErrors.push(this.residual.error)
      }
      this.history.push({ time, values: sample }); this.history = this.history.slice(-30)
      // The target must still be in the future at actual inference time, not merely at grid time.
      if (this.history.length === 30 && time + 300 > t) {
        this.forecast(time, sample)
      }
      this.nextGrid += 100
    }
    this.observedPrevious = { time: t, values: [...values] }
  }

  private stepObserved(t: number, values: number[] | null, poseModelId?: string, image?: ImagePostureInput | null): ForecastReading {
    this.validateTime(t)
    const gap = this.lastRaw === null ? 0 : t - this.lastRaw
    this.observationGapMs = this.lastRaw === null ? null : gap
    const valid = values && values.length === 39 && values.every(Number.isFinite)
    if (!valid) return this.unavailable(t)
    this.lastRaw = t
    if (gap > FORECAST_OBSERVATION_MAX_GAP_MS) {
      if (this.registration && gap <= FORECAST_REGISTRATION_MAX_SAMPLE_GAP_MS) {
        // Keep real baseline samples. Only the predictor may bridge a bounded cadence delay.
        if (gap > FORECAST_PREDICTION_MAX_GAP_MS) this.resetPrediction('gap')
      } else if (gap <= FORECAST_PREDICTION_MAX_GAP_MS) {
        this.resetRules()
        this.sampleObserved(t, values)
        // A usable predictor window does not turn a rule/collection gap into a valid interval.
        return this.reading(t, 'unmeasurable')
      } else {
        this.breakContinuity('gap')
        return this.reading(t, 'unmeasurable')
      }
    }
    this.sampleObserved(t, values)
    const error = this.residual && t - this.residual.time <= FORECAST_OBSERVATION_MAX_GAP_MS ? this.residual.error : null
    if (this.registration) {
      if (this.imageAnchor && !this.imageAnchor.collect(image)) { this.breakContinuity(); return this.reading(t, 'unmeasurable') }
      this.registrationStart ??= t
      // Baseline minimum counts real observations, not interpolated grid points.
      this.registration.push([...values])
      const elapsed = t - this.registrationStart
      if (elapsed >= 8000 && this.registration.length >= 65) {
        const candidate = Array.from({ length: 39 }, (_, i) => quantile(this.registration!.map(v => v[i]), .5))
        this.referenceCheck = validateNormalReference(this.normalProfile, { values: candidate, poseModelId })
        if (this.normalProfile && this.referenceCheck.status !== 'accepted') {
          this.registration = null; this.registrationStart = null; this.registrationErrors = []
          this.breakContinuity()
          return this.reading(t, 'needs_reference')
        }
        if (this.imageAnchor && !this.imageAnchor.finishRegistration()) return this.reading(t, 'registering')
        this.baseline = candidate
        this.limit = this.registrationErrors.length >= 20 ? Math.max(.02, quantile(this.registrationErrors, .99)) : .02
        this.registration = null; this.registrationStart = null; this.registrationErrors = []
        this.policy.reset(); this.rule.reset()
      } else return this.reading(t, 'registering', 'registering', null, error,
        Math.min(1, elapsed / 8000, this.registration.length / 65))
    }
    if (!this.baseline) return this.reading(t, 'needs_reference')
    const deviation = pointDistance(values, this.baseline)
    const score = this.normalProfile ? scoreNormalPosture(this.normalProfile, values) : null
    if (this.normalProfile && !score) { this.breakContinuity(); return this.reading(t, 'unmeasurable') }
    const imageScore = this.imageAnchor?.measure(t, image)
    if (this.imageAnchor && !imageScore) { this.breakContinuity(); return this.reading(t, 'unmeasurable') }
    this.normalScore = score?.score ?? null
    const relativeRatio = score ? score.score : deviation / .12
    this.postureScore = imageScore ? Math.max(relativeRatio, imageScore.score!) : null
    // Both branches share the developer timing policy; relative geometry is reported unchanged.
    const decisionDistance = this.postureScore !== null ? this.postureScore * .12 : score ? score.score * .12 : deviation
    const thresholds = imageScore ? developerDistanceLimits : legacyDistanceLimits
    const ruleState = this.rule.step(t, decisionDistance, error, this.limit, true, !!score || !!imageScore, thresholds)
    const hybridState = this.policy.step(t, decisionDistance, error, this.limit, false, !!score || !!imageScore, thresholds)
    return this.reading(t, error === null ? 'warming' : hybridState, ruleState, deviation, error)
  }
  step(t: number, values: number[] | null, poseModelId = this.options.poseModelId, image?: ImagePostureInput | null): ForecastReading | null {
    if (this.options.mode === 'observed') {
      if (this.predictor === 'lstm' && this.model && !forecastModelMatchesPoseModel(this.model, poseModelId)) return this.unavailable(t)
      if (this.normalProfile && validateNormalReference(this.normalProfile, { values, poseModelId }).status === 'incompatible') {
        this.referenceCheck = validateNormalReference(this.normalProfile, { values, poseModelId })
        return this.unavailable(t)
      }
      return this.stepObserved(t, values, poseModelId, image)
    }
    if (!Number.isFinite(t) || t < 0 || (this.lastRaw !== null && t <= this.lastRaw)) throw new Error('관측 시각이 역전됐습니다.')
    const gap = this.lastRaw !== null && t - this.lastRaw > 250
    const registrationGap = this.registration !== null && this.lastRaw !== null &&
      t - this.lastRaw <= FORECAST_REGISTRATION_MAX_SAMPLE_GAP_MS
    this.lastRaw = t
    if (gap && !registrationGap) this.breakContinuity()
    if (!values || values.length !== 39 || values.some(v => !Number.isFinite(v))) return this.unavailable(t)
    if (this.lastSample !== null && t - this.lastSample < 95) return null
    if (this.lastSample !== null && t - this.lastSample > FORECAST_MAX_SAMPLE_GAP_MS && !registrationGap) this.breakContinuity()
    this.lastSample = t
    const due = this.queued.filter(p => p.due <= t + 50 && p.due >= t - 50)
    this.queued = this.queued.filter(p => p.due > t + 50)
    const error = due.length ? pointDistance(due[due.length - 1].prediction, values) : null
    this.history.push({ time: t, values: [...values] }); this.history = this.history.slice(-30)
    if (this.history.length === 30) {
      this.forecast(t, values)
    }
    if (this.registration) {
      this.registrationStart ??= t; this.registration.push([...values])
      if (error !== null) this.registrationErrors.push(error)
      const elapsed = t - this.registrationStart
      if (elapsed >= 8000 && this.registration.length >= 65) {
        this.baseline = Array.from({ length: 39 }, (_, i) => quantile(this.registration!.map(v => v[i]), .5))
        // Slow or irregular cameras may never produce 20 timestamp-matched forecasts.
        // Keep the explicit minimum instead of trapping an otherwise valid baseline.
        this.limit = this.registrationErrors.length >= 20 ? Math.max(.02, quantile(this.registrationErrors, .99)) : .02
        this.registration = null; this.registrationStart = null; this.registrationErrors = []
        this.policy.reset(); this.rule.reset()
      } else return this.reading(t, 'registering', 'registering', null, error,
        Math.min(1, elapsed / 8000, this.registration.length / 65))
    }
    if (!this.baseline) return this.reading(t, 'needs_reference')
    const deviation = pointDistance(values, this.baseline)
    const ruleState = this.rule.step(t, deviation, error, this.limit, true)
    const hybridState = this.policy.step(t, deviation, error, this.limit)
    return this.reading(t, error === null ? 'warming' : hybridState, ruleState, deviation, error)
  }
}
