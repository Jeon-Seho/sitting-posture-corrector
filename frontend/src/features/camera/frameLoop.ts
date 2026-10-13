import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import type { Landmark } from '../../../../model/prototype/pose'
import { judgeWithGrace, type LastShoulders } from './shoulderGrace'
import { drawPose, type VisualOptions } from '../../lib/poseVisual'
import { createPointFilter, inferenceInterval } from '../../lib/skeleton'
import type { CameraDelegate, CameraMetrics, Observation } from './types'

const FRAME_EXPIRY_MS = 1_000
const DRAW_INTERVAL_MS = 33
const METRIC_INTERVAL_MS = 500

type FrameLoopOptions = {
  video: HTMLVideoElement
  detector: PoseLandmarker
  delegate: CameraDelegate
  isCurrent: () => boolean
  getCanvas: () => HTMLCanvasElement | null
  getVisual: () => VisualOptions
  onPoseStarted: () => void
  onObservation: (observation: Observation, observationGap: number) => void
  onFrameUnavailable: () => void
  onMetrics: (metrics: CameraMetrics) => void
  onTrackingError: () => void
}

/** Raw observations and display smoothing stay separate throughout the loop. */
export function startPoseFrameLoop(options: FrameLoopOptions): () => void {
  const { video, detector, delegate } = options
  let timer: ReturnType<typeof setTimeout> | null = null
  let previousVideoTime = -1
  let previousRun = 0
  let previousDraw = 0
  let lastFrame = 0
  let inferenceMs = 0
  let target: Landmark[] = []
  let displayed: Landmark[] = []
  /** Last time MediaPipe found a person; the drawing does not depend on judging the frame. */
  let lastSeen = 0
  /** Shoulders of the last judgeable frame, for the 2 s head-only grace. */
  let lastShoulders: LastShoulders = null
  const filter = createPointFilter()
  let metricStart = performance.now()
  let frameCount = 0
  let inferenceSum = 0

  const scheduleNextFrame = () => {
    timer = setTimeout(() => render(performance.now()), DRAW_INTERVAL_MS)
  }
  const render = (time: number) => {
    if (!options.isCurrent()) return

    const interval = inferenceInterval(delegate, inferenceMs)
    if (
      video.readyState >= 2 &&
      time - previousRun >= interval &&
      video.currentTime !== previousVideoTime
    ) {
      previousVideoTime = video.currentTime
      previousRun = time - ((time - previousRun) % interval)

      try {
        const started = performance.now()
        const result = detector.detectForVideo(video, time)
        inferenceMs = performance.now() - started
        frameCount++
        inferenceSum += inferenceMs

        const points = result.landmarks[0] ?? []
        const judged = judgeWithGrace(points, video.videoWidth, video.videoHeight, time, lastShoulders)
        const { reading, shoulders } = judged
        lastShoulders = judged.last
        const observationGap = time - lastFrame
        lastFrame = time

        if (points.length && !target.length) options.onPoseStarted()
        // Draw what the tracker sees even when this frame cannot be judged (2026-10-13):
        // wiping the skeleton on every unjudgeable frame made it flicker and jump.
        if (points.length) {
          target = points
          lastSeen = time
        }
        if (observationGap > FRAME_EXPIRY_MS) filter.reset()
        options.onObservation(
          {
            timeMs: time,
            videoTimeMs: previousVideoTime * 1_000,
            landmarks: points,
            worldLandmarks: result.worldLandmarks[0] ?? [],
            features: reading,
            shoulders,
            inferenceMs,
            delegate,
            width: video.videoWidth,
            height: video.videoHeight,
          },
          observationGap,
        )
      } catch {
        options.onTrackingError()
        return
      }
    }

    if (time - lastFrame > FRAME_EXPIRY_MS) {
      target = []
      options.onFrameUnavailable()
    }
    // Nobody in view for a while: remove the skeleton instead of freezing it.
    if (time - lastSeen > FRAME_EXPIRY_MS && target.length) {
      target = []
      filter.reset()
    }
    displayed = filter.next(target, previousDraw ? time - previousDraw : 16)
    previousDraw = time
    drawPose(
      options.getCanvas(),
      displayed,
      video.videoWidth,
      video.videoHeight,
      time,
      options.getVisual(),
    )

    if (time - metricStart >= METRIC_INTERVAL_MS) {
      options.onMetrics({
        fps: (frameCount * 1_000) / (time - metricStart),
        inferenceMs: frameCount ? inferenceSum / frameCount : 0,
        delegate,
      })
      metricStart = time
      frameCount = 0
      inferenceSum = 0
    }
    scheduleNextFrame()
  }

  scheduleNextFrame()
  return () => {
    if (timer !== null) clearTimeout(timer)
  }
}
