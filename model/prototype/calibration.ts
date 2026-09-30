import { average, validFeatures, type Features } from './pose'

export type Calibration = { start: number | null; samples: Features[] }
export const beginCalibration = (): Calibration => ({ start: null, samples: [] })

/** Only continuous, valid observations count toward the existing 5s / 20 sample rule. */
export function observeCalibration(draft: Calibration, sample: Features | null, time: number, gap: number) {
  if (!validFeatures(sample) || !Number.isFinite(time) || !Number.isFinite(gap) || gap < 0 || gap > 1000) {
    return { draft: beginCalibration(), progress: 0, ready: null }
  }
  const next = { start: draft.start ?? time, samples: [...draft.samples, sample] }
  const elapsed = time - next.start
  if (elapsed < 0) return { draft: beginCalibration(), progress: 0, ready: null }
  return { draft: next, progress: Math.min(1, elapsed / 5000),
    ready: elapsed >= 5000 && next.samples.length >= 20 ? average(next.samples) : null }
}
