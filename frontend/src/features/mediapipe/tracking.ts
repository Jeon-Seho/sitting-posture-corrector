import { FRAME_EXPIRY_MS, METRIC_INTERVAL_MS, TRACKING_TICK_MS } from './config'
import type { PoseDelegate, PoseFrame, PoseMetrics, PoseTracker } from './types'
import { beginTrackingDiagnostics, type TrackingPacing } from './trackingDiagnostics'

const RESPONSIVE_YIELD_MS = 8

export function inferenceInterval(
  delegate: PoseDelegate,
  inferenceMs: number,
  pacing: TrackingPacing = 'legacy',
  maxFps: number | null = null,
) {
  // The service retains its existing pacing. The opt-in developer mode reserves
  // an input/render opportunity instead of doubling the entire inference cost.
  const budget = pacing === 'responsive' ? inferenceMs + RESPONSIVE_YIELD_MS : inferenceMs * 2
  return Math.max(delegate === 'GPU' ? 1000 / 30 : 1000 / 20, maxFps ? 1000 / maxFps : 0, budget)
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
  pacing?: TrackingPacing
  getMaxFps?: () => number | null
}

/** Inference clock only. Display, feature extraction and storage are consumers. */
export function startPoseTracking(options: TrackingOptions): () => void {
  const { video, tracker } = options
  const pacing = options.pacing ?? 'legacy'
  let active = true
  let timer: ReturnType<typeof setTimeout> | null = null
  let previousVideoTime = -1
  let previousRun = 0
  let lastFrame = 0
  let inferenceMs = 0
  let metricStart = performance.now()
  let frameCount = 0
  let inferenceSum = 0
  let scheduledAt = 0
  let previousInferenceAt: number | null = null
  const diagnostics = beginTrackingDiagnostics(tracker.delegate, pacing)

  const schedule = () => {
    if (active && options.isCurrent()) {
      const interval = inferenceInterval(tracker.delegate, inferenceMs, pacing, options.getMaxFps?.() ?? null)
      // Work already consumed part of the frame budget. Always yield before the
      // next inference, without adding another full 33 ms after a slow frame.
      const delay = pacing === 'responsive' && previousInferenceAt !== null
        ? Math.ceil(Math.max(RESPONSIVE_YIELD_MS, interval - (performance.now() - previousRun)))
        : TRACKING_TICK_MS
      scheduledAt = performance.now() + delay
      timer = setTimeout(() => tick(performance.now()), delay)
    }
  }
  const tick = (time: number) => {
    if (!active || !options.isCurrent()) { diagnostics.stop(); return }
    diagnostics.record('schedulingLatenessMs', Math.max(0, time - scheduledAt))
    const interval = inferenceInterval(tracker.delegate, inferenceMs, pacing, options.getMaxFps?.() ?? null)
    if (video.readyState >= 2 && time - previousRun >= interval && video.currentTime !== previousVideoTime) {
      previousVideoTime = video.currentTime
      previousRun = pacing === 'responsive' ? time : time - ((time - previousRun) % interval)
      try {
        const inferenceStartedAt = performance.now()
        const frame = tracker.detectFrame(video, time)
        diagnostics.record('inferenceWallMs', performance.now() - inferenceStartedAt)
        diagnostics.record('inferenceReportedMs', frame.inferenceMs)
        diagnostics.record('requestedIntervalMs', interval)
        if (previousInferenceAt !== null) diagnostics.record('frameGapMs', time - previousInferenceAt)
        previousInferenceAt = time
        diagnostics.frame()
        inferenceMs = frame.inferenceMs
        frameCount++
        inferenceSum += inferenceMs
        const gapMs = time - lastFrame
        lastFrame = time
        const consumerStartedAt = performance.now()
        options.onFrame(frame, gapMs)
        diagnostics.record('consumerMs', performance.now() - consumerStartedAt)
      } catch {
        active = false
        diagnostics.stop()
        options.onError()
        return
      }
    }
    if (!active || !options.isCurrent()) { diagnostics.stop(); return }
    if (time - lastFrame > FRAME_EXPIRY_MS) options.onFrameUnavailable()
    const drawStartedAt = performance.now()
    options.onTick?.(time)
    diagnostics.record('drawMs', performance.now() - drawStartedAt)
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
    diagnostics.stop()
    if (timer !== null) clearTimeout(timer)
  }
}
