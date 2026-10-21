import type { Landmark } from '../../../../model/prototype/pose'
import { FRAME_JOINTS } from '../session/realtime/frames'

/**
 * Posture registration (2026-10-20 team meeting): the app averages the 9 joints over a steady
 * capture and sends the mean coordinates to B1 `POST /v2/baselines`. Only x and y are kept;
 * frames, video and the device are not sent.
 */
export const BASELINE_JOINT_NAMES = [
  'nose',
  'left_eye',
  'right_eye',
  'left_ear',
  'right_ear',
  'mouth_left',
  'mouth_right',
  'left_shoulder',
  'right_shoulder',
] as const
export type BaselineJoint = (typeof BASELINE_JOINT_NAMES)[number]
export type BaselineLandmarks = Record<BaselineJoint, { x: number; y: number }>

/** Steady time (user decision 2026-10-06) and B1's minimum `sample_count`. */
export const CAPTURE_MS = 3000
export const CAPTURE_MIN_SAMPLES = 20

export type LandmarkCapture = { start: number | null; count: number; sums: number[] }
export type CapturedBaseline = {
  calibrationMs: number
  sampleCount: number
  landmarks: BaselineLandmarks
}
export type CaptureStep = {
  capture: LandmarkCapture
  progress: number
  ready: CapturedBaseline | null
  /** The mean fell outside the frame; B1 accepts only 0..1. */
  outOfFrame: boolean
}

export const beginCapture = (): LandmarkCapture => ({ start: null, count: 0, sums: [] })

const round5 = (n: number) => Math.round(n * 1e5) / 1e5
const restart = (): CaptureStep => ({ capture: beginCapture(), progress: 0, ready: null, outOfFrame: false })

/**
 * Adds one observation. `points` is null when the frame cannot be used (no person, shoulders
 * not really seen); that, a time jump or a gap over 1 s restarts the capture, as before.
 * Done when the capture lasted CAPTURE_MS and holds CAPTURE_MIN_SAMPLES; at a low tracking
 * rate it keeps going past 3 s until there are enough samples.
 */
export function observeCapture(
  capture: LandmarkCapture,
  points: Landmark[] | null,
  time: number,
  gap: number,
): CaptureStep {
  if (!points || !Number.isFinite(time) || !Number.isFinite(gap) || gap < 0 || gap > 1000) return restart()
  const joints = FRAME_JOINTS.map((i) => points[i])
  if (joints.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return restart()
  const start = capture.start ?? time
  const elapsed = time - start
  if (elapsed < 0) return restart()
  const sums = joints.flatMap((p, i) => [(capture.sums[i * 2] ?? 0) + p.x, (capture.sums[i * 2 + 1] ?? 0) + p.y])
  const next: LandmarkCapture = { start, count: capture.count + 1, sums }
  const progress = Math.min(1, elapsed / CAPTURE_MS)
  if (elapsed < CAPTURE_MS || next.count < CAPTURE_MIN_SAMPLES)
    return { capture: next, progress, ready: null, outOfFrame: false }
  const mean = sums.map((s) => round5(s / next.count))
  if (mean.some((n) => n < 0 || n > 1)) return { capture: next, progress, ready: null, outOfFrame: true }
  const landmarks = Object.fromEntries(
    BASELINE_JOINT_NAMES.map((name, i) => [name, { x: mean[i * 2], y: mean[i * 2 + 1] }]),
  ) as BaselineLandmarks
  return {
    capture: next,
    progress,
    ready: { calibrationMs: Math.round(elapsed), sampleCount: next.count, landmarks },
    outOfFrame: false,
  }
}

/** MediaPipe-indexed points of a baseline, for code that still needs `Features` (F5 removes it). */
export function baselinePoints(landmarks: BaselineLandmarks): Landmark[] {
  const points: Landmark[] = []
  BASELINE_JOINT_NAMES.forEach((name, i) => {
    points[FRAME_JOINTS[i]] = { ...landmarks[name], z: 0, visibility: 1 }
  })
  return points
}
