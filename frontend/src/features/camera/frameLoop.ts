import type { Landmark } from '../../../../model/prototype/pose'
import { drawPose, type VisualOptions } from '../../lib/poseVisual'
import { createPointFilter } from '../../lib/skeleton'
import { FRAME_EXPIRY_MS, startPoseTracking, type PoseTracker } from '../mediapipe'
import { judgeWithGrace, type LastShoulders } from './shoulderGrace'
import type { CameraMetrics, Observation } from './types'

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
  /** Upper bound on tracking runs per second (settings › 추적 속도). */
  getMaxFps?: () => number | null
}

/** Camera UI adapter. MediaPipe supplies raw frames; smoothing affects drawing only. */
export function startPoseFrameLoop(options: FrameLoopOptions): () => void {
  const { video } = options
  let previousDraw = 0
  let target: Landmark[] = []
  let lastSeen = 0
  let lastShoulders: LastShoulders = null
  let shouldersInView: boolean | null = null
  const filter = createPointFilter()
  return startPoseTracking({
    video,
    tracker: options.tracker,
    pacing: options.pacing,
    getMaxFps: options.getMaxFps,
    isCurrent: options.isCurrent,
    onFrame(frame, gapMs) {
      const { reading, shoulders, last } = judgeWithGrace(
        frame.landmarks, frame.width, frame.height, frame.timeMs, lastShoulders,
      )
      lastShoulders = last
      if (frame.landmarks.length && !target.length) options.onPoseStarted()
      // Drawing follows detection even when service judging cannot use this frame.
      if (frame.landmarks.length) {
        const inView = shoulders === 'seen'
        if (shouldersInView !== null && inView !== shouldersInView) filter.reset()
        shouldersInView = inView
        target = frame.landmarks
        lastSeen = frame.timeMs
      }
      if (gapMs > FRAME_EXPIRY_MS) filter.reset()
      // Grace supplies service features only; raw image/world points and model ID stay intact.
      options.onObservation({ ...frame, features: reading, shoulders }, gapMs)
    },
    onFrameUnavailable() {
      target = []
      filter.reset()
      options.onFrameUnavailable()
    },
    onTick(time) {
      if (time - lastSeen > FRAME_EXPIRY_MS && target.length) {
        target = []
        filter.reset()
      }
      const displayed = filter.next(target, previousDraw ? time - previousDraw : 16)
      previousDraw = time
      drawPose(options.getCanvas(), displayed, video.videoWidth, video.videoHeight, time, options.getVisual())
    },
    onMetrics: options.onMetrics,
    onError: options.onTrackingError,
  })
}
