import { features, type Landmark } from '../../../../model/prototype/pose'
import { drawPose, type VisualOptions } from '../../lib/poseVisual'
import { smoothPoints } from '../../lib/skeleton'
import { FRAME_EXPIRY_MS, startPoseTracking, type PoseTracker } from '../mediapipe'
import {
  type CameraMetrics,
  type Observation,
} from './types'

type FrameLoopOptions = {
  pacing?: 'legacy' | 'responsive'
  video: HTMLVideoElement
  tracker: PoseTracker
  isCurrent: () => boolean
  getCanvas: () => HTMLCanvasElement | null
  getVisual: () => VisualOptions
  onPoseStarted: () => void
  onObservation: (observation: Observation, observationGap: number) => void
  onFrameUnavailable: () => void
  onMetrics: (metrics: CameraMetrics) => void
  onTrackingError: () => void
}

/** Camera UI adapter. MediaPipe supplies raw frames; smoothing affects drawing only. */
export function startPoseFrameLoop(options: FrameLoopOptions): () => void {
  const { video } = options
  let previousDraw = 0
  let target: Landmark[] = []
  let displayed: Landmark[] = []
  return startPoseTracking({
    video,
    tracker: options.tracker,
    pacing: options.pacing,
    isCurrent: options.isCurrent,
    onFrame(frame, gapMs) {
      const reading = features(frame.landmarks, frame.width, frame.height)
      if (reading && !target.length) options.onPoseStarted()
      target = reading ? frame.landmarks : []
      if (!reading || gapMs > FRAME_EXPIRY_MS) displayed = []
      options.onObservation({ ...frame, features: reading }, gapMs)
    },
    onFrameUnavailable() {
      target = []
      displayed = []
      options.onFrameUnavailable()
    },
    onTick(time) {
      displayed = smoothPoints(displayed, target, previousDraw ? time - previousDraw : 16)
      previousDraw = time
      drawPose(options.getCanvas(), displayed, video.videoWidth, video.videoHeight, time, options.getVisual())
    },
    onMetrics: options.onMetrics,
    onError: options.onTrackingError,
  })
}
