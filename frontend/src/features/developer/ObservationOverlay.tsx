import { useMemo } from 'react'
import type { ComparisonFrame } from '../../../../model/prototype/observationComparison'
import { useGuideDisplay } from './useGuideDisplay'

const edges = [[2, 5], [9, 10], [11, 12], [0, 11], [0, 12]] as const
const points = [0, 2, 5, 9, 10, 11, 12] as const

/** The display filter never changes the frame used by registration, metrics or replay. */
export function ObservationOverlay({ frame }: { frame: ComparisonFrame | null }) {
  const source = useMemo(() => frame ? {
    timeMs: frame.timeMs, width: frame.width, height: frame.height,
    points: frame.landmarks.map(point => ({ x: point.x, y: point.y, visibility: point.visibility ?? 0 })),
  } : null, [frame])
  const display = useGuideDisplay(source)
  if (!source || !display) return null
  const visible = (i: number) => {
    const raw = source.points[i], shown = display.points[i]
    return raw && shown && raw.visibility >= .5 && shown.visibility >= .5 &&
      [raw.x, raw.y, shown.x, shown.y].every(Number.isFinite)
  }
  return <svg viewBox={`0 0 ${source.width} ${source.height}`} aria-label="현재 Pose 관측점" className="oc-overlay">
    {edges.map(([a, b]) => visible(a) && visible(b) ? <line key={`${a}-${b}`} x1={display.points[a].x * source.width} y1={display.points[a].y * source.height} x2={display.points[b].x * source.width} y2={display.points[b].y * source.height} /> : null)}
    {points.map(i => visible(i) ? <circle key={i} cx={display.points[i].x * source.width} cy={display.points[i].y * source.height} r="4" /> : null)}
  </svg>
}
