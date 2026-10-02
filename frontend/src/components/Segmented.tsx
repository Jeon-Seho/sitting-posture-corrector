import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

type Thumb = { x: number; y: number; w: number; h: number }

/**
 * Measures the selected child (aria-pressed / aria-current) so a highlight can slide
 * to it instead of jumping. Without layout (tests, SSR) the highlight is simply absent
 * and the selected item keeps its own static style.
 */
export function useSlidingThumb<T extends HTMLElement>(selector: string) {
  const ref = useRef<T>(null)
  const [thumb, setThumb] = useState<Thumb | null>(null)
  useLayoutEffect(() => {
    const host = ref.current
    if (!host || typeof host.querySelector !== 'function') return
    const update = () => {
      const active = host.querySelector<HTMLElement>(selector)
      const next = active
        ? { x: active.offsetLeft, y: active.offsetTop, w: active.offsetWidth, h: active.offsetHeight }
        : null
      setThumb((old) =>
        old && next && old.x === next.x && old.y === next.y && old.w === next.w && old.h === next.h
          ? old
          : next,
      )
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  })
  return { ref, thumb }
}

export function ThumbLayer({ thumb, className }: { thumb: Thumb | null; className: string }) {
  if (!thumb) return null
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{ width: thumb.w, height: thumb.h, transform: `translate(${thumb.x}px, ${thumb.y}px)` }}
    />
  )
}

/** Segmented control with a sliding selection pill. Children are the option buttons. */
export function Segmented({ label, children }: { label: string; children: ReactNode }) {
  const { ref, thumb } = useSlidingThumb<HTMLDivElement>('button[aria-pressed="true"]')
  return (
    <div ref={ref} className={`segmented ${thumb ? 'has-thumb' : ''}`} role="group" aria-label={label}>
      <ThumbLayer thumb={thumb} className="segmented-thumb" />
      {children}
    </div>
  )
}
