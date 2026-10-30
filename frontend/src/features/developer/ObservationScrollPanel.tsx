import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'

/** Keeps the native scroll interaction while exposing content beyond each edge. */
type Props = { id?: string; labelledBy?: string; label?: string; visible?: boolean; className?: string; role?: 'tabpanel' | 'region'; children: ReactNode }
export function ObservationScrollPanel({ id: suppliedId, labelledBy, label, visible = true, className = 'oc-scroll-panel', role = 'tabpanel', children }: Props) {
  const generatedId = useId(), id = suppliedId ?? generatedId
  const viewport = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ above: false, below: false })
  const measure = useCallback(() => {
    const node = viewport.current
    if (!node) return
    const overflow = node.clientHeight > 0 && node.scrollHeight - node.clientHeight > 1
    const above = overflow && node.scrollTop > 1
    const below = overflow && node.scrollHeight - node.clientHeight - node.scrollTop > 1
    setEdges(previous => previous.above === above && previous.below === below ? previous : { above, below })
  }, [])
  useEffect(() => {
    if (!visible || !viewport.current) return
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(viewport.current)
    if (content.current) observer.observe(content.current)
    return () => observer.disconnect()
  }, [visible, measure])
  function move(direction: number) {
    const node = viewport.current
    if (node) {
      node.focus({ preventScroll: true })
      node.scrollBy({ top: direction * node.clientHeight * .7, behavior: 'auto' })
    }
  }
  return <div className={className} hidden={!visible} data-overflow={edges.above || edges.below}>
    <div className="oc-panel-scroll" id={id} role={role} aria-labelledby={labelledBy} aria-label={label} tabIndex={0} hidden={!visible} ref={viewport} onScroll={measure}>
      <div className="oc-scroll-content" ref={content}>{children}</div>
    </div>
    {visible && edges.above && <button className="oc-scroll-hint oc-scroll-hint-up" aria-label="위쪽 정보 더 보기" aria-controls={id} onClick={() => move(-1)}><span aria-hidden="true" /></button>}
    {visible && edges.below && <button className="oc-scroll-hint oc-scroll-hint-down" aria-label="아래쪽 정보 더 보기" aria-controls={id} onClick={() => move(1)}><span aria-hidden="true" /></button>}
  </div>
}
