import type { Landmark } from '../../../../model/prototype/pose'

export type PoseDelegate = 'GPU' | 'CPU'

/** Unsmoothed inference output. No calibration, classification or UI state. */
export type PoseFrame = {
  timeMs: number
  videoTimeMs: number
  landmarks: Landmark[]
  worldLandmarks: Landmark[]
  inferenceMs: number
  delegate: PoseDelegate
  width: number
  height: number
}

export type PoseMetrics = { fps: number; inferenceMs: number; delegate: PoseDelegate }

/** SDK types stop at the adapter; callers can substitute a synthetic tracker. */
export interface PoseTracker {
  readonly delegate: PoseDelegate
  detectFrame(video: HTMLVideoElement, timeMs: number): PoseFrame
  close(): void
}
