import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'

/** `value: null` draws no bar (e.g. a day without measurement). */
export type Bar = { label: string; sub?: string; value: number | null }
export type ChartDetail = { label: string; value: string }

type Props = {
  bars: Bar[]
  /** `null` leaves a gap (e.g. a day without measurement) instead of drawing 0. */
  line?: (number | null)[]
  barUnit: string
  lineUnit?: string
  barColor?: string
  lineColor?: string
  /** Series names shown in the hover card. */
  barName?: string
  lineName?: string
  formatBar?: (value: number) => string
  formatLine?: (value: number) => string
  /** Fixed top of the line axis (1 for a 0–100% rate); by default 1.25 × the largest value. */
  /** Fixed top of the bar axis (1 for a 0–100% rate); by default the largest value. */
  barMax?: number
  lineMax?: number
  /** Extra lines for the hover card of one column (e.g. sessions, alerts). */
  details?: (index: number) => ChartDetail[]
}

/** Drawn in real pixels at the measured width, so text never scales with the window. */
const H = 200
const BASE = 150
const TOP = 18
const MIN_STEP = 34
/** The highest point sits at 80% of the plot instead of pinning the top edge (2026-10-14). */
const LINE_HEADROOM = 1.25

/**
 * Bars + optional line. Hovering (or focusing and using ←/→) highlights one day and
 * shows a card with that day's values; the card glides between days.
 */
export function ComboChart({
  bars,
  line,
  barUnit,
  lineUnit,
  barColor = 'var(--primary-soft)',
  lineColor = 'var(--primary)',
  barName = '막대',
  lineName = '선',
  formatBar = (v) => `${v.toFixed(1)}${barUnit}`,
  formatLine = (v) => (lineUnit === '%' ? `${(v * 100).toFixed(1)}%` : `${v.toFixed(1)}${lineUnit ?? ''}`),
  details,
  lineMax: fixedLineMax,
  barMax: fixedBarMax,
}: Props) {
  const n = bars.length
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(n * 46)
  useLayoutEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = () => setWidth(Math.max(n * MIN_STEP, Math.round(el.clientWidth)))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [n])
  const W = width
  const STEP = W / n
  const barW = Math.min(30, STEP * 0.55)
  const barMax = fixedBarMax ?? Math.max(...bars.map((b) => b.value ?? 0), 1)
  const lineMax =
    fixedLineMax ?? (line ? Math.max(...line.filter((v): v is number => v !== null), 0.001) * LINE_HEADROOM : 1)
  const x = (i: number) => i * STEP + STEP / 2
  const lineY = (v: number) => BASE - (v / lineMax) * (BASE - TOP)
  const [active, setActive] = useState<number | null>(null)
  const [tipVisible, setTipVisible] = useState(false)
  const keyboard = useRef(false)
  useEffect(() => {
    setTipVisible(active !== null && keyboard.current)
    if (active === null || keyboard.current) return
    const timer = setTimeout(() => setTipVisible(true), 500)
    return () => clearTimeout(timer)
  }, [active])
  const lastActive = useRef(0)
  useLayoutEffect(() => {
    if (active !== null) lastActive.current = active
  }, [active])

  function pick(event: PointerEvent<HTMLDivElement>) {
    keyboard.current = false
    const rect = box.current?.getBoundingClientRect()
    if (!rect || !rect.width) return
    const i = Math.floor(((event.clientX - rect.left) / rect.width) * n)
    setActive(Math.max(0, Math.min(n - 1, i)))
  }

  // A hover from a longer period (30 → 7 days) must not point past the last column.
  useLayoutEffect(() => setActive(null), [n])
  // Fade out where the pointer left; resetting to column zero flashes a band on the left.
  const shown = Math.min(active ?? lastActive.current, Math.max(0, n - 1))
  const left = (x(shown) / W) * 100
  return (
    <div
      ref={box}
      className={`combo ${active !== null ? 'is-hovering' : ''} ${tipVisible && active !== null ? 'is-tip-visible' : ''}`}
      tabIndex={0}
      role="group"
      aria-label={`${barName}${line ? `·${lineName}` : ''} 차트. 방향키로 날짜를 이동합니다.`}
      onPointerMove={pick}
      onPointerLeave={() => setActive(null)}
      onBlur={() => setActive(null)}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        keyboard.current = true
        setTipVisible(true)
        setActive((old) => Math.max(0, Math.min(n - 1, (old ?? (event.key === 'ArrowLeft' ? n : -1)) + (event.key === 'ArrowLeft' ? -1 : 1))))
      }}
    >
      <svg className="chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {[0.5, 1].map((g) => (
          <line key={g} x1="0" x2={W} y1={BASE - g * (BASE - TOP)} y2={BASE - g * (BASE - TOP)} stroke="var(--line)" strokeWidth="1" />
        ))}
        <rect
          className="combo-band"
          x={x(shown) - STEP / 2 + 2}
          y={TOP - 8}
          width={STEP - 4}
          height={BASE - TOP + 8}
          rx="8"
        />
        {bars.map((b, i) => {
          if (b.value === null) return null
          const h = (b.value / barMax) * (BASE - TOP)
          return (
            <rect
              key={b.label + i}
              className={`combo-bar ${active === i ? 'is-active' : ''}`}
              x={x(i) - barW / 2}
              y={BASE - h}
              width={barW}
              height={Math.max(h, 1.5)}
              rx="5"
              fill={barColor}
            />
          )
        })}
        <line x1="0" x2={W} y1={BASE} y2={BASE} stroke="var(--line-strong)" strokeWidth="1.5" />
        {line && (
          <>
            {segments(line).map((points) => (
              <polyline
                key={points[0]}
                points={points.map((i) => `${x(i)},${lineY(line[i]!)}`).join(' ')}
                fill="none"
                stroke={lineColor}
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
            ))}
            {line.map((v, i) => v !== null && (
              <circle
                key={i}
                className={`combo-dot ${active === i ? 'is-active' : ''}`}
                cx={x(i)}
                cy={lineY(v)}
                r="3.6"
                fill={lineColor}
                stroke="var(--surface)"
                strokeWidth="1.5"
              />
            ))}
          </>
        )}
        {bars.map((b, i) => (
          <g key={`label-${i}`} className={`combo-label ${active === i ? 'is-active' : ''}`}>
            <text x={x(i)} y={BASE + 20} textAnchor="middle" fontSize="12" fontWeight="600">
              {b.label}
            </text>
            {b.sub && (
              <text x={x(i)} y={BASE + 36} textAnchor="middle" fontSize="11">
                {b.sub}
              </text>
            )}
          </g>
        ))}
      </svg>

      <div
        className="combo-tip"
        aria-hidden={!tipVisible || active === null}
        role="status"
        aria-live="polite"
        // Beside the hovered column, never over it (2026-10-13): right of it in the left half,
        // left of it in the right half, half a column plus a small gap away.
        style={{
          left: `${left}%`,
          transform:
            left < 50 ? `translateX(${STEP / 2 + 10}px)` : `translateX(calc(-100% - ${STEP / 2 + 10}px))`,
        }}
      >
        {active !== null && (
          <>
            <div className="combo-tip-title">
              {bars[shown].label}
              {bars[shown].sub && <span> ({bars[shown].sub})</span>}
            </div>
            <div className="combo-tip-row">
              <i style={{ background: barColor }} />
              {barName}
              <b>{bars[shown].value === null ? '—' : formatBar(bars[shown].value!)}</b>
            </div>
            {line && (
              <div className="combo-tip-row">
                <i style={{ background: lineColor }} />
                {lineName}
                <b>{line[shown] === null ? '—' : formatLine(line[shown]!)}</b>
              </div>
            )}
            {details?.(shown).map((d) => (
              <div className="combo-tip-row is-detail" key={d.label}>
                {d.label}
                <b>{d.value}</b>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

/** Runs of consecutive non-null indexes; a gap splits the line. */
function segments(line: (number | null)[]) {
  const runs: number[][] = []
  line.forEach((v, i) => {
    if (v === null) return
    const last = runs.at(-1)
    if (last && last.at(-1) === i - 1) last.push(i)
    else runs.push([i])
  })
  return runs
}
