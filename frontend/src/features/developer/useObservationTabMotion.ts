import { useEffect, useRef } from 'react'

export function useObservationTabMotion() {
  const surface = useRef<HTMLSpanElement>(null), animation = useRef<Animation | null>(null)
  useEffect(() => {
    const preference = typeof window === 'undefined' ? null : window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const change = () => { if (preference?.matches) animation.current?.cancel() }
    preference?.addEventListener?.('change', change)
    return () => { preference?.removeEventListener?.('change', change); animation.current?.cancel() }
  }, [])
  function animateSelection() {
    const node = surface.current
    if (!node?.animate || typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const current = getComputedStyle(node).transform
    animation.current?.cancel()
    animation.current = node.animate([
      { transform: current === 'none' ? 'scale(1)' : current, offset: 0, easing: 'ease-in' },
      { transform: 'scale(1.08, .78)', offset: .14, easing: 'ease-out' },
      { transform: 'scale(1.04, 1.12)', offset: .72, easing: 'ease-in-out' },
      { transform: 'scale(.98, .98)', offset: .88, easing: 'ease-out' },
      { transform: 'scale(1)', offset: 1 },
    ], { duration: 420, easing: 'linear' })
  }
  return { surface, animateSelection }
}
