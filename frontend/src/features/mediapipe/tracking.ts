import { FRAME_EXPIRY_MS, METRIC_INTERVAL_MS, TRACKING_TICK_MS } from './config'
import type { PoseDelegate, PoseFrame, PoseMetrics, PoseTracker } from './types'

export function inferenceInterval(delegate: PoseDelegate, inferenceMs: number) {
  // Leave time for rendering and input, especially on CPU fallback.
  return Math.max(delegate === 'GPU' ? 1000 / 30 : 1000 / 20, inferenceMs * 2)
}

type TrackingOptions = {
  video: HTMLVideoElement
  tracker: PoseTracker
  isCurrent: () => boolean
  onFrame: (frame: PoseFrame, gapMs: number) => void
  onFrameUnavailable: () => void
  onMetrics: (metrics: PoseMetrics) => void
  onError: () => void
  onTick?: (timeMs: number) => void
}

/** Inference clock only. Display, feature extraction and storage are consumers. */
export function startPoseTracking(options: TrackingOptions): () => void {
  const { video, tracker } = options
  let active = true
  let timer: ReturnType<typeof setTimeout> | null = null
  let previousVideoTime = -1
  let previousRun = 0
  let lastFrame = 0
  let inferenceMs = 0
  let metricStart = performance.now()
  let frameCount = 0
  let inferenceSum = 0

  const schedule = () => {
    if (active && options.isCurrent()) timer = setTimeout(() => tick(performance.now()), TRACKING_TICK_MS)
  }
  const tick = (time: number) => {
    if (!active || !options.isCurrent()) return
    const interval = inferenceInterval(tracker.delegate, inferenceMs)
    if (video.readyState >= 2 && time - previousRun >= interval && video.currentTime !== previousVideoTime) {
      previousVideoTime = video.currentTime
      previousRun = time - ((time - previousRun) % interval)
      try {
        const frame = tracker.detectFrame(video, time)
        inferenceMs = frame.inferenceMs
        frameCount++
        inferenceSum += inferenceMs
        const gapMs = time - lastFrame
        lastFrame = time
        options.onFrame(frame, gapMs)
      } catch {
        active = false
        options.onError()
        return
      }
    }
    if (!active || !options.isCurrent()) return
    if (time - lastFrame > FRAME_EXPIRY_MS) options.onFrameUnavailable()
    options.onTick?.(time)
    if (time - metricStart >= METRIC_INTERVAL_MS) {
      options.onMetrics({
        fps: (frameCount * 1_000) / (time - metricStart),
        inferenceMs: frameCount ? inferenceSum / frameCount : 0,
        delegate: tracker.delegate,
      })
      metricStart = time
      frameCount = 0
      inferenceSum = 0
    }
    schedule()
  }
  schedule()
  return () => {
    active = false
    if (timer !== null) clearTimeout(timer)
  }
}
