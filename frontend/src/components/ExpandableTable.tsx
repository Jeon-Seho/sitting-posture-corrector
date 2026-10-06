import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { CaretDown } from '@phosphor-icons/react'

type Heights = { peek: number; full: number }

/**
 * Shows the first rows of a table and grows to its full height from a caret button,
 * instead of scrolling inside a small box. Short tables render as they are.
 * Without layout (tests) the table is simply shown in full.
 */
export function ExpandableTable({ peekRows = 3, children }: { peekRows?: number; children: ReactNode }) {
  const body = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [heights, setHeights] = useState<Heights | null>(null)
  useLayoutEffect(() => {
    const el = body.current
    if (!el || typeof el.querySelectorAll !== 'function') return
    const measure = () => {
      const rows = el.querySelectorAll('tbody tr')
      const full = el.scrollHeight
      const last = rows[Math.min(peekRows, rows.length) - 1] as HTMLElement | undefined
      // Row offsets may use an ancestor outside this panel. Measure in the
      // panel's coordinates so changing maxHeight cannot feed back into peek.
      const peek = last ? last.getBoundingClientRect().bottom - el.getBoundingClientRect().top + el.scrollTop : full
      setHeights((old) => (old && old.peek === peek && old.full === full ? old : { peek, full }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el.firstElementChild ?? el)
    return () => observer.disconnect()
  }, [children, peekRows])
  const collapsible = !!heights && heights.full > heights.peek + 4
  return (
    <div className={`expandable ${open ? 'is-open' : ''} ${collapsible ? 'is-collapsible' : ''}`}>
      <div
        ref={body}
        className="expandable-body"
        style={collapsible ? { maxHeight: open ? heights.full : heights.peek } : undefined}
      >
        {children}
      </div>
      {collapsible && (
        <button
          type="button"
          className="expandable-toggle"
          aria-expanded={open}
          onClick={() => setOpen((old) => !old)}
        >
          {open ? '접기' : '전체 보기'}
          <CaretDown size={14} weight="bold" className="icon" />
        </button>
      )}
    </div>
  )
}
