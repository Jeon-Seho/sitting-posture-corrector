import type { Features } from '../../../../model/prototype/pose'
import type { PoseDelegate, PoseFrame, PoseMetrics } from '../mediapipe/types'

/** Original MediaPipe indices 0..12: face and both shoulders. */
export { SHOULDER_UP_LANDMARK_COUNT } from '../mediapipe/config'

export type CameraDelegate = PoseDelegate
export type CameraState = 'off' | 'loading' | 'on' | 'error'

export type CameraMetrics = PoseMetrics

export type Observation = PoseFrame & {
  features: Features | null
}
