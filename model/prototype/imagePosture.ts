/** Fixed-camera /dev complement to translation/scale-invariant 3D features. */
export const IMAGE_POSTURE_SPEC = {
  policy: 'image-posture-anchor-v2' as const,
  translationFloor: .18,
  shrinkFloor: .12,
  quantile: .95,
  spreadMultiplier: 1.5,
  smoothingMs: 200,
  maximumGapMs: 250,
  aspectTolerance: .01,
  minimumSamples: 65,
}
export interface ImagePostureInput {
  points: readonly { x: number; y: number; visibility?: number }[]
  width: number
  height: number
}
interface ImageFeatures { faceX: number; faceY: number; shoulderX: number; shoulderY: number; span: number; aspect: number }
export type ImagePosturePolicy = 'image-posture-anchor-v1' | typeof IMAGE_POSTURE_SPEC.policy
export interface ImagePostureReading {
  policy: ImagePosturePolicy
  status: 'registering' | 'ready' | 'unmeasurable' | 'needs_reference'
  score: number | null
  /** Common face/shoulder translation in registration shoulder-width units. */
  translation: number | null
  /** Fraction of the registration image shoulder span lost; not a depth estimate. */
  shrink: number | null
  translationLimit: number | null
  shrinkLimit: number | null
  strongest: 'position' | 'scale' | null
}
/** Explicit scalar whitelist for diagnostic export; never copies raw references. */
export function copyImagePostureReading(r: ImagePostureReading): ImagePostureReading {
  const { policy, status, score, translation, shrink, translationLimit, shrinkLimit, strongest } = r
  return { policy, status, score, translation, shrink, translationLimit, shrinkLimit, strongest }
}

function features(input: ImagePostureInput | null | undefined): ImageFeatures | null {
  if (!input || !Number.isFinite(input.width) || !Number.isFinite(input.height) || input.width <= 0 || input.height <= 0 || input.points.length < 13) return null
  const p = input.points.slice(0, 13)
  if (p.some(v => !v || ![v.x, v.y, v.visibility].every(Number.isFinite) || (v.visibility ?? 0) < .5 || v.x < 0 || v.x > 1 || v.y < 0 || v.y > 1)) return null
  const aspect = input.height / input.width
  const l = p[11], r = p[12]
  const span = Math.hypot(l.x - r.x, (l.y - r.y) * aspect)
  if (span < .03) return null
  return { faceX: p.slice(0, 11).reduce((s, v) => s + v.x, 0) / 11,
    faceY: p.slice(0, 11).reduce((s, v) => s + v.y, 0) / 11,
    shoulderX: (l.x + r.x) / 2, shoulderY: (l.y + r.y) / 2, span, aspect }
}
const quantile = (v: number[], q: number) => [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) * q)]
function delta(sample: ImageFeatures, reference: ImageFeatures) {
  const a = [(sample.faceX - reference.faceX) / reference.span, (sample.faceY - reference.faceY) * reference.aspect / reference.span]
  const b = [(sample.shoulderX - reference.shoulderX) / reference.span, (sample.shoulderY - reference.shoulderY) * reference.aspect / reference.span]
  const an = Math.hypot(...a), bn = Math.hypot(...b)
  // Head-only motion cannot become whole-body translation. Opposing movements do not add.
  const agreement = an > 0 && bn > 0 ? (a[0] * b[0] + a[1] * b[1]) / (an * bn) : 0
  return { translation: agreement > .5 ? Math.min(an, bn) : 0, shrink: Math.max(0, 1 - sample.span / reference.span) }
}

/** Registration data stay transient; only scalar decisions can be exported. */
export class ImagePostureAnchor {
  private samples: ImageFeatures[] = []
  private reference: ImageFeatures | null = null
  private translationLimit: number | null = null
  private shrinkLimit: number | null = null
  private lastTime: number | null = null
  private filtered: { translation: number; shrink: number } | null = null
  private status: ImagePostureReading['status'] = 'registering'
  private current: ImagePostureReading | null = null

  beginRegistration() {
    this.samples = []; this.reference = null; this.translationLimit = null; this.shrinkLimit = null
    this.status = 'registering'; this.clearContinuity()
  }
  clearContinuity() {
    this.lastTime = null; this.filtered = null; this.current = null
    if (this.status === 'ready') this.status = 'unmeasurable'
  }
  clearRegistrationSamples() { this.samples = []; this.clearContinuity() }
  get snapshot(): ImagePostureReading {
    return this.current ? { ...this.current } : { policy: IMAGE_POSTURE_SPEC.policy, status: this.status, score: null,
      translation: null, shrink: null, translationLimit: this.translationLimit, shrinkLimit: this.shrinkLimit, strongest: null }
  }
  private compatible(sample: ImageFeatures) {
    const ref = this.reference ?? this.samples[0]
    return !ref || Math.abs(sample.aspect - ref.aspect) <= IMAGE_POSTURE_SPEC.aspectTolerance
  }
  collect(input: ImagePostureInput | null | undefined): boolean {
    const sample = features(input)
    if (!sample || !this.compatible(sample)) return false
    this.samples.push(sample)
    return true
  }
  finishRegistration(): boolean {
    if (this.samples.length < IMAGE_POSTURE_SPEC.minimumSamples) return false
    const keys = ['faceX', 'faceY', 'shoulderX', 'shoulderY', 'span', 'aspect'] as const
    const reference = Object.fromEntries(keys.map(k => [k, quantile(this.samples.map(s => s[k]), .5)])) as unknown as ImageFeatures
    const shifts = this.samples.map(sample => delta(sample, reference))
    this.translationLimit = Math.max(IMAGE_POSTURE_SPEC.translationFloor, quantile(shifts.map(s => s.translation), IMAGE_POSTURE_SPEC.quantile) * IMAGE_POSTURE_SPEC.spreadMultiplier)
    this.shrinkLimit = Math.max(IMAGE_POSTURE_SPEC.shrinkFloor, quantile(shifts.map(s => s.shrink), IMAGE_POSTURE_SPEC.quantile) * IMAGE_POSTURE_SPEC.spreadMultiplier)
    this.reference = reference; this.samples = []; this.status = 'ready'; this.clearContinuity()
    return true
  }
  measure(timeMs: number, input: ImagePostureInput | null | undefined): ImagePostureReading | null {
    if (!this.reference || this.translationLimit == null || this.shrinkLimit == null || this.status === 'needs_reference') return null
    const sample = features(input)
    if (!sample || !Number.isFinite(timeMs) || (this.lastTime !== null && timeMs <= this.lastTime)) { this.clearContinuity(); return null }
    if (!this.compatible(sample)) { this.clearContinuity(); this.status = 'needs_reference'; return null }
    const shift = delta(sample, this.reference)
    const dt = this.lastTime === null ? null : timeMs - this.lastTime
    const alpha = dt === null || dt > IMAGE_POSTURE_SPEC.maximumGapMs ? 1 : 1 - Math.exp(-dt / IMAGE_POSTURE_SPEC.smoothingMs)
    this.filtered = this.filtered ? { translation: this.filtered.translation + alpha * (shift.translation - this.filtered.translation),
      shrink: this.filtered.shrink + alpha * (shift.shrink - this.filtered.shrink) } : shift
    this.lastTime = timeMs; this.status = 'ready'
    const position = this.filtered.translation / this.translationLimit, scale = this.filtered.shrink / this.shrinkLimit
    this.current = { policy: IMAGE_POSTURE_SPEC.policy, status: 'ready', score: Math.max(position, scale),
      ...this.filtered, translationLimit: this.translationLimit, shrinkLimit: this.shrinkLimit,
      strongest: position === 0 && scale === 0 ? null : position >= scale ? 'position' : 'scale' }
    return { ...this.current }
  }
}
