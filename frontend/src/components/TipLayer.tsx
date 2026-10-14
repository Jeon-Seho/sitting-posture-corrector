import { useEffect, useRef, useState } from 'react'

type Tip = { text: string; x: number; y: number; below: boolean }

/**
 * App-styled hover notes (2026-10-14). A native `title` opens the operating system's black
 * tooltip, which does not match the app, so elements carry `data-tip="…"` instead and this
 * one layer (mounted once at the root) shows the note above the element, or below it near
 * the top edge. Keyboard focus shows it too. Screen readers keep using aria-label.
 */
export function TipLayer() {
  const [tip, setTip] = useState<Tip | null>(null)
  const current = useRef<Element | null>(null)

  useEffect(() => {
    const show = (event: Event) => {
      const target = (event.target as Element | null)?.closest?.('[data-tip]')
      if (!target || target === current.current) return
      const text = target.getAttribute('data-tip')
      if (!text) return
      current.current = target
      const box = target.getBoundingClientRect()
      const below = box.top < 48
      setTip({ text, x: box.left + box.width / 2, y: below ? box.bottom + 8 : box.top - 8, below })
    }
    const hide = (event: Event) => {
      const target = (event.target as Element | null)?.closest?.('[data-tip]')
      const next = (event as PointerEvent | FocusEvent).relatedTarget as Element | null
      if (target && next && target.contains(next)) return
      current.current = null
      setTip(null)
    }
    const clear = () => {
      current.current = null
      setTip(null)
    }
    document.addEventListener('pointerover', show)
    document.addEventListener('pointerout', hide)
    document.addEventListener('focusin', show)
    document.addEventListener('focusout', hide)
    document.addEventListener('scroll', clear, true)
    document.addEventListener('pointerdown', clear)
    return () => {
      document.removeEventListener('pointerover', show)
      document.removeEventListener('pointerout', hide)
      document.removeEventListener('focusin', show)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('scroll', clear, true)
      document.removeEventListener('pointerdown', clear)
    }
  }, [])

  if (!tip) return null
  return (
    <div
      className={`tip ${tip.below ? 'is-below' : ''}`}
      role="tooltip"
      style={{ left: Math.max(140, Math.min(tip.x, window.innerWidth - 140)), top: tip.y }}
    >
      {tip.text}
    </div>
  )
}
