/**
 * Frame geometry for the app (2026-10-22). The app does not judge posture (ADR 0021·0025):
 * `features` only tells whether a frame is measurable (nose and both shoulders tracked, both
 * ears present) and gives the shoulder-relative values the collection screen still uses (F5).
 * The local rules (head turn, score, classify) were removed on 2026-10-22; they stay on develop.
 */
export interface Landmark {
  x: number
  y: number
  z: number
  visibility?: number
}
export interface Features {
  headGap: number
  /** Head centre (ear midpoint, or the nose without ears) sideways from the shoulder centre. */
  offset: number
  tilt: number
  quality: number
}

export function features(points: Landmark[], width: number, height: number): Features | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const required = [points[0], points[11], points[12]]
  if (
    required.some(
      (p) =>
        !p ||
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        !Number.isFinite(p.visibility) ||
        p.visibility! < 0.65 ||
        p.visibility! > 1 ||
        p.x < 0.02 ||
        p.x > 0.98 ||
        p.y < 0.02 ||
        p.y > 0.98,
    )
  )
    return null
  const [nose, left, right] = required
  const span = Math.hypot((left.x - right.x) * width, (left.y - right.y) * height)
  if (span < width * 0.1) return null
  const cx = (left.x + right.x) / 2,
    cy = (left.y + right.y) / 2
  // Sideways offset is measured from the ear midpoint. Ear positions are estimated even when
  // hidden, so there is no visibility gate, but both ears are required (BE reply, 2026-10-12).
  const ears = [points[7], points[8]]
  if (ears.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null
  const head = (ears[0].x + ears[1].x) / 2
  return {
    headGap: ((cy - nose.y) * height) / span,
    offset: ((head - cx) * width) / span,
    tilt: ((left.y - right.y) * height) / span,
    quality: Math.min(...required.map((p) => p.visibility!)),
  }
}

/** Both shoulders tracked well inside the frame (the same test `features` applies). */
export function shouldersVisible(points: Landmark[]): boolean {
  return [points[11], points[12]].every(
    (p) =>
      !!p &&
      Number.isFinite(p.x) &&
      Number.isFinite(p.y) &&
      Number.isFinite(p.visibility) &&
      p.visibility! >= 0.65 &&
      p.visibility! <= 1 &&
      p.x >= 0.02 &&
      p.x <= 0.98 &&
      p.y >= 0.02 &&
      p.y <= 0.98,
  )
}
