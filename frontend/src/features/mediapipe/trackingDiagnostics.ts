import type { PoseDelegate } from './types'

export type TrackingPacing = 'legacy' | 'responsive'
export type TrackingTimingKey = 'inferenceWallMs' | 'inferenceReportedMs' | 'consumerMs' | 'drawMs' | 'requestedIntervalMs' | 'frameGapMs' | 'schedulingLatenessMs'
export type TimingSummary = { count: number; mean: number; p50: number; p95: number; max: number }
export type TrackingDiagnostics = {
  active: boolean
  delegate: PoseDelegate
  pacing: TrackingPacing
  frames: number
  elapsedMs: number
  sampleLimit: number
  timing: Record<TrackingTimingKey, TimingSummary>
}

const SAMPLE_LIMIT = 300
const TIMING_KEYS: TrackingTimingKey[] = ['inferenceWallMs', 'inferenceReportedMs', 'consumerMs', 'drawMs', 'requestedIntervalMs', 'frameGapMs', 'schedulingLatenessMs']

function summary(samples: number[]): TimingSummary {
  if (!samples.length) return { count: 0, mean: 0, p50: 0, p95: 0, max: 0 }
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    count: samples.length,
    mean: samples.reduce((total, value) => total + value, 0) / samples.length,
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted[sorted.length - 1],
  }
}

/** Bounded timing-only diagnostics: never video, landmarks or participant identifiers. */
class TrackingTimingCollector {
  private samples = Object.fromEntries(TIMING_KEYS.map(key => [key, [] as number[]])) as Record<TrackingTimingKey, number[]>
  private startedAt = performance.now()
  private stoppedAt: number | null = null
  private frames = 0

  constructor(private readonly delegate: PoseDelegate, private readonly pacing: TrackingPacing) {}

  reset() {
    this.samples = Object.fromEntries(TIMING_KEYS.map(key => [key, [] as number[]])) as Record<TrackingTimingKey, number[]>
    this.startedAt = performance.now()
    this.frames = 0
    if (this.stoppedAt !== null) this.stoppedAt = this.startedAt
  }

  record(key: TrackingTimingKey, value: number) {
    if (this.stoppedAt !== null || !Number.isFinite(value) || value < 0) return
    const samples = this.samples[key]
    samples.push(value)
    if (samples.length > SAMPLE_LIMIT) samples.shift()
  }

  frame() { if (this.stoppedAt === null) this.frames++ }
  stop() { this.stoppedAt ??= performance.now() }

  snapshot(): TrackingDiagnostics {
    return {
      active: this.stoppedAt === null,
      delegate: this.delegate,
      pacing: this.pacing,
      frames: this.frames,
      elapsedMs: Math.max(0, (this.stoppedAt ?? performance.now()) - this.startedAt),
      sampleLimit: SAMPLE_LIMIT,
      timing: Object.fromEntries(TIMING_KEYS.map(key => [key, summary(this.samples[key])])) as Record<TrackingTimingKey, TimingSummary>,
    }
  }
}

let current: TrackingTimingCollector | null = null

export function beginTrackingDiagnostics(delegate: PoseDelegate, pacing: TrackingPacing) {
  current = new TrackingTimingCollector(delegate, pacing)
  return current
}

/** Read on demand so instrumentation does not trigger a React render for every frame. */
export function readTrackingDiagnostics(): TrackingDiagnostics | null { return current?.snapshot() ?? null }
export function resetTrackingDiagnostics() { current?.reset() }
