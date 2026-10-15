import type { Features } from '../../../../model/prototype/pose'
import type { PoseDelegate, PoseFrame, PoseMetrics } from '../mediapipe/types'

/** Original MediaPipe indices 0..12: face and both shoulders. */
export { SHOULDER_UP_LANDMARK_COUNT } from '../mediapipe/config'

export type CameraDelegate = PoseDelegate
export type CameraState = 'off' | 'loading' | 'on' | 'error'

export type CameraMetrics = PoseMetrics

export type Observation = PoseFrame & {
  features: Features | null
  /**
   * Grace judges the head against the last seen shoulders for at most SHOULDER_GRACE_MS.
   * Missing means the frame is unmeasurable. Absent when nobody is in view.
   * Raw landmarks are never replaced with remembered shoulders.
   */
  shoulders?: ShoulderState
}

export type ShoulderState = 'seen' | 'grace' | 'missing'
