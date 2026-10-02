/** Splits a duration into a big and a small part so it fits inside a circle: 13분 / 51초. */
function circleParts(seconds: number | null): [string, string] {
  if (seconds === null) return ['—', '']
  const s = Math.round(seconds)
  if (s < 60) return [`${s}초`, '']
  const m = Math.floor(s / 60)
  if (m < 60) return [`${m}분`, s % 60 ? `${s % 60}초` : '']
  return [`${Math.floor(m / 60)}시간`, m % 60 ? `${m % 60}분` : '']
}

function Bubble({
  kind,
  label,
  seconds,
}: {
  kind: 'mean' | 'median'
  label: string
  seconds: number | null
}) {
  const [big, small] = circleParts(seconds)
  return (
    <div className={`sample-bubble is-${kind}`}>
      <span className="sample-circle">
        <b>{big}</b>
        {small && <small>{small}</small>}
      </span>
      <span className="sample-label">{label}</span>
    </div>
  )
}

/** Mean and median as two coloured circles, with the sample count spelled out. */
export function SampleRow({
  name,
  mean,
  median,
  count,
}: {
  name: string
  mean: number | null
  median: number | null
  count: number
}) {
  return (
    <div className="sample-row">
      <span className="feature-name">{name}</span>
      <div className="sample-values">
        <Bubble kind="mean" label="평균" seconds={mean} />
        <Bubble kind="median" label="중앙값" seconds={median} />
        <span className="sample-count">
          총 <b>{count}</b>회
        </span>
      </div>
    </div>
  )
}
