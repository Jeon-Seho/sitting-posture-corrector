import type { ReactNode } from 'react'

/** Circular progress used for the posture score, keep rate and calibration countdown. */
export function Ring({
  value,
  size = 132,
  stroke = 12,
  color,
  children,
  label,
}: {
  /** 0–1; null draws only the track. */
  value: number | null
  size?: number
  stroke?: number
  color?: string
  children?: ReactNode
  label?: string
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = value === null ? 0 : Math.max(0, Math.min(1, value))
  return (
    <div className="ring" style={{ width: size, height: size }} role={label ? 'img' : undefined} aria-label={label}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        {value !== null && (
          <circle
            className="ring-bar"
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={stroke}
            strokeDasharray={c}
            strokeDashoffset={c * (1 - v)}
            style={color ? { stroke: color } : undefined}
          />
        )}
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  )
}
