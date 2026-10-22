/**
 * Frame checks for the app (2026-10-22). The app does not judge posture (ADR 0021·0025) and
 * computes no posture values: it only tells whether a frame is measurable, so it can mark the
 * others `valid:false` and use measurable frames for the posture registration average.
 * The local rules and their head/shoulder values were removed on 2026-10-22; they stay on develop.
 */
export interface Landmark {
  x: number
  y: number
  z: number
  visibility?: number
}
/**
 * A measurable frame (BE api-spec 11.3): nose and both shoulders tracked (visibility 0.65..1)
 * inside 2% of the edges, shoulders at least 10% of the frame width apart, both ears present
 * (ear positions are estimated even when hidden, so they have no visibility gate).
 */
export function measurable(points: Landmark[], width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false
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
    return false
  const [, left, right] = required
  if (Math.hypot((left.x - right.x) * width, (left.y - right.y) * height) < width * 0.1) return false
  const ears = [points[7], points[8]]
  return ears.every((p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y))
}

/** Both shoulders tracked well inside the frame (the same test `measurable` applies). */
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
