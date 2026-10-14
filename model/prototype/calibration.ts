import {
  average,
  BASELINE_LANDMARKS,
  validFeatures,
  type Anchors,
  type BaselineLandmark,
  type Features,
} from './pose'

export type Calibration = { start: number | null; samples: Features[]; anchors: Anchors[] }
/** Values stored with a server baseline (DB V2.1 `baseline_posture`, one row per user). */
export type CalibrationSummary = {
  durationMs: number
  sampleCount: number
  /** Population standard deviation of each feature over the calibration samples. */
  spread: { headGap: number; offset: number; tilt: number }
  /**
   * Mean landmark positions over the samples whose landmarks were all on the frame; null when
   * fewer than CALIBRATION_MIN_SAMPLES such frames were supplied.
   */
  landmarks: Anchors | null
}
export const beginCalibration = (): Calibration => ({ start: null, samples: [], anchors: [] })

/** Steady time and minimum valid samples for a baseline (3 s at ≥5 fps; user decision 2026-10-06). */
export const CALIBRATION_MS = 3000
export const CALIBRATION_MIN_SAMPLES = 15

const validAnchors = (value: Anchors | null | undefined): value is Anchors =>
  !!value &&
  Object.keys(BASELINE_LANDMARKS).every((name) => {
    const p = value[name as BaselineLandmark]
    return !!p && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
  })

/** Only continuous, valid observations count toward the CALIBRATION_MS / CALIBRATION_MIN_SAMPLES rule. */
export function observeCalibration(
  draft: Calibration,
  sample: Features | null,
  time: number,
  gap: number,
  landmarks?: Anchors | null,
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
    anchors: validAnchors(landmarks) ? [...draft.anchors, landmarks] : draft.anchors,
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
  const frames = draft.anchors
  let landmarks: Anchors | null = null
  if (frames.length >= CALIBRATION_MIN_SAMPLES) {
    landmarks = {} as Anchors
    for (const name of Object.keys(BASELINE_LANDMARKS) as BaselineLandmark[])
      landmarks[name] = {
        x: frames.reduce((n, f) => n + f[name].x, 0) / frames.length,
        y: frames.reduce((n, f) => n + f[name].y, 0) / frames.length,
      }
  }
  return {
    durationMs,
    sampleCount: draft.samples.length,
    spread: { headGap: spread('headGap'), offset: spread('offset'), tilt: spread('tilt') },
    landmarks,
  }
}
