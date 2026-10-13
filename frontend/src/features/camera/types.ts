import type { Features, Landmark } from '../../../../model/prototype/pose'

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
  features: Features | null
  landmarks: Landmark[]
  worldLandmarks: Landmark[]
  inferenceMs: number
  delegate: CameraDelegate
  width: number
  height: number
  /**
   * `grace`: shoulders out of view for at most SHOULDER_GRACE_MS, the head is judged against
   * the last seen shoulders. `missing`: longer than that, the frame is unmeasurable.
   * Absent when nobody is in view.
   */
  shoulders?: ShoulderState
}

export type ShoulderState = 'seen' | 'grace' | 'missing'
