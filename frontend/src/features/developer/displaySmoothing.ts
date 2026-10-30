import type { LabGuideFrame } from './types'

// Display only. These parameters are UI choices, not measurement thresholds.
const MIN_CUTOFF = 2.5
const SPEED_GAIN = 5
const DERIVATIVE_CUTOFF = 1
const RESET_GAP_MS = 250
const alpha = (cutoff: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt))
const usable = (p: LabGuideFrame['points'][number]) =>
  [p.x, p.y, p.visibility].every(Number.isFinite) && p.visibility >= .5 && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1

/** A causal One Euro display filter. It never feeds registration, inference or export. */
export class GuideDisplayFilter {
  private previous: LabGuideFrame | null = null
  private displayed: LabGuideFrame | null = null
  private speeds: { x: number; y: number }[] = []

  reset() { this.previous = null; this.displayed = null; this.speeds = [] }

  update(frame: LabGuideFrame | null): LabGuideFrame | null {
    if (!frame) { this.reset(); return null }
    const previous = this.previous, displayed = this.displayed
    const gap = previous ? frame.timeMs - previous.timeMs : 0
    const copy = { ...frame, points: frame.points.map(p => ({ ...p })) }
    if (!previous || !displayed || gap <= 0 || gap > RESET_GAP_MS ||
      previous.width !== frame.width || previous.height !== frame.height) {
      this.speeds = frame.points.map(() => ({ x: 0, y: 0 }))
    } else {
      const dt = gap / 1000, derivativeAlpha = alpha(DERIVATIVE_CUTOFF, dt)
      copy.points = frame.points.map((p, i) => {
        const prior = previous.points[i], shown = displayed.points[i]
        if (!usable(p) || !prior || !shown || !usable(prior)) {
          this.speeds[i] = { x: 0, y: 0 }
          return { ...p }
        }
        const speed = this.speeds[i] ?? { x: 0, y: 0 }
        const x = speed.x + derivativeAlpha * ((p.x - prior.x) / dt - speed.x)
        const y = speed.y + derivativeAlpha * ((p.y - prior.y) / dt - speed.y)
        this.speeds[i] = { x, y }
        const weight = alpha(MIN_CUTOFF + SPEED_GAIN * Math.hypot(x, y), dt)
        return { ...p, x: shown.x + weight * (p.x - shown.x), y: shown.y + weight * (p.y - shown.y) }
      })
    }
    this.previous = { ...frame, points: frame.points.map(p => ({ ...p })) }
    this.displayed = copy
    return copy
  }
}
