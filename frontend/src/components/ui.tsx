import type { ReactNode } from 'react'
import { Info } from '@phosphor-icons/react'
import { STATE_LABEL, type PostureState } from '../data/posture'

export function Card({
  title,
  note,
  action,
  children,
  dark = false,
  className = '',
}: {
  title?: string
  note?: string
  action?: ReactNode
  children: ReactNode
  dark?: boolean
  className?: string
}) {
  return (
    <section className={`card ${dark ? 'dark' : ''} ${className}`}>
      {(title || action) && (
        <div className="card-head">
          <div>
            {title && <h3 className="card-title">{title}</h3>}
            {note && <p className="card-note">{note}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Ledger({ cols, children }: { cols: 3 | 4; children: ReactNode }) {
  return <div className={`ledger g${cols}`}>{children}</div>
}

export function Stat({
  label,
  value,
  sub,
  hint,
  tone,
  small = false,
}: {
  label: string
  value: string
  sub?: string
  hint?: string
  tone?: 'good' | 'bad'
  small?: boolean
}) {
  return (
    <div className="stat">
      <div className="stat-label">
        {label}
        {hint && (
          <span title={hint} className="muted">
            <Info size={14} weight="bold" className="icon" />
          </span>
        )}
      </div>
      <div className={`stat-value ${small ? 'sm' : ''} ${tone ?? ''}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

export function StateBadge({ state, detail }: { state: PostureState; detail?: string | null }) {
  return (
    <span className={`badge ${state}`}>
      <i className="pip" />
      {STATE_LABEL[state]}
      {detail ? ` · ${detail}` : ''}
    </span>
  )
}

export function Meter({ value, color }: { value: number; color?: string }) {
  return (
    <div className="meter">
      <span
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }}
      />
    </div>
  )
}

export function FeatureRow({
  name,
  value,
  unit,
  ratio,
  color,
}: {
  name: string
  value: number
  unit: string
  ratio: number
  color: string
}) {
  return (
    <div className="feature-row">
      <span className="feature-name">{name}</span>
      <Meter value={ratio} color={color} />
      <span className="feature-value">
        {value.toFixed(1)}
        {unit}
      </span>
    </div>
  )
}

export function Rate({ value, label }: { value: number | null; label: string }) {
  const tone = value === null ? 'empty' : value >= 0.8 ? 'good' : value >= 0.6 ? 'warn' : 'bad'
  return (
    <div className="rate">
      <span className="rate-label">{label}</span>
      <span className={`figure ${tone}`}>
        {value === null ? '계산 불가' : `${Math.round(value * 100)}%`}
      </span>
      <Meter value={value ?? 0} color={`var(--${tone === 'empty' ? 'unknown' : tone}-fill)`} />
    </div>
  )
}

export type Bar = { label: string; sub?: string; value: number }

export function ComboChart({
  bars,
  line,
  barUnit,
  lineUnit,
  barColor = 'var(--ink)',
  lineColor = 'var(--accent)',
}: {
  bars: Bar[]
  line?: number[]
  barUnit: string
  lineUnit?: string
  barColor?: string
  lineColor?: string
}) {
  const n = bars.length
  const step = 46
  const W = n * step
  const H = 176
  const base = 128
  const top = 16
  const barMax = Math.max(...bars.map((b) => b.value), 1)
  const lineMax = line ? Math.max(...line, 0.001) : 1

  const x = (i: number) => i * step + step / 2

  return (
    <div className="scroll-x">
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} style={{ minWidth: n * 34 }}>
        {[0, 0.5, 1].map((g) => (
          <line
            key={g}
            x1="0"
            x2={W}
            y1={base - g * (base - top)}
            y2={base - g * (base - top)}
            stroke={g === 0 ? 'var(--ink)' : 'var(--rule)'}
            strokeWidth={g === 0 ? 1.5 : 1}
          />
        ))}
        {bars.map((b, i) => {
          const h = (b.value / barMax) * (base - top)
          return (
            <g key={b.label + i}>
              <rect x={x(i) - 12} y={base - h} width="24" height={Math.max(h, 1.5)} fill={barColor}>
                <title>{`${b.label} · ${b.value.toFixed(1)}${barUnit}`}</title>
              </rect>
              <text
                x={x(i)}
                y={base + 17}
                textAnchor="middle"
                fill="var(--ink-2)"
                fontSize="11"
                fontWeight="600"
              >
                {b.label}
              </text>
              {b.sub && (
                <text x={x(i)} y={base + 31} textAnchor="middle" fill="var(--muted)" fontSize="10">
                  {b.sub}
                </text>
              )}
            </g>
          )
        })}
        {line && (
          <>
            <polyline
              points={line
                .map((v, i) => `${x(i)},${base - (v / lineMax) * (base - top)}`)
                .join(' ')}
              fill="none"
              stroke={lineColor}
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            {line.map((v, i) => (
              <circle
                key={i}
                cx={x(i)}
                cy={base - (v / lineMax) * (base - top)}
                r="3.4"
                fill={lineColor}
                stroke="var(--paper-2)"
                strokeWidth="1.5"
              >
                <title>{`${bars[i]?.label ?? ''} · ${(v * (lineUnit === '%' ? 100 : 1)).toFixed(
                  1,
                )}${lineUnit ?? ''}`}</title>
              </circle>
            ))}
          </>
        )}
      </svg>
    </div>
  )
}

export function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.label}>
          <i style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      className="switch"
      aria-pressed={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    />
  )
}

export function DemoNote({ children }: { children: ReactNode }) {
  return (
    <div className="demo-note">
      <Info size={18} weight="bold" className="icon" />
      <span>{children}</span>
    </div>
  )
}

export function Rings({ count = 4 }: { count?: number }) {
  return (
    <div className="rings" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  )
}
