import { useLayoutEffect, useRef, type RefObject } from 'react'

/** Animate only control-set changes, never the per-frame camera or timer updates. */
export function useObservationMotion(ref: RefObject<HTMLElement>, state: string) {
  const previous = useRef<{ width: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const next = element.getBoundingClientRect()
    const before = previous.current
    previous.current = { width: next.width, height: next.height }
    if (!before || typeof element.animate !== 'function' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    if (Math.abs(before.height - next.height) < .5) return
    const animation = element.animate([{ height: `${before.height}px` }, { height: `${next.height}px` }], { duration: 200, easing: 'cubic-bezier(.2,.7,.2,1)' })
    return () => animation.cancel()
  }, [ref, state])
}
