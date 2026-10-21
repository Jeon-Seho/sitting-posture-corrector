import { useId, useRef, useState, type ReactNode, type KeyboardEvent } from 'react'
import { CaretDown, SlidersHorizontal } from '@phosphor-icons/react'

const labels = ['수치·그래프', '수동 동작', '비교표']

export function ObservationTools({ metrics, manual, table }: { metrics: ReactNode; manual: ReactNode; table: ReactNode }) {
  const id = useId()
  const [open, setOpen] = useState(false), [active, setActive] = useState(0)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : null
    if (next === null) return
    event.preventDefault()
    setActive(next)
    tabs.current[next]?.focus()
  }
  return <section className="oc-tools" aria-label="분석 도구">
    <button className="oc-tools-toggle" aria-label={`분석 도구 ${open ? '닫기' : '열기'}`} aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen(!open)}>
      <SlidersHorizontal size={18} aria-hidden="true" /><span>분석 도구</span><CaretDown size={14} aria-hidden="true" />
    </button>
    <div id={`${id}-body`} className="oc-tools-body" hidden={!open}>
      <div className="oc-tools-tabs" role="tablist" aria-label="분석 도구 종류">{labels.map((label, index) => <button key={label} ref={element => { tabs.current[index] = element }} data-index={index} id={`${id}-tab-${index}`} role="tab" aria-selected={active === index} aria-controls={`${id}-panel-${index}`} tabIndex={active === index ? 0 : -1} onClick={() => setActive(index)} onKeyDown={event => navigate(event, index)}>{label}</button>)}</div>
      {[metrics, manual, table].map((panel, index) => <div key={labels[index]} id={`${id}-panel-${index}`} role="tabpanel" aria-labelledby={`${id}-tab-${index}`} tabIndex={0} hidden={active !== index}>{panel}</div>)}
    </div>
  </section>
}
