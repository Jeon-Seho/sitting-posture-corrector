/**
 * `/v2/realtime` messages (BE api-spec 11장, contracts/realtime/realtime-ws.v2.schema.json).
 * The app only checks the shape it uses (10/21 decision: format checks only, nothing re-judged);
 * unknown fields, types and event kinds are ignored (api-ws-spec 1장, B11).
 */
export type Deviation = 'none' | 'forward_slouch' | 'left_lean' | 'right_lean' | 'unspecified'

export type Summary = {
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

export type DecisionKind = 'collapse_confirmed' | 'recovery_confirmed' | 'reminder' | 'interrupted' | 'session_ended'

export type Decision = {
  event_id: number
  kind: DecisionKind
  timestamp_ms: number
  onset_ms: number
  onset_valid_ms: number
  deviation_type: Deviation
  reason: null | 'missing' | 'missing_sequence' | 'unmeasurable' | 'rest' | 'away' | 'ended'
}

export type LiveObservation = {
  sequence: number
  start_ms: number
  end_ms: number
  phase: 'running' | 'rest' | 'away'
  valid: boolean
  collapse_probability: number
  deviation_type: Deviation
  invalid_reason: null | 'unmeasurable' | 'head_turn' | 'settling'
  model_version: string
}

export type PausedReason = null | 'rest' | 'away' | 'unmeasurable'

export type ClosedReason =
  | 'ended'
  | 'unauthorized'
  | 'not_owner'
  | 'session_lost'
  | 'no_baseline'
  | 'bad_message'
  | 'server_shutdown'
  | 'limit_reached'

export type ServerMessage =
  | { type: 'ready'; session_id: string }
  | { type: 'ack'; last_sequence: number }
  | { type: 'observation'; observation: LiveObservation }
  | { type: 'progress'; last_sequence: number; summary: Summary; paused_reason: PausedReason }
  | { type: 'decision'; event: Decision; summary: Summary }
  | { type: 'alert'; event_id: number; kind: 'collapse_confirmed' | 'reminder'; deviation_type: Deviation }
  | { type: 'stalled'; since_last_sequence: number }
  | { type: 'closed'; reason: ClosedReason | string }

/** S1·S3·S4 `SessionView` fields the app reads. */
export type SessionView = {
  session_id: string
  ended: boolean
  last_sequence: number
  summary: Summary
  events: Decision[]
}

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const SUMMARY_TIMES = ['total_ms', 'valid_ms', 'normal_ms', 'deviation_ms', 'rest_ms', 'away_ms', 'unknown_ms', 'missing_ms']
const SUMMARY_COUNTS = ['collapse_count', 'alert_count', 'interval_count']
const SUMMARY_OPTIONAL = ['keep_rate', 'events_per_hour', 'mean_interval_ms', 'mean_recovery_ms']

export function validSummary(v: unknown): v is Summary {
  return (
    obj(v) &&
    [...SUMMARY_TIMES, ...SUMMARY_COUNTS].every((k) => num(v[k])) &&
    SUMMARY_OPTIONAL.every((k) => v[k] === null || num(v[k]))
  )
}

const KINDS: DecisionKind[] = ['collapse_confirmed', 'recovery_confirmed', 'reminder', 'interrupted', 'session_ended']

function validDecision(v: unknown): v is Decision {
  return (
    obj(v) &&
    num(v.event_id) &&
    typeof v.kind === 'string' &&
    num(v.timestamp_ms) &&
    num(v.onset_ms) &&
    num(v.onset_valid_ms) &&
    typeof v.deviation_type === 'string'
  )
}

function validObservation(v: unknown): v is LiveObservation {
  return (
    obj(v) &&
    num(v.sequence) &&
    num(v.start_ms) &&
    num(v.end_ms) &&
    typeof v.valid === 'boolean' &&
    num(v.collapse_probability) &&
    typeof v.deviation_type === 'string'
  )
}

/** Parses one text frame; null for anything the app does not use or cannot read. */
export function parseServerMessage(text: string): ServerMessage | null {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return null
  }
  if (!obj(v) || typeof v.type !== 'string') return null
  switch (v.type) {
    case 'ready':
      return typeof v.session_id === 'string' ? (v as ServerMessage) : null
    case 'ack':
      return num(v.last_sequence) ? (v as ServerMessage) : null
    case 'observation':
      return validObservation(v.observation) ? (v as ServerMessage) : null
    case 'progress':
      return num(v.last_sequence) && validSummary(v.summary) ? (v as ServerMessage) : null
    case 'decision':
      return validDecision(v.event) && KINDS.includes(v.event.kind as DecisionKind) && validSummary(v.summary)
        ? (v as ServerMessage)
        : null
    case 'alert':
      return num(v.event_id) && (v.kind === 'collapse_confirmed' || v.kind === 'reminder') ? (v as ServerMessage) : null
    case 'stalled':
      return v as ServerMessage
    case 'closed':
      return typeof v.reason === 'string' ? (v as ServerMessage) : null
    default:
      return null
  }
}

export function parseSessionView(v: unknown): SessionView | null {
  if (!obj(v) || typeof v.session_id !== 'string' || typeof v.ended !== 'boolean' || !num(v.last_sequence)) return null
  if (!validSummary(v.summary) || !Array.isArray(v.events)) return null
  return {
    session_id: v.session_id,
    ended: v.ended,
    last_sequence: v.last_sequence,
    summary: v.summary,
    events: v.events.filter(validDecision).filter((e) => KINDS.includes(e.kind)),
  }
}

export const EMPTY_SUMMARY: Summary = {
  total_ms: 0,
  valid_ms: 0,
  normal_ms: 0,
  deviation_ms: 0,
  rest_ms: 0,
  away_ms: 0,
  unknown_ms: 0,
  missing_ms: 0,
  collapse_count: 0,
  alert_count: 0,
  interval_count: 0,
  keep_rate: null,
  events_per_hour: null,
  mean_interval_ms: null,
  mean_recovery_ms: null,
}
