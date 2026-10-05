import type { CollapseEvent } from '../../lib/engine'
import type { SessionView } from '../session/server/contracts'
import { projectMachine } from '../session/server/projection'

/** Key order is irrelevant, but every saved value must agree with the acknowledged snapshot. */
export function sameSnapshot(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((item, index) => sameSnapshot(item, b[index]))
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameSnapshot(left[key], right[key]))
  )
}

/** A local archive closes display rows without inventing a remote termination decision. */
export function serverRecordEvents(view: SessionView | null, confirmed: boolean): CollapseEvent[] {
  const machine = projectMachine(view)
  return machine.events.map((event) =>
    !confirmed && event.endAt === null
      ? {
          ...event,
          endAt: machine.total,
          durationSec: machine.total - event.startAt,
          recovered: false,
          recoverySec: null,
          endedBySession: false,
          endReason: 'unknown',
        }
      : event,
  )
}
