import type { Landmark } from '../../../model/prototype/pose'
export { inferenceInterval } from '../features/mediapipe/tracking'

/** Display only. Never feed interpolated points into inference, calibration or CSV. */
export function smoothPoints(previous: Landmark[], target: Landmark[], dtMs: number): Landmark[] {
  const alpha = 1 - Math.exp(-Math.max(0, dtMs) / 45)
  return target.map((point, i) => {
    const old = previous[i]
    if (!old || (old.visibility ?? 0) < 0.65 || (point.visibility ?? 0) < 0.65) return { ...point }
    return {
      ...point,
      x: old.x + (point.x - old.x) * alpha,
      y: old.y + (point.y - old.y) * alpha,
      z: old.z + (point.z - old.z) * alpha,
    }
  })
}
