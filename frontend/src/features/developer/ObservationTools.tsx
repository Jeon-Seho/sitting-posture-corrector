import { useId, useRef, useState, type ReactNode, type KeyboardEvent, type CSSProperties } from 'react'
import { ChartLine, ClockCounterClockwise, Table } from '@phosphor-icons/react'
import { useObservationTabMotion } from './useObservationTabMotion'
import { ObservationScrollPanel } from './ObservationScrollPanel'
import type { ObservationPanel } from './ObservationPreviewContext'

const definitions = [
  { id: 'metrics', label: '수치·그래프', icon: ChartLine },
  { id: 'replay', label: '리플레이', icon: ClockCounterClockwise },
  { id: 'table', label: '비교표', icon: Table },
] as const
export function ObservationTools({ metrics, table, replay, onPanelChange }: { metrics: ReactNode; table: ReactNode; replay?: (visible: boolean) => ReactNode; onPanelChange?: (panel: ObservationPanel) => void }) {
  const labels = replay ? definitions : definitions.filter(item => item.id !== 'replay')
  const id = useId()
  const [active, setActive] = useState(0)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const selected = Math.min(active, labels.length - 1)
  const { surface, animateSelection } = useObservationTabMotion()
  function select(index: number) {
    if (index === selected) return
    animateSelection(); setActive(index); onPanelChange?.(labels[index].id)
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? labels.length - 1 : event.key === 'ArrowRight' ? (index + 1) % labels.length : event.key === 'ArrowLeft' ? (index + labels.length - 1) % labels.length : null
    if (next === null) return
    event.preventDefault(); select(next); tabs.current[next]?.focus()
  }
  return <section className="oc-tools" aria-label="관측 도구">
    <div id={`${id}-body`} className="oc-tools-body">
      <div className="oc-tools-tabs" style={{ '--oc-active-tab': selected, '--oc-tab-count': labels.length } as CSSProperties} role="tablist" aria-label="관측 도구 종류"><span className="oc-tab-indicator" aria-hidden="true"><span className="oc-tab-surface" ref={surface} /></span>{labels.map(({ label, icon: Icon }, index) => <button key={label} ref={element => { tabs.current[index] = element }} data-index={index} id={`${id}-tab-${index}`} role="tab" aria-selected={selected === index} aria-controls={`${id}-panel-${index}`} tabIndex={selected === index ? 0 : -1} onClick={() => select(index)} onKeyDown={event => navigate(event, index)}><Icon size={20} weight={selected === index ? 'fill' : 'regular'} aria-hidden="true" /><span>{label}</span></button>)}</div>
      {labels.map(({ id: panelId, label }, index) => {
        const panel = panelId === 'metrics' ? metrics : panelId === 'table' ? table : replay?.(selected === index)
        return <ObservationScrollPanel key={label} id={`${id}-panel-${index}`} labelledBy={`${id}-tab-${index}`} visible={selected === index}>{panel}</ObservationScrollPanel>
      })}
    </div>
  </section>
}
