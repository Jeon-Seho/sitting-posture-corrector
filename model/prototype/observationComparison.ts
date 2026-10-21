import type { Landmark } from './pose'

/** Research display only: no posture class, score, learned model or alert. */
export const COMPARISON_POLICY = { visibility: .5, gapMs: 500, referenceMs: 2000, minimumSamples: 10, captureMs: 1000, captureSamples: 5 } as const
export type ComparisonFrame = { timeMs: number; width: number; height: number; poseModelId?: string; landmarks: Landmark[]; worldLandmarks: Landmark[] }
export type ImageGeometry = { gap: number; faceHeight: number; shoulderY: number; shoulderWidth: number }
export type WorldGeometry = { relativeZ: number; shoulderWidth: number }
export type ComparisonGeometry = { image: ImageGeometry | null; world: WorldGeometry | null; context: string }
export type ComparisonValues = { headGap: number; faceHeight: number; shoulderLift: number; shoulderScale: number; relativeZ: number | null; zMeters: number | null }
export type ComparisonSample = { timeMs: number; values: ComparisonValues | null }
const imageIndices = [0, 2, 5, 9, 10, 11, 12]
const finitePoint = (p: Landmark | undefined, image: boolean) => !!p && [p.x, p.y, p.z, p.visibility ?? 0].every(Number.isFinite) && (p.visibility ?? 0) >= COMPARISON_POLICY.visibility && (!image || p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)
const median = (values: number[]) => { const a = [...values].sort((x, y) => x - y), i = Math.floor(a.length / 2); return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2 }

export function comparisonGeometry(frame: ComparisonFrame): ComparisonGeometry {
  const { landmarks: p, worldLandmarks: w, width, height } = frame
  const context = `${frame.poseModelId ?? 'unknown'}:${width}x${height}`
  let image: ImageGeometry | null = null, world: WorldGeometry | null = null
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && imageIndices.every(i => finitePoint(p[i], true))) {
    const y = height / width, shoulderY = (p[11].y + p[12].y) / 2 * y
    const span = Math.hypot(p[12].x - p[11].x, (p[12].y - p[11].y) * y)
    const candidate = { gap: shoulderY - p[0].y * y, shoulderY, shoulderWidth: span, faceHeight: ((p[9].y + p[10].y) - (p[2].y + p[5].y)) / 2 * y }
    if (span > 1e-6 && Object.values(candidate).every(Number.isFinite)) image = candidate
  }
  if ([0, 11, 12].every(i => finitePoint(w[i], false))) {
    const span = Math.hypot(w[12].x - w[11].x, w[12].y - w[11].y, w[12].z - w[11].z)
    const relativeZ = w[0].z - (w[11].z + w[12].z) / 2
    if (span > 1e-6 && Number.isFinite(span) && Number.isFinite(relativeZ)) world = { relativeZ, shoulderWidth: span }
  }
  return { image, world, context }
}

export function comparisonValues(now: ComparisonGeometry, reference: ComparisonGeometry): ComparisonValues | null {
  if (!now.image || !reference.image || now.context !== reference.context) return null
  const a = now.image, b = reference.image, scale = 100 / b.shoulderWidth
  return {
    headGap: (a.gap - b.gap) * scale,
    faceHeight: (a.faceHeight - b.faceHeight) * scale,
    shoulderLift: (b.shoulderY - a.shoulderY) * scale,
    shoulderScale: (a.shoulderWidth / b.shoulderWidth - 1) * 100,
    relativeZ: now.world && reference.world ? (now.world.relativeZ - reference.world.relativeZ) / reference.world.shoulderWidth * 100 : null,
    zMeters: now.world?.relativeZ ?? null,
  }
}

export function medianComparison(samples: ComparisonSample[]): ComparisonValues | null {
  const rows = samples.map(s => s.values).filter((v): v is ComparisonValues => v !== null)
  if (rows.length !== samples.length || !rows.length) return null
  const mean = (key: keyof ComparisonValues) => rows.every(r => r[key] !== null) ? median(rows.map(r => r[key]!)) : null
  return { headGap: mean('headGap')!, faceHeight: mean('faceHeight')!, shoulderLift: mean('shoulderLift')!, shoulderScale: mean('shoulderScale')!, relativeZ: mean('relativeZ'), zMeters: mean('zMeters') }
}

/** Bounded transient observation state. Never serialized or shared with the service engine. */
export class ObservationComparison {
  reference: ComparisonGeometry | null = null
  current: ComparisonGeometry | null = null
  samples: ComparisonSample[] = []
  registering = false
  progress = 0
  private batch: { time: number; geometry: ComparisonGeometry }[] = []
  private last: number | null = null
  reset() { this.reference = null; this.current = null; this.samples = []; this.registering = false; this.progress = 0; this.batch = []; this.last = null }
  beginReference() { this.reset(); this.registering = true }
  interrupt(time: number) {
    this.current = null; this.batch = []; this.progress = 0
    this.samples = [...this.samples, { timeMs: time, values: null }].slice(-120)
  }
  accept(frame: ComparisonFrame) {
    const t = frame.timeMs
    if (!Number.isFinite(t) || t < 0 || this.last !== null && t <= this.last) { this.interrupt(this.last ?? 0); return }
    if (this.last !== null && t - this.last > COMPARISON_POLICY.gapMs) this.interrupt(t)
    this.last = t
    const geometry = comparisonGeometry(frame)
    if (this.reference && geometry.context !== this.reference.context) this.reset()
    this.current = geometry
    if (this.registering) {
      if (!geometry.image || this.batch.at(-1)?.geometry.context !== undefined && this.batch.at(-1)!.geometry.context !== geometry.context) { this.batch = []; this.progress = 0 }
      if (geometry.image) {
        this.batch.push({ time: t, geometry }); this.batch = this.batch.slice(-100)
        const duration = t - this.batch[0].time
        this.progress = Math.min(1, duration / COMPARISON_POLICY.referenceMs)
        if (duration >= COMPARISON_POLICY.referenceMs && this.batch.length >= COMPARISON_POLICY.minimumSamples) {
          const rows = this.batch.map(b => b.geometry), images = rows.map(r => r.image!)
          const image = Object.fromEntries(Object.keys(images[0]).map(k => [k, median(images.map(r => r[k as keyof ImageGeometry]))])) as ImageGeometry
          const worlds = rows.map(r => r.world)
          // Missing depth within registration never becomes a zero-valued depth reference.
          const world = worlds.every((w): w is WorldGeometry => w !== null) ? { relativeZ: median(worlds.map(w => w.relativeZ)), shoulderWidth: median(worlds.map(w => w.shoulderWidth)) } : null
          this.reference = { context: geometry.context, image, world }; this.registering = false; this.batch = []; this.samples = []
        }
      }
    }
    this.samples = [...this.samples, { timeMs: t, values: this.reference ? comparisonValues(geometry, this.reference) : null }].filter(s => t - s.timeMs <= 10000).slice(-120)
  }
  capture(after: number): ComparisonValues | null {
    const end = this.samples.at(-1)?.timeMs ?? 0
    const rows = this.samples.filter(s => s.timeMs >= Math.max(after, end - COMPARISON_POLICY.captureMs))
    if (rows.length < COMPARISON_POLICY.captureSamples || end - rows[0].timeMs < 800 || rows.some((r, i) => i > 0 && r.timeMs - rows[i - 1].timeMs > COMPARISON_POLICY.gapMs)) return null
    return medianComparison(rows)
  }
}
