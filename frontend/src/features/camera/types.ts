import type { Landmark } from '../../../../model/prototype/pose'

export type CameraDelegate = 'GPU' | 'CPU'
export type CameraState = 'off' | 'loading' | 'on' | 'error'

export type CameraMetrics = {
  fps: number
  inferenceMs: number
  delegate: CameraDelegate
}

export type Observation = {
  timeMs: number
  videoTimeMs: number
  /** Nose, both shoulders and both ears tracked (`measurable`); the app computes no posture values. */
  measurable: boolean
  landmarks: Landmark[]
  worldLandmarks: Landmark[]
  inferenceMs: number
  delegate: CameraDelegate
  width: number
  height: number
  /**
   * `missing`: a shoulder is out of view, so the frame goes to the server as `valid:false`
   * (no grace since 2026-10-22). Absent when nobody is in view.
   */
  shoulders?: ShoulderState
}

export type ShoulderState = 'seen' | 'missing'
