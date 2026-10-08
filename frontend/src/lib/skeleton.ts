import type { Landmark } from '../../../model/prototype/pose'

/** Display only. Never feed interpolated points into inference, calibration or CSV. */
export function smoothPoints(previous: Landmark[], target: Landmark[], dtMs: number): Landmark[] {
  const alpha = 1 - Math.exp(-Math.max(0, dtMs) / 45)
  return target.map((point, i) => {
    const old = previous[i]
    if (!old || (old.visibility ?? 0) < 0.65 || (point.visibility ?? 0) < 0.65) return { ...point }
    return { ...point, x: old.x + (point.x - old.x) * alpha,
      y: old.y + (point.y - old.y) * alpha, z: old.z + (point.z - old.z) * alpha }
  })
}

export function inferenceInterval(delegate: 'GPU' | 'CPU', inferenceMs: number) {
  // Leave time for rendering and input, especially on CPU fallback.
  return Math.max(delegate === 'GPU' ? 1000 / 30 : 1000 / 20, inferenceMs * 2)
}
