import type { Landmark } from '../../../model/prototype/pose'
import { visiblePoint } from './poseVisual'

/** Head ellipse and shoulder arc in video pixels (same frame as the skeleton canvas). */
export type GuideShape = {
  width: number
  height: number
  head: { cx: number; cy: number; rx: number; ry: number }
  shoulders: string
  /** True when the shape follows the detected person rather than the default placement. */
  fitted: boolean
}

/** Default placement for a 4:3 frame, used until a face and both shoulders are visible. */
export function defaultGuide(width = 800, height = 600): GuideShape {
  const sx = width / 800,
    sy = height / 600
  return {
    width,
    height,
    head: { cx: 400 * sx, cy: 230 * sy, rx: 105 * sx, ry: 125 * sy },
    shoulders: `M${180 * sx} ${560 * sy} C${205 * sx} ${450 * sy} ${290 * sx} ${410 * sy} ${400 * sx} ${408 * sy} C${510 * sx} ${410 * sy} ${595 * sx} ${450 * sy} ${620 * sx} ${560 * sy}`,
    fitted: false,
  }
}

/**
 * Sizes the guide from the person's own shoulder span, so it fits at any camera distance.
 * Uses the nose and both shoulders (MediaPipe 0, 11, 12); returns null when they are not visible.
 */
export function fittedGuide(points: Landmark[], width: number, height: number): GuideShape | null {
  const [nose, left, right] = [points[0], points[11], points[12]]
  if (!visiblePoint(nose) || !visiblePoint(left) || !visiblePoint(right)) return null
  if (!(width > 0) || !(height > 0)) return null
  const lx = left.x * width,
    ly = left.y * height,
    rx = right.x * width,
    ry = right.y * height
  const span = Math.hypot(lx - rx, ly - ry)
  if (span < width * 0.05) return null
  const midX = (lx + rx) / 2,
    midY = (ly + ry) / 2
  // Head proportions relative to shoulder width; the nose sits slightly below the head center.
  const head = {
    cx: nose.x * width,
    cy: nose.y * height - span * 0.12,
    rx: span * 0.3,
    ry: span * 0.38,
  }
  // Arc a little outside each shoulder, rising to the neck line between them.
  const outer = span * 0.18,
    drop = span * 0.45,
    [a, b] = lx < rx ? [{ x: lx, y: ly }, { x: rx, y: ry }] : [{ x: rx, y: ry }, { x: lx, y: ly }]
  const shoulders =
    `M${a.x - outer} ${a.y + drop} C${a.x - outer * 0.6} ${a.y} ${a.x + span * 0.2} ${midY - span * 0.08} ` +
    `${midX} ${midY - span * 0.08} C${b.x - span * 0.2} ${midY - span * 0.08} ${b.x + outer * 0.6} ${b.y} ` +
    `${b.x + outer} ${b.y + drop}`
  return { width, height, head, shoulders, fitted: true }
}

/**
 * Exponential smoothing of the nose and shoulders so the guide follows without jitter.
 * A large jump (another person, re-seating) snaps to the new position.
 */
export function smoothPoints(previous: Landmark[] | null, next: Landmark[], amount = 0.35): Landmark[] {
  const keys = [0, 11, 12]
  if (!previous || keys.some((k) => !visiblePoint(previous[k]) || !visiblePoint(next[k]))) return next
  const jump = Math.hypot(previous[0].x - next[0].x, previous[0].y - next[0].y)
  if (jump > 0.2) return next
  const result = next.slice()
  for (const k of keys) {
    const a = previous[k],
      b = next[k]
    result[k] = { ...b, x: a.x + (b.x - a.x) * amount, y: a.y + (b.y - a.y) * amount }
  }
  return result
}
