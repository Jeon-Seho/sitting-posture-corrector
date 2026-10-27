import type { Rules } from '../../../lib/engine'
import { policyFor, samePolicy, type DecisionEvent, type ServerPolicy, type SessionView } from './contracts'

const DAY_MS = 86_400_000
const MAX_EVENTS = 30_001
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const deviationTypes = ['none', 'forward_slouch', 'left_lean', 'right_lean', 'unspecified']
const reasons = [null, 'missing', 'missing_sequence', 'unmeasurable', 'rest', 'away', 'ended']
const kinds = [
  'collapse_confirmed',
  'recovery_confirmed',
  'reminder',
  'interrupted',
  'session_ended',
]

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key))
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  number(v) && Number.isSafeInteger(v) && v >= min && v <= max
const unit = (v: unknown): v is number => number(v) && v >= 0 && v <= 1
const nonnegative = (v: unknown): v is number => number(v) && v >= 0
const nullableNonnegative = (v: unknown) => v === null || nonnegative(v)
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, a, b)
export const validUuid = (v: unknown): v is string => typeof v === 'string' && uuidPattern.test(v)

function validPolicy(v: unknown): v is ServerPolicy {
  return (
    object(v) &&
    exact(v, ['hold_ms', 'recovery_ms', 'reminder_ms', 'threshold']) &&
    integer(v.hold_ms, 1, DAY_MS) &&
    integer(v.recovery_ms, 1, DAY_MS) &&
    integer(v.reminder_ms, 1, DAY_MS) &&
    unit(v.threshold) &&
    v.threshold > 0
  )
}

function validEvent(v: unknown, id: string, total: number, valid: number): v is DecisionEvent {
  return (
    object(v) &&
    exact(v, [
      'schema_version',
      'session_id',
      'event_id',
      'kind',
      'timestamp_ms',
      'onset_ms',
      'onset_valid_ms',
      'deviation_type',
      'reason',
    ]) &&
    v.schema_version === '1.0' &&
    v.session_id === id &&
    integer(v.event_id, 1) &&
    typeof v.kind === 'string' &&
    kinds.includes(v.kind) &&
    integer(v.timestamp_ms, 0, total) &&
    integer(v.onset_ms, 0, v.timestamp_ms) &&
    integer(v.onset_valid_ms, 0, Math.min(valid, v.onset_ms)) &&
    typeof v.deviation_type === 'string' &&
    deviationTypes.includes(v.deviation_type) &&
    (v.reason === null || typeof v.reason === 'string') &&
    reasons.includes(v.reason as null) &&
    (v.kind === 'interrupted'
      ? v.reason !== null
      : v.kind === 'session_ended'
        ? v.reason === 'ended'
        : v.reason === null)
  )
}

export function validSessionView(
  v: unknown,
  expectedId?: string,
  expectedRules?: Rules,
): v is SessionView {
  if (
    !object(v) ||
    !exact(v, [
      'schema_version',
      'session_id',
      'policy',
      'timer_policy',
      'ended',
      'last_sequence',
      'summary',
      'events',
    ]) ||
    v.schema_version !== '1.0' ||
    !validUuid(v.session_id) ||
    (expectedId !== undefined && v.session_id !== expectedId) ||
    !validPolicy(v.policy) ||
    (expectedRules !== undefined && !samePolicy(v.policy, policyFor(expectedRules))) ||
    v.timer_policy !== 'legacy-interrupt-v1' ||
    typeof v.ended !== 'boolean' ||
    !integer(v.last_sequence, -1) ||
    !object(v.summary) ||
    !Array.isArray(v.events) ||
    v.events.length > MAX_EVENTS
  )
    return false
  const s = v.summary
  const totals = [
    'total_ms',
    'valid_ms',
    'normal_ms',
    'deviation_ms',
    'rest_ms',
    'away_ms',
    'unknown_ms',
    'missing_ms',
  ]
  if (
    !exact(s, [
      ...totals,
      'collapse_count',
      'alert_count',
      'interval_count',
      'keep_rate',
      'events_per_hour',
      'mean_interval_ms',
      'mean_recovery_ms',
    ]) ||
    !totals.every((key) => integer(s[key], 0, DAY_MS)) ||
    !['collapse_count', 'alert_count', 'interval_count'].every((key) =>
      integer(s[key], 0, MAX_EVENTS),
    ) ||
    !(s.keep_rate === null || unit(s.keep_rate)) ||
    !['events_per_hour', 'mean_interval_ms', 'mean_recovery_ms'].every((key) =>
      nullableNonnegative(s[key]),
    )
  )
    return false
  const summary = s as unknown as SessionView['summary']
  if (
    summary.valid_ms !== summary.normal_ms + summary.deviation_ms ||
    summary.total_ms !==
      summary.valid_ms +
        summary.rest_ms +
        summary.away_ms +
        summary.unknown_ms +
        summary.missing_ms ||
    (summary.valid_ms === 0
      ? summary.keep_rate !== null || summary.events_per_hour !== null
      : summary.keep_rate === null ||
        summary.events_per_hour === null ||
        !close(summary.keep_rate, summary.normal_ms / summary.valid_ms) ||
        !close(summary.events_per_hour, (summary.collapse_count * 3_600_000) / summary.valid_ms)) ||
    summary.interval_count !== Math.max(0, summary.collapse_count - 1) ||
    (summary.interval_count === 0) !== (summary.mean_interval_ms === null) ||
    !v.events.every((event) =>
      validEvent(event, v.session_id as string, summary.total_ms, summary.valid_ms),
    )
  )
    return false

  const events = v.events as DecisionEvent[]
  let active: DecisionEvent | null = null
  let previousId = 0,
    previousTime = 0,
    collapses = 0,
    alerts = 0,
    recoveries = 0,
    ended = false
  for (const event of events) {
    if (ended || event.event_id <= previousId || event.timestamp_ms < previousTime) return false
    previousId = event.event_id
    previousTime = event.timestamp_ms
    if (event.kind === 'collapse_confirmed') {
      if (active) return false
      active = event
      collapses++
      alerts++
    } else if (event.kind === 'session_ended') {
      if (active || event.timestamp_ms !== summary.total_ms || event.deviation_type !== 'none')
        return false
      ended = true
    } else {
      if (
        !active ||
        event.onset_ms !== active.onset_ms ||
        event.onset_valid_ms !== active.onset_valid_ms ||
        event.deviation_type !== active.deviation_type
      )
        return false
      if (event.kind === 'reminder') alerts++
      else {
        if (event.kind === 'recovery_confirmed') recoveries++
        active = null
      }
    }
  }
  return (
    collapses === summary.collapse_count &&
    alerts === summary.alert_count &&
    ended === v.ended &&
    (recoveries === 0) === (summary.mean_recovery_ms === null)
  )
}
