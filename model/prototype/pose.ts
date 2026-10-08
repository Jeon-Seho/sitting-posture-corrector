/** Experimental rules only. Not a trained posture classifier or medical measurement. */
export type Status = 'normal' | 'deviation' | 'unmeasurable'
export type Deviation = 'forward_slouch' | 'left_lean' | 'right_lean'
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
  /**
   * Nose sideways from the ear midpoint: grows when the head turns, stays put when the whole
   * head leans. Absent in baselines saved before 2026-10-08, read as 0.
   */
  turn?: number
}
export interface Reading {
  status: Status
  deviation: Deviation | null
  score: number | null
}
export interface PosturePayload {
  schema_version: '1.0'
  timestamp_ms: number
  status: Status
  deviation_type: Deviation | null
  confidence: number | null
  measurement_quality: 'good' | 'poor'
  duration_ms: number
}

export const unavailable: Reading = { status: 'unmeasurable', deviation: null, score: null }

export function validFeatures(value: Features | null): value is Features {
  return (
    value !== null &&
    [value.headGap, value.offset, value.tilt, value.quality].every(Number.isFinite) &&
    (value.turn === undefined || Number.isFinite(value.turn)) &&
    value.quality >= 0.65 &&
    value.quality <= 1
  )
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
  // A head turn moves the nose a lot but the ear midpoint little, so sideways lean is
  // measured from the ears. Ear positions are estimated even when hidden; no visibility gate.
  const ears = [points[7], points[8]]
  const earX = ears.every((p) => p && Number.isFinite(p.x)) ? (ears[0].x + ears[1].x) / 2 : null
  const head = earX ?? nose.x
  return {
    headGap: ((cy - nose.y) * height) / span,
    offset: ((head - cx) * width) / span,
    tilt: ((left.y - right.y) * height) / span,
    quality: Math.min(...required.map((p) => p.visibility!)),
    turn: ((nose.x - head) * width) / span,
  }
}

/**
 * Where the calibrated upper body sits in the frame: shoulder midpoint and the area of the
 * nose/shoulder bounding box, all normalized to 0..1. Stored with a server baseline only.
 */
export function placement(points: Landmark[]): { x: number; y: number; area: number } | null {
  const required = [points[0], points[11], points[12]]
  if (required.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null
  const unit = (n: number) => Math.min(1, Math.max(0, n))
  const xs = required.map((p) => p.x),
    ys = required.map((p) => p.y)
  const [, left, right] = required
  return {
    x: unit((left.x + right.x) / 2),
    y: unit((left.y + right.y) / 2),
    area: unit((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))),
  }
}

export function average(samples: Features[]): Features {
  if (!samples.length || !samples.every(validFeatures))
    throw new Error('No valid calibration samples')
  return {
    headGap: samples.reduce((n, s) => n + s.headGap, 0) / samples.length,
    offset: samples.reduce((n, s) => n + s.offset, 0) / samples.length,
    tilt: samples.reduce((n, s) => n + s.tilt, 0) / samples.length,
    quality: samples.reduce((n, s) => n + s.quality, 0) / samples.length,
    turn: samples.reduce((n, s) => n + (s.turn ?? 0), 0) / samples.length,
  }
}

/** Shoulder tilt change treated as a full deviation (ADR 0019; was 0.13). */
export const SHOULDER_TILT_SCALE = 0.03

/**
 * Change in nose-to-ear-midpoint offset (shoulder widths) beyond which the head is turned
 * and the posture is left unjudged. Real captures (2026-10-08): postures changed it at most
 * 0.06, full head turns about 0.15 to 0.4, slight turns up to about 0.15. A slight turn is
 * still judged so that glancing aside does not eat measuring time.
 */
export const HEAD_TURN_LIMIT = 0.15

export function headTurned(current: Features | null, baseline: Features | null) {
  return (
    validFeatures(current) &&
    validFeatures(baseline) &&
    Math.abs((current.turn ?? 0) - (baseline.turn ?? 0)) > HEAD_TURN_LIMIT
  )
}

export function classify(current: Features | null, baseline: Features | null): Reading {
  if (!validFeatures(current) || !validFeatures(baseline) || headTurned(current, baseline))
    return unavailable
  const head = Math.abs(current.headGap - baseline.headGap) / 0.22
  const lean = (current.offset - baseline.offset) / 0.2
  const tilt = Math.abs(current.tilt - baseline.tilt) / SHOULDER_TILT_SCALE
  const amount = Math.max(head, Math.abs(lean), tilt)
  return {
    status: amount >= 1 ? 'deviation' : 'normal',
    deviation:
      amount < 1
        ? null
        : Math.abs(lean) > head && Math.abs(lean) > tilt
          ? lean > 0
            ? 'left_lean'
            : 'right_lean'
          : 'forward_slouch',
    // Contract score, not a calibrated probability. UI deliberately does not show it as accuracy.
    score: Math.min(1, Math.max(0, amount >= 1 ? amount / 2 : 1 - amount / 2)),
  }
}

export function payload(reading: Reading, elapsed: number, duration: number): PosturePayload {
  if (!Number.isFinite(elapsed) || !Number.isFinite(duration))
    throw new Error('Invalid output timestamp or duration')
  return {
    schema_version: '1.0',
    timestamp_ms: Math.max(0, Math.floor(elapsed)),
    status: reading.status,
    deviation_type: reading.deviation,
    confidence: reading.score,
    measurement_quality: reading.status === 'unmeasurable' ? 'poor' : 'good',
    duration_ms: reading.status === 'deviation' ? Math.max(0, Math.floor(duration)) : 0,
  }
}

/** A dimensionless rule score, NOT a trained probability or anatomical angle. */
export function referenceScore(current: Features, baseline: Features) {
  if (!validFeatures(current) || !validFeatures(baseline))
    return { score: null, tilt: false, side: null, headTurn: false }
  if (headTurned(current, baseline)) return { score: null, tilt: false, side: null, headTurn: true }
  const head = Math.abs(current.headGap - baseline.headGap) / 0.22
  const lean = (current.offset - baseline.offset) / 0.2
  const drop = (current.tilt - baseline.tilt) / SHOULDER_TILT_SCALE
  const lateral = Math.abs(lean),
    shoulder = Math.abs(drop)
  // The user's own side. The camera image is not mirrored and MediaPipe names joints by
  // the body, so image x grows toward the user's left and y grows downward: a positive
  // lean (nose toward the user's left) or drop (left shoulder lower) is a tilt to the left.
  // Checked on a real capture (2026-10-08): raising the left shoulder alone reads right.
  const sideward = lateral >= shoulder ? lean : drop
  return {
    score: Math.min(1, Math.max(head, lateral, shoulder) * 0.7),
    tilt: Math.max(lateral, shoulder) > head,
    side: sideward > 0 ? ('left' as const) : sideward < 0 ? ('right' as const) : null,
    headTurn: false,
  }
}
