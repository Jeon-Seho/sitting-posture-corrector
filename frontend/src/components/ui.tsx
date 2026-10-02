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
      <span style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
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

export { ComboChart, type Bar } from './ComboChart'

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
  disabled = false,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className="switch"
      aria-pressed={checked}
      aria-label={label}
      disabled={disabled}
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
