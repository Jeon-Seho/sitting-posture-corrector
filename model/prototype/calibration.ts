import { average, validFeatures, type Features } from './pose'

/** Normalized frame position of the calibrated upper body (see `placement` in pose.ts). */
export type Placement = { x: number; y: number; area: number }
export type Calibration = { start: number | null; samples: Features[]; placements: Placement[] }
/** Aggregates stored with a server baseline (DB V1.1 `baseline_posture`/`baseline_feature`). */
export type CalibrationSummary = {
  durationMs: number
  sampleCount: number
  /** Population standard deviation of each feature over the calibration samples. */
  spread: { headGap: number; offset: number; tilt: number }
  /** Mean placement; null when the caller did not supply placements. */
  placement: Placement | null
}
export const beginCalibration = (): Calibration => ({ start: null, samples: [], placements: [] })

/** Steady time and minimum valid samples for a baseline (3 s at ≥5 fps; user decision 2026-10-06). */
export const CALIBRATION_MS = 3000
export const CALIBRATION_MIN_SAMPLES = 15

const validPlacement = (value: Placement | null | undefined): value is Placement =>
  !!value &&
  [value.x, value.y, value.area].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)

/** Only continuous, valid observations count toward the CALIBRATION_MS / CALIBRATION_MIN_SAMPLES rule. */
export function observeCalibration(
  draft: Calibration,
  sample: Features | null,
  time: number,
  gap: number,
  placement?: Placement | null,
) {
  if (
    !validFeatures(sample) ||
    !Number.isFinite(time) ||
    !Number.isFinite(gap) ||
    gap < 0 ||
    gap > 1000
  ) {
    return { draft: beginCalibration(), progress: 0, ready: null, summary: null }
  }
  const next: Calibration = {
    start: draft.start ?? time,
    samples: [...draft.samples, sample],
    placements: validPlacement(placement) ? [...draft.placements, placement] : draft.placements,
  }
  const elapsed = time - next.start!
  if (elapsed < 0) return { draft: beginCalibration(), progress: 0, ready: null, summary: null }
  const done = elapsed >= CALIBRATION_MS && next.samples.length >= CALIBRATION_MIN_SAMPLES
  return {
    draft: next,
    progress: Math.min(1, elapsed / CALIBRATION_MS),
    ready: done ? average(next.samples) : null,
    summary: done ? summarize(next, elapsed) : null,
  }
}

function summarize(draft: Calibration, durationMs: number): CalibrationSummary {
  const mean = average(draft.samples)
  const spread = (key: 'headGap' | 'offset' | 'tilt') =>
    Math.sqrt(
      draft.samples.reduce((n, s) => n + (s[key] - mean[key]) ** 2, 0) / draft.samples.length,
    )
  const placements = draft.placements
  const placementMean = (key: keyof Placement) =>
    placements.reduce((n, p) => n + p[key], 0) / placements.length
  return {
    durationMs,
    sampleCount: draft.samples.length,
    spread: { headGap: spread('headGap'), offset: spread('offset'), tilt: spread('tilt') },
    placement: placements.length
      ? { x: placementMean('x'), y: placementMean('y'), area: placementMean('area') }
      : null,
  }
}
