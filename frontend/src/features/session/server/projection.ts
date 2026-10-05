import type { CollapseType } from '../../../data/posture'
import type { CollapseEvent, Machine } from '../../../lib/engine'
import type { DecisionEvent, ServerLiveState, ServerObservation, SessionView } from './contracts'

function collapseType(type: DecisionEvent['deviation_type']): CollapseType {
  if (type === 'forward_slouch') return 'forwardHead'
  if (type === 'left_lean' || type === 'right_lean') return 'tilt'
  return 'referenceChange'
}

/** Projects server decisions for existing displays/storage; it never runs a temporal rule. */
export function projectMachine(view: SessionView | null): Machine {
  const events: CollapseEvent[] = []
  let active: CollapseEvent | null = null
  let blockId = 0
  let lastAlertAt = 0
  for (const decision of view?.events ?? []) {
    const at = decision.timestamp_ms / 1000
    if (decision.kind === 'collapse_confirmed') {
      active = {
        id: decision.event_id,
        type: collapseType(decision.deviation_type),
        startAt: decision.onset_ms / 1000,
        validStartAt: decision.onset_valid_ms / 1000,
        confirmedAt: at,
        endAt: null,
        durationSec: 0,
        alerts: 1,
        firstAlertAt: at,
        recovered: false,
        recoverySec: null,
        endedBySession: false,
        endReason: null,
        blockId,
      }
      events.push(active)
      lastAlertAt = at
    } else if (decision.kind === 'reminder' && active) {
      active.alerts++
      lastAlertAt = at
    } else if (
      (decision.kind === 'recovery_confirmed' || decision.kind === 'interrupted') &&
      active
    ) {
      active.endAt = at
      active.durationSec = at - active.startAt
      active.recovered = decision.kind === 'recovery_confirmed'
      active.recoverySec = active.recovered ? at - active.firstAlertAt! : null
      active.endedBySession = decision.reason === 'ended'
      active.endReason = active.recovered
        ? null
        : decision.reason === 'ended'
          ? 'ended'
          : decision.reason === 'rest'
            ? 'paused'
            : 'unknown'
      active = null
      if (decision.kind === 'interrupted') blockId++
    }
  }
  const s = view?.summary
  return {
    loop: s ? s.total_ms / 1000 : 0,
    total: s ? s.total_ms / 1000 : 0,
    paused: s ? s.rest_ms / 1000 : 0,
    unknown: s ? (s.away_ms + s.unknown_ms + s.missing_ms) / 1000 : 0,
    good: s ? s.normal_ms / 1000 : 0,
    collapse: s ? s.deviation_ms / 1000 : 0,
    // The v1 view does not expose live confirmation/recovery progress.
    hold: 0,
    recover: 0,
    onsetAt: null,
    active,
    events,
    nextId: Math.max(0, ...events.map((event) => event.id)) + 1,
    lastAlertAt,
    alertTick: s?.alert_count ?? 0,
    blockId,
    interrupted: !active,
  }
}

export function projectLive(
  view: SessionView | null,
  observation: ServerObservation | null,
  modelVersion: string | null = observation?.model_version ?? null,
): ServerLiveState {
  const machine = projectMachine(view)
  const measurable = !!observation?.valid && !view?.ended
  const collapse = measurable && observation.collapse_probability >= (view?.policy.threshold ?? 1)
  return {
    view,
    modelVersion,
    state: measurable ? (collapse ? 'collapse' : 'good') : 'unknown',
    collapse: measurable && collapse ? collapseType(observation.deviation_type) : null,
    notice: measurable
      ? null
      : view?.ended
        ? '측정을 종료했습니다.'
        : '서버에서 확인한 유효 입력을 기다리고 있습니다.',
    confidence: 0,
    collapseProb: measurable ? observation.collapse_probability : 0,
    alerting: machine.active !== null,
    totalSeconds: machine.total,
    pausedSeconds: machine.paused,
    unknownSeconds: machine.unknown,
    validSeconds: view ? view.summary.valid_ms / 1000 : 0,
    goodSeconds: machine.good,
    collapseSeconds: machine.collapse,
    events: machine.events,
    alertTick: machine.alertTick,
  }
}
