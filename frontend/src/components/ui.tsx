import type { ReactNode } from 'react'
import { STATE_LABEL, type PostureState } from '../data/posture'

export function Card({
  title,
  note,
  action,
  children,
  className = '',
}: {
  title?: string
  note?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`card ${className}`}>
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

export function Stat({
  label,
  value,
  sub,
  hint,
  tone,
}: {
  label: string
  value: string
  sub?: string
  hint?: string
  tone?: 'good' | 'bad' | 'muted'
}) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'bad' ? 'var(--bad)' : undefined
  return (
    <div className="card">
      <div className="stat-label">
        {label}
        {hint && <span title={hint} className="muted">ⓘ</span>}
      </div>
      <div className="stat-value" style={{ color }}>
        {value}
      </div>
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

export function Ring({
  value,
  label,
  size = 108,
}: {
  value: number | null
  label: string
  size?: number
}) {
  const r = 44
  const c = 2 * Math.PI * r
  const v = value ?? 0
  const color = v >= 0.8 ? 'var(--good)' : v >= 0.6 ? 'var(--warn)' : 'var(--bad)'
  return (
    <div style={{ display: 'grid', placeItems: 'center', gap: 6 }}>
      <svg width={size} height={size} viewBox="0 0 110 110">
        <circle cx="55" cy="55" r={r} fill="none" stroke="var(--panel-3)" strokeWidth="9" />
        {value !== null && (
          <circle
            cx="55"
            cy="55"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={`${c * v} ${c}`}
            transform="rotate(-90 55 55)"
            style={{ transition: 'stroke-dasharray 0.3s' }}
          />
        )}
        <text
          x="55"
          y="52"
          textAnchor="middle"
          fill="var(--text)"
          fontSize={value === null ? 12 : 21}
          fontWeight="680"
        >
          {value === null ? '계산 불가' : `${Math.round(v * 100)}%`}
        </text>
        <text x="55" y="68" textAnchor="middle" fill="var(--muted)" fontSize="9.5">
          {label}
        </text>
      </svg>
    </div>
  )
}

export type Bar = { label: string; sub?: string; value: number }

/**
 * 막대 + 보조 꺾은선 조합 차트. 대시보드의 일별 비교에 쓴다.
 */
export function ComboChart({
  bars,
  line,
  barUnit,
  lineUnit,
  barColor = 'var(--accent)',
  lineColor = 'var(--good)',
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
  const H = 172
  const base = 126
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
            stroke="var(--line-soft)"
            strokeWidth="1"
          />
        ))}
        {bars.map((b, i) => {
          const h = (b.value / barMax) * (base - top)
          return (
            <g key={b.label + i}>
              <rect
                x={x(i) - 11}
                y={base - h}
                width="22"
                height={Math.max(h, 1.5)}
                rx="3"
                fill={barColor}
                opacity="0.82"
              >
                <title>{`${b.label} · ${b.value.toFixed(1)}${barUnit}`}</title>
              </rect>
              <text x={x(i)} y={base + 15} textAnchor="middle" fill="var(--muted)" fontSize="10">
                {b.label}
              </text>
              {b.sub && (
                <text
                  x={x(i)}
                  y={base + 28}
                  textAnchor="middle"
                  fill="var(--muted)"
                  fontSize="9.5"
                  opacity="0.75"
                >
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
              strokeWidth="2"
              strokeLinejoin="round"
            />
            {line.map((v, i) => (
              <circle
                key={i}
                cx={x(i)}
                cy={base - (v / lineMax) * (base - top)}
                r="2.6"
                fill={lineColor}
                stroke="var(--panel)"
                strokeWidth="1.2"
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
      <span>▲</span>
      <span>{children}</span>
    </div>
  )
}
