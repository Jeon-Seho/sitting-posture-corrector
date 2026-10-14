import { useEffect, useRef, useState } from 'react'

/** One line of a hover card: label, value, and an optional colour swatch. */
export type TipRow = [label: string, value: string, color?: string]

/**
 * Props for an element that shows a hover card: a bold title and optional label–value rows,
 * the same card as the chart's (ComboChart). Use instead of a native `title`.
 */
export function tip(title: string, rows: TipRow[] = []) {
  return {
    'data-tip': title,
    'data-tip-rows': rows.length ? JSON.stringify(rows) : undefined,
  }
}

type Shown = { title: string; rows: TipRow[]; x: number; y: number; below: boolean }

/**
 * App-styled hover cards (2026-10-14). A native `title` opens the operating system's black
 * tooltip, so elements carry `data-tip` (see `tip()`) and this one layer, mounted once at
 * the root, shows the card above the element (below it near the top edge). Keyboard focus
 * shows it too; screen readers keep using aria-label.
 */
export function TipLayer() {
  const [shown, setShown] = useState<Shown | null>(null)
  const current = useRef<Element | null>(null)

  useEffect(() => {
    const show = (event: Event) => {
      const target = (event.target as Element | null)?.closest?.('[data-tip]')
      if (!target || target === current.current) return
      const title = target.getAttribute('data-tip')
      if (!title) return
      let rows: TipRow[] = []
      try {
        rows = JSON.parse(target.getAttribute('data-tip-rows') ?? '[]') as TipRow[]
      } catch {
        rows = []
      }
      current.current = target
      const box = target.getBoundingClientRect()
      const below = box.top < 120
      setShown({ title, rows, x: box.left + box.width / 2, y: below ? box.bottom + 10 : box.top - 10, below })
    }
    const hide = (event: Event) => {
      const target = (event.target as Element | null)?.closest?.('[data-tip]')
      const next = (event as PointerEvent | FocusEvent).relatedTarget as Element | null
      if (target && next && target.contains(next)) return
      current.current = null
      setShown(null)
    }
    const clear = () => {
      current.current = null
      setShown(null)
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

  if (!shown) return null
  return (
    <div
      className={`app-tip ${shown.below ? 'is-below' : ''} ${shown.rows.length ? '' : 'is-plain'}`}
      role="tooltip"
      style={{ left: Math.max(110, Math.min(shown.x, window.innerWidth - 110)), top: shown.y }}
    >
      <div className="combo-tip-title">{shown.title}</div>
      {shown.rows.map(([label, value, color]) => (
        <div className={`combo-tip-row ${!color && shown.rows.some((r) => r[2]) ? 'is-detail' : ''}`} key={label}>
          {color && <i style={{ background: color }} />}
          {label}
          <b>{value}</b>
        </div>
      ))}
    </div>
  )
}
