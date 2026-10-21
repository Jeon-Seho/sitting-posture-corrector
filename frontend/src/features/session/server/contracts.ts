import type { Rules } from '../../../lib/engine'

/**
 * The server's `SessionView` as kept in a record (`RecordItem.server.view`, R1 format). The
 * measurement itself speaks `/v2/realtime` (`../live/`).
 */

export type ServerPolicy = {
  hold_ms: number
  recovery_ms: number
  reminder_ms: number
  threshold: number
}

export type DeviationType = 'none' | 'forward_slouch' | 'left_lean' | 'right_lean' | 'unspecified'
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
