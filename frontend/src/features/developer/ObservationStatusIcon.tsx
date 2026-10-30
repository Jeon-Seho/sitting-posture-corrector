import { Circle } from '@phosphor-icons/react'

export type ObservationStatus = 'off' | 'connecting' | 'waiting' | 'measuring'

/** Shared camera/legend icon; accessible status text distinguishes off and connecting. */
export function ObservationStatusIcon({ status }: { status: ObservationStatus }) {
  return status === 'off' || status === 'connecting'
    ? <span className="oc-status-dots" data-animated="true" aria-hidden="true"><i /><i /><i /></span>
    : <Circle size={12} weight="fill" aria-hidden="true" />
}
