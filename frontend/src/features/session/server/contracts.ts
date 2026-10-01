import type { LiveState, Rules } from '../../../lib/engine'
import type { Features } from '../../../../../model/prototype/pose'

export type ServerPolicy = {
  hold_ms: number
  recovery_ms: number
  reminder_ms: number
  threshold: number
}

export type ServerPhase = 'running' | 'rest' | 'away'
export type DeviationType = 'none' | 'forward_slouch' | 'left_lean' | 'right_lean' | 'unspecified'
export type FeatureDeltas = {
  head_gap_delta: number
  lateral_offset_delta: number
  shoulder_tilt_delta: number
  current_quality: number
  baseline_quality: number
}

/** Only baseline-relative changes cross the service boundary; no image or landmark arrays. */
export type FrameRequest = {
  schema_version: '2.0'
  feature_version: 'shoulder-relative-deltas-v1'
  baseline_id: string
  sequence: number
  start_ms: number
  end_ms: number
  phase: ServerPhase
  measurement_quality: 'good' | 'poor'
  features: FeatureDeltas | null
}

export type ServerObservation = {
  schema_version: '2.0'
  sequence: number
  start_ms: number
  end_ms: number
  phase: ServerPhase
  valid: boolean
  collapse_probability: number
  deviation_type: DeviationType
  model_version: string
}

export type DecisionEvent = {
  schema_version: '1.0'
  session_id: string
  event_id: number
  kind: 'collapse_confirmed' | 'recovery_confirmed' | 'reminder' | 'interrupted' | 'session_ended'
  timestamp_ms: number
  onset_ms: number
  onset_valid_ms: number
  deviation_type: DeviationType
  reason: null | 'missing' | 'missing_sequence' | 'unmeasurable' | 'rest' | 'away' | 'ended'
}

export type ServerSummary = {
  total_ms: number
  valid_ms: number
  normal_ms: number
  deviation_ms: number
  rest_ms: number
  away_ms: number
  unknown_ms: number
  missing_ms: number
  collapse_count: number
  alert_count: number
  interval_count: number
  keep_rate: number | null
  events_per_hour: number | null
  mean_interval_ms: number | null
  mean_recovery_ms: number | null
}

export type SessionView = {
  schema_version: '1.0'
  session_id: string
  policy: ServerPolicy
  timer_policy: 'legacy-interrupt-v1'
  ended: boolean
  last_sequence: number
  summary: ServerSummary
  events: DecisionEvent[]
}

export type FeatureResponse = {
  schema_version: '1.0'
  observation: ServerObservation
  session: SessionView
}

export type ServerPendingRequest =
  | { kind: 'create'; body: { policy: ServerPolicy } }
  | { kind: 'features'; body: FrameRequest }
  | { kind: 'end'; body: { end_ms: number } }

/** One uncertain request is durable. Unsent queued frames may be lost, leaving real time gaps. */
export type ServerCheckpoint = {
  schemaVersion: '1.0'
  baselineId: string
  baseline: Features
  deviceId: string
  frameWidth: number
  frameHeight: number
  savedAt: string
  elapsedMs: number
  view: SessionView | null
  nextSequence: number
  lastNotificationId: number
  modelVersion: string | null
  /** Fixed user end intent can coexist with one uncertain feature request. Older drafts omit it. */
  endAt?: number | null
  pending: ServerPendingRequest | null
}

export type ServerSessionDescriptor = {
  id: string
  startedAt: string
  rules: Rules
  server: {
    baselineId: string
    baseline: Features
    deviceId: string
    frameWidth: number
    frameHeight: number
    checkpoint?: ServerCheckpoint
    finishOnly?: boolean
  }
}

/** Live service data has no fabricated skeleton or client-maintained confirmation countdown. */
export type ServerLiveState = Omit<
  LiveState,
  'keypoints' | 'features' | 'holdProgress' | 'recoverProgress' | 'nextAlertIn'
> & { modelVersion: string | null; view: SessionView | null }

export function policyFor(rules: Rules): ServerPolicy {
  return {
    hold_ms: Math.round(rules.holdSeconds * 1000),
    recovery_ms: Math.round(rules.recoverSeconds * 1000),
    reminder_ms: Math.round(rules.realertSeconds * 1000),
    threshold: rules.threshold,
  }
}

export function samePolicy(a: ServerPolicy, b: ServerPolicy) {
  return (
    a.hold_ms === b.hold_ms &&
    a.recovery_ms === b.recovery_ms &&
    a.reminder_ms === b.reminder_ms &&
    a.threshold === b.threshold
  )
}
