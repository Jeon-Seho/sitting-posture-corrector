import type { ForecastReading, ForecastWeights } from '../../../../model/prototype/forecast'

export type LabPredictor = 'hold_last' | 'constant_velocity' | 'lstm'
export type LabSource = 'camera' | 'synthetic'
export type LabPhase = 'idle' | 'connecting' | 'guiding' | 'registering' | 'measuring' | 'finished' | 'error'
export type LabAlertBasis = 'predictor' | 'rule'
export type LabAudioStatus = 'inactive' | 'ready' | 'blocked' | 'unsupported'
export interface LabAlert {
  id: number
  timeMs: number
  basis: LabAlertBasis
  kind: 'first' | 'reminder'
  deviation: number
  peakDeviation: number
  durationMs: number
  error: number | null
  errorLimit: number | null
  source: LabSource
}
/** Transient display data. Never included in records or diagnostic exports. */
export interface LabGuidePoint { x: number; y: number; visibility: number }
export interface LabGuideFrame { points: LabGuidePoint[]; width: number; height: number; timeMs: number }
export interface LabGuidance {
  step: 'intro' | 'framing' | 'reference' | 'tracking'
  cue: 'waiting' | 'missing' | 'center' | 'far' | 'close' | 'steady' | 'ready'
  instruction: string
  detail: string
  ready: boolean
  holdProgress: number
  introStep: number
  live: LabGuideFrame | null
  reference: LabGuideFrame | null
  /** Observed screen geometry relative to reference, not posture diagnoses. */
  lateralPercent: number | null
  verticalPercent: number | null
  shoulderDegrees: number | null
}
export interface LabEvent { id: number; timeMs: number; label: string; tone: 'neutral' | 'good' | 'warning' | 'unknown' }
export interface LabSummary {
  elapsedMs: number
  validMs: number
  nearMs: number
  unavailableMs: number
  nearPercent: number | null
  meanError: number | null
  deviations: number
}
export interface LabRecord {
  id: string
  startedAt: string
  source: LabSource
  predictor: LabPredictor
  summary: LabSummary
  readings: ForecastReading[]
  events: LabEvent[]
  modelId: string
  modelSha256: string | null
  alerts?: LabAlert[]
  alertCount?: number
  alertSettings?: { basis: LabAlertBasis; reminderMs: number }
}
export interface DeveloperSession {
  phase: LabPhase
  source: LabSource
  predictor: LabPredictor
  setPredictor: (value: LabPredictor) => void
  model: ForecastWeights | null
  modelStatus: 'loading' | 'ready' | 'missing' | 'invalid'
  modelError: string
  loadModel: (file: File) => Promise<void>
  error: string
  reading: ForecastReading | null
  readings: ForecastReading[]
  events: LabEvent[]
  summary: LabSummary
  records: LabRecord[]
  visiblePoints: number
  guidance: LabGuidance
  alerts: LabAlert[]
  alertCount: number
  alertPeakDeviation: number | null
  alertBasis: LabAlertBasis
  setAlertBasis: (basis: LabAlertBasis) => void
  soundEnabled: boolean
  setSoundEnabled: (enabled: boolean) => void
  audioStatus: LabAudioStatus
  testAlertSound: () => void
  start: () => void
  startDemo: () => void
  stop: () => void
  download: (record?: LabRecord) => void
}
