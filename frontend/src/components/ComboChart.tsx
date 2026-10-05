import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react'

export type Bar = { label: string; sub?: string; value: number }
export type ChartDetail = { label: string; value: string }

type Props = {
  bars: Bar[]
  line?: number[]
  barUnit: string
  lineUnit?: string
  barColor?: string
  lineColor?: string
  /** Series names shown in the hover card. */
  barName?: string
  lineName?: string
  formatBar?: (value: number) => string
  formatLine?: (value: number) => string
  /** Extra lines for the hover card of one column (e.g. sessions, alerts). */
  details?: (index: number) => ChartDetail[]
}

/** Drawn in real pixels at the measured width, so text never scales with the window. */
const H = 200
const BASE = 150
const TOP = 18
const MIN_STEP = 34

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
  const barMax = Math.max(...bars.map((b) => b.value), 1)
  const lineMax = line ? Math.max(...line, 0.001) : 1
  const x = (i: number) => i * STEP + STEP / 2
  const lineY = (v: number) => BASE - (v / lineMax) * (BASE - TOP)
  const [active, setActive] = useState<number | null>(null)

  function pick(event: PointerEvent<HTMLDivElement>) {
    const rect = box.current?.getBoundingClientRect()
    if (!rect || !rect.width) return
    const i = Math.floor(((event.clientX - rect.left) / rect.width) * n)
    setActive(Math.max(0, Math.min(n - 1, i)))
  }

  const shown = active ?? 0
  const left = (x(shown) / W) * 100
  return (
    <div
      ref={box}
      className={`combo ${active !== null ? 'is-hovering' : ''}`}
      tabIndex={0}
      role="group"
      aria-label={`${barName}${line ? `·${lineName}` : ''} 차트. 방향키로 날짜를 이동합니다.`}
      onPointerMove={pick}
      onPointerLeave={() => setActive(null)}
      onBlur={() => setActive(null)}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
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
            <polyline
              points={line.map((v, i) => `${x(i)},${lineY(v)}`).join(' ')}
              fill="none"
              stroke={lineColor}
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            {line.map((v, i) => (
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
        role="status"
        aria-live="polite"
        style={{ left: `${left}%`, transform: `translateX(${left > 70 ? '-100%' : left < 30 ? '0%' : '-50%'})` }}
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
              <b>{formatBar(bars[shown].value)}</b>
            </div>
            {line && (
              <div className="combo-tip-row">
                <i style={{ background: lineColor }} />
                {lineName}
                <b>{formatLine(line[shown])}</b>
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
