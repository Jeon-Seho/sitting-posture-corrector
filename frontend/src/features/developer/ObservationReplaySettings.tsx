import { useEffect, useRef, type ReactNode } from 'react'
import { ObservationScrollPanel } from './ObservationScrollPanel'
import { GearSix } from '@phosphor-icons/react'

export function ObservationReplaySettings({ children }: { children: ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null), trigger = useRef<HTMLElement>(null)
  const close = (focus = false) => {
    if (details.current) details.current.open = false
    if (focus) trigger.current?.focus({ preventScroll: true })
  }
  useEffect(() => {
    const outside = (event: Event) => {
      if (details.current?.open && !details.current.contains(event.target as Node)) close()
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])
  return <details className="oc-player-settings" ref={details} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) }
  }}>
    <summary ref={trigger} aria-label="리플레이 설정"><GearSix size={22} aria-hidden="true" /></summary>
    <div className="oc-player-settings-panel" aria-label="리플레이 옵션" onClick={event => {
      if ((event.target as Element).closest('.oc-player-file-actions button')) close(true)
    }}><ObservationScrollPanel className="oc-player-settings-scroll" role="region" label="리플레이 옵션 내용">{children}</ObservationScrollPanel></div>
  </details>
}
