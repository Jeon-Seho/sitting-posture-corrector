/** Research-only LSTM + reference experiment. No service/CEP output. */
import type { Landmark } from './pose'

export interface ForecastWeights {
  schema_version: 'forecast-weights-v1'
  model_id: string
  source_sha256: string
  domain_validated: false
  config: { steps: number; dimensions: number; hidden: number; horizon: number; point_definition: string }
  mean: number[]
  scale: number[]
  weights: Record<string, number[]>
}
const SHAPES: Record<string, number> = {
  'lstm.weight_ih_l0': 192 * 39, 'lstm.weight_hh_l0': 192 * 48,
  'lstm.bias_ih_l0': 192, 'lstm.bias_hh_l0': 192,
  'output.weight': 39 * 48, 'output.bias': 39,
}
export function readForecastWeights(value: unknown): ForecastWeights {
  const v = value as ForecastWeights
  if (!v || v.schema_version !== 'forecast-weights-v1' || v.domain_validated !== false ||
    typeof v.model_id !== 'string' || !/^[a-f0-9]{64}$/.test(v.source_sha256) ||
    v.config?.steps !== 30 || v.config.dimensions !== 39 || v.config.hidden !== 48 || v.config.horizon !== 3 ||
    v.config.point_definition !== 'Panoptic-face9-body4-not-MediaPipe') throw new Error('지원하지 않는 예측 모델입니다.')
  const valid = (a: unknown, n: number): a is number[] => Array.isArray(a) && a.length === n && a.every(Number.isFinite)
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
}
export class ForecastPolicy {
  private farAt: number | null = null
  private predictableAt: number | null = null
  private nearAt: number | null = null
  private persistent = false
  returned = 0
  reset() { this.farAt = null; this.predictableAt = null; this.nearAt = null; this.persistent = false }
  get durationStart() { return this.farAt }
  step(t: number, deviation: number, error: number | null, limit: number, ruleOnly = false): ForecastState {
    const outside = deviation >= .12 || (this.farAt !== null && deviation > .08)
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
  constructor(readonly model: ForecastWeights | null, readonly predictor: 'lstm' | 'hold_last' | 'constant_velocity' = 'lstm') {
    if (predictor === 'lstm') {
      if (!model) throw new Error('LSTM 예측에는 학습 모델이 필요합니다. 모델 없이 실행하려면 위치 유지 또는 등속 예측을 선택해 주세요.')
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
    this.baseline = null; this.registration = []; this.registrationStart = null; this.registrationErrors = []
    this.policy = new ForecastPolicy(); this.rule = new ForecastPolicy()
    this.breakContinuity()
  }
  private breakContinuity() {
    this.history = []; this.queued = []; this.lastSample = null; this.policy.reset(); this.rule.reset()
    if (this.registration) { this.registration = []; this.registrationStart = null; this.registrationErrors = [] }
  }
  get ready() { return this.baseline !== null }
  get residualLimit() { return this.limit }
  private reading(t: number, state: ForecastState, ruleState = state, deviation: number | null = null,
    error: number | null = null, progress = 0): ForecastReading {
    return { schema_version: 'forecast-experiment-v1', timeMs: t, state, ruleState, deviation, error,
      errorLimit: this.baseline ? this.limit : null, progress, returnedExcursions: this.policy.returned,
      durationMs: this.policy.durationStart === null ? 0 : t - this.policy.durationStart,
      modelId: this.modelId, domainValidated: false }
  }
  unavailable(t: number) { this.breakContinuity(); this.lastRaw = t; return this.reading(t, 'unmeasurable') }
  step(t: number, values: number[] | null): ForecastReading | null {
    if (!Number.isFinite(t) || t < 0 || (this.lastRaw !== null && t <= this.lastRaw)) throw new Error('관측 시각이 역전됐습니다.')
    const gap = this.lastRaw !== null && t - this.lastRaw > 250
    this.lastRaw = t
    if (gap) this.breakContinuity()
    if (!values || values.length !== 39 || values.some(v => !Number.isFinite(v))) return this.unavailable(t)
    if (this.lastSample !== null && t - this.lastSample < 95) return null
    if (this.lastSample !== null && t - this.lastSample > FORECAST_MAX_SAMPLE_GAP_MS) this.breakContinuity()
    this.lastSample = t
    const due = this.queued.filter(p => p.due <= t + 50 && p.due >= t - 50)
    this.queued = this.queued.filter(p => p.due > t + 50)
    const error = due.length ? pointDistance(due[due.length - 1].prediction, values) : null
    this.history.push({ time: t, values: [...values] }); this.history = this.history.slice(-30)
    if (this.history.length === 30) {
      const window = this.history.map(p => p.values)
      this.queued.push({ due: t + 300, prediction: this.predict(window) })
    }
    if (this.registration) {
      this.registrationStart ??= t; this.registration.push([...values])
      if (error !== null) this.registrationErrors.push(error)
      const elapsed = t - this.registrationStart
      if (elapsed >= 8000 && this.registration.length >= 65 && this.registrationErrors.length >= 20) {
        this.baseline = Array.from({ length: 39 }, (_, i) => quantile(this.registration!.map(v => v[i]), .5))
        this.limit = Math.max(.02, quantile(this.registrationErrors, .99))
        this.registration = null; this.registrationStart = null; this.registrationErrors = []
        this.policy.reset(); this.rule.reset()
      } else return this.reading(t, 'registering', 'registering', null, error, Math.min(1, elapsed / 8000))
    }
    if (!this.baseline) return this.reading(t, 'needs_reference')
    const deviation = pointDistance(values, this.baseline)
    const ruleState = this.rule.step(t, deviation, error, this.limit, true)
    const hybridState = this.policy.step(t, deviation, error, this.limit)
    return this.reading(t, error === null ? 'warming' : hybridState, ruleState, deviation, error)
  }
}
