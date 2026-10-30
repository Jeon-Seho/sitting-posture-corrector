import type { CollapseType } from '../../../data/posture'
import type { CollapseEvent } from '../../../lib/engine'
import type { Decision } from './messages'

function collapseType(type: Decision['deviation_type']): CollapseType {
  if (type === 'forward_slouch') return 'forwardHead'
  if (type === 'left_lean' || type === 'right_lean') return 'tilt'
  return 'referenceChange'
}

/**
 * Rows for the event table and the saved record, from the server's decisions only (no timing
 * rule runs here). A collapse still open when the list ends stays open (`endAt` null).
 */
export function collapseEvents(decisions: Decision[]): CollapseEvent[] {
  const events: CollapseEvent[] = []
  let active: CollapseEvent | null = null
  let blockId = 0
  for (const decision of decisions) {
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
    } else if (decision.kind === 'reminder' && active) {
      active.alerts++
    } else if ((decision.kind === 'recovery_confirmed' || decision.kind === 'interrupted') && active) {
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
  return events
}
