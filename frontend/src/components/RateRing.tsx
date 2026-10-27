import { Ring } from './Ring'

/** Same bar as the demo table: at or above this keep rate reads as good. */
export const GOOD_RATE = 0.75

/** Keep rate as a ring with the percent in its hole. */
export function RateRing({ rate, size = 60 }: { rate: number | null; size?: number }) {
  const percent = rate === null ? null : Math.round(rate * 100)
  return (
    <Ring
      value={rate}
      size={size}
      stroke={Math.round(size / 7)}
      color={percent !== null && percent < GOOD_RATE * 100 ? 'var(--alert-soft)' : undefined}
      label={percent === null ? '측정한 시간 없음' : `바른 자세 ${percent}%`}
    >
      <span className="rate-ring-value num" style={{ fontSize: Math.round(size / 4) }}>
        {percent === null ? '—' : percent}
        {percent !== null && <small>%</small>}
      </span>
    </Ring>
  )
}
