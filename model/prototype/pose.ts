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
  offset: number
  tilt: number
  quality: number
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
  return {
    headGap: ((cy - nose.y) * height) / span,
    offset: ((nose.x - cx) * width) / span,
    tilt: ((left.y - right.y) * height) / span,
    quality: Math.min(...required.map((p) => p.visibility!)),
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
  }
}

/** Shoulder tilt change treated as a full deviation (ADR 0019; was 0.13). */
export const SHOULDER_TILT_SCALE = 0.03

export function classify(current: Features | null, baseline: Features | null): Reading {
  if (!validFeatures(current) || !validFeatures(baseline)) return unavailable
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
          ? lean < 0
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
    return { score: null, tilt: false, side: null }
  const head = Math.abs(current.headGap - baseline.headGap) / 0.22
  const lean = (current.offset - baseline.offset) / 0.2
  const drop = (current.tilt - baseline.tilt) / SHOULDER_TILT_SCALE
  const lateral = Math.abs(lean),
    shoulder = Math.abs(drop)
  // Side as the user names it. A real capture (2026-10-08) showed that leaning to the
  // user's own left makes the dominant change negative and leaning right makes it
  // positive, so a negative change is a tilt to the left.
  const sideward = lateral >= shoulder ? lean : drop
  return {
    score: Math.min(1, Math.max(head, lateral, shoulder) * 0.7),
    tilt: Math.max(lateral, shoulder) > head,
    side: sideward < 0 ? ('left' as const) : sideward > 0 ? ('right' as const) : null,
  }
}
