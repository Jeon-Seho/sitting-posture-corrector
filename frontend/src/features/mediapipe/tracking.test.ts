import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { inferenceInterval, startPoseTracking } from './tracking'
import { readTrackingDiagnostics } from './trackingDiagnostics'
import type { PoseFrame, PoseTracker } from './types'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

function synthetic() {
  const video = { readyState: 2, currentTime: 0.1, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement
  const detectFrame = vi.fn((_video: HTMLVideoElement, timeMs: number): PoseFrame => ({
    timeMs, videoTimeMs: video.currentTime * 1000, landmarks: [], worldLandmarks: [],
    width: 640, height: 480, inferenceMs: 5, delegate: 'GPU',
  }))
  const tracker: PoseTracker = { delegate: 'GPU', detectFrame, close: vi.fn() }
  const handlers = { onFrame: vi.fn(), onFrameUnavailable: vi.fn(), onMetrics: vi.fn(), onError: vi.fn(), onTick: vi.fn() }
  return { video, tracker, detectFrame, handlers }
}

it('tracks each video frame once, reports expiry separately, and cancels its clock', () => {
  const { video, tracker, detectFrame, handlers } = synthetic()
  const stop = startPoseTracking({ video, tracker, isCurrent: () => true, ...handlers })
  vi.advanceTimersByTime(600)
  expect(detectFrame).toHaveBeenCalledTimes(1)
  expect(handlers.onMetrics).toHaveBeenCalled()
  expect(handlers.onFrameUnavailable).not.toHaveBeenCalled()
  vi.advanceTimersByTime(500)
  expect(handlers.onFrameUnavailable).toHaveBeenCalled()
  video.currentTime = 0.2
  vi.advanceTimersByTime(33)
  expect(handlers.onFrame).toHaveBeenCalledTimes(2)
  expect(handlers.onFrame.mock.calls[1][1]).toBeGreaterThan(1000)
  stop()
  vi.advanceTimersByTime(1000)
  expect(detectFrame).toHaveBeenCalledTimes(2)
  expect(vi.getTimerCount()).toBe(0)
  expect(tracker.close).not.toHaveBeenCalled() // The creator owns the model lifetime.
})

it('does not schedule another tick when a frame consumer stops the loop', () => {
  const { video, tracker, handlers } = synthetic()
  let stop!: () => void
  handlers.onFrame.mockImplementation(() => stop())
  stop = startPoseTracking({ video, tracker, isCurrent: () => true, ...handlers })
  vi.advanceTimersByTime(100)
  expect(handlers.onFrame).toHaveBeenCalledOnce()
  expect(handlers.onTick).toHaveBeenCalledTimes(1) // First 33 ms precedes initial inference.
  expect(vi.getTimerCount()).toBe(0)
})

it('stops on an inference failure and leaves camera cleanup to its owner', () => {
  const { video, tracker, detectFrame, handlers } = synthetic()
  detectFrame.mockImplementation(() => { throw new Error('Synthetic SDK failure') })
  startPoseTracking({ video, tracker, isCurrent: () => true, ...handlers })
  vi.advanceTimersByTime(2000)
  expect(detectFrame).toHaveBeenCalledOnce()
  expect(handlers.onError).toHaveBeenCalledOnce()
  expect(handlers.onFrameUnavailable).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
  expect(readTrackingDiagnostics()?.active).toBe(false)
})

it('measures inference, consumers and drawing independently without changing legacy pacing', () => {
  const { video, tracker, detectFrame, handlers } = synthetic()
  let elapsedWork = 0
  vi.mocked(performance.now).mockImplementation(() => Date.now() + elapsedWork)
  detectFrame.mockImplementation((_video, timeMs) => {
    elapsedWork += 11
    return { timeMs, videoTimeMs: video.currentTime * 1000, landmarks: [], worldLandmarks: [], width: 640, height: 480, inferenceMs: 10, delegate: 'GPU' }
  })
  handlers.onFrame.mockImplementation(() => { elapsedWork += 7 })
  handlers.onTick.mockImplementation(() => { elapsedWork += 3 })
  const stop = startPoseTracking({ video, tracker, isCurrent: () => true, ...handlers })
  vi.advanceTimersByTime(100)
  video.currentTime = 0.2
  vi.advanceTimersByTime(100)
  const result = readTrackingDiagnostics()!
  expect(result.pacing).toBe('legacy')
  expect(result.frames).toBe(2)
  expect(result.timing.inferenceWallMs.mean).toBe(11)
  expect(result.timing.inferenceReportedMs.mean).toBe(10)
  expect(result.timing.consumerMs.mean).toBe(7)
  expect(result.timing.drawMs.mean).toBe(3)
  expect(result.timing.frameGapMs.count).toBe(1)
  expect(result.timing.requestedIntervalMs.mean).toBeCloseTo(1000 / 30)
  expect(result.timing.schedulingLatenessMs.max).toBe(0)
  stop()
  expect(readTrackingDiagnostics()?.active).toBe(false)
})

it('keeps service pacing as the default and bounds responsive pacing by delegate frame budget', () => {
  expect(inferenceInterval('GPU', 130)).toBe(260)
  expect(inferenceInterval('CPU', 130)).toBe(260)
  expect(inferenceInterval('GPU', 130, 'responsive')).toBe(138)
  expect(inferenceInterval('GPU', 5, 'responsive')).toBe(1000 / 30)
  expect(inferenceInterval('CPU', 5, 'responsive')).toBe(50)
})

it('removes slow-inference doubling only when explicitly opted in and never overlaps calls', () => {
  const run = (pacing: 'legacy' | 'responsive') => {
    vi.setSystemTime(0)
    const { video, tracker, detectFrame, handlers } = synthetic()
    let work = 0
    let insideInference = false
    vi.mocked(performance.now).mockImplementation(() => Date.now() + work)
    detectFrame.mockImplementation((_video, timeMs) => {
      expect(insideInference).toBe(false)
      insideInference = true
      work += 130 // Explicit synthetic inference cost, not a device benchmark.
      video.currentTime += 0.15
      const frame: PoseFrame = { timeMs, videoTimeMs: video.currentTime * 1000, landmarks: [], worldLandmarks: [], width: 640, height: 480, inferenceMs: 130, delegate: 'GPU' }
      insideInference = false
      return frame
    })
    handlers.onFrame.mockImplementation(() => { work += 10 })
    handlers.onTick.mockImplementation(() => { work += 2 })
    const stop = startPoseTracking({ video, tracker, pacing, isCurrent: () => true, ...handlers })
    vi.advanceTimersByTime(1000)
    stop()
    expect(vi.getTimerCount()).toBe(0)
    return readTrackingDiagnostics()!
  }
  const legacy = run('legacy')
  const responsive = run('responsive')
  expect(legacy.timing.frameGapMs.mean).toBeGreaterThan(230)
  expect(responsive.timing.frameGapMs.mean).toBe(150) // 130 inference + 10 consumers + 2 drawing + 8 yield.
  expect(responsive.timing.frameGapMs.mean).toBeLessThan(legacy.timing.frameGapMs.mean * 0.75)
  expect(responsive.timing.requestedIntervalMs.p95).toBe(138)
})

it('does not exceed the responsive frame-rate cap or process duplicate video frames', () => {
  const { video, tracker, detectFrame, handlers } = synthetic()
  const starts: number[] = []
  handlers.onFrame.mockImplementation((frame: PoseFrame) => {
    starts.push(frame.timeMs)
    video.currentTime += 0.04
  })
  const stop = startPoseTracking({ video, tracker, pacing: 'responsive', isCurrent: () => true, ...handlers })
  vi.advanceTimersByTime(1000)
  expect(starts.length).toBeGreaterThan(20)
  expect(starts.length).toBeLessThanOrEqual(30)
  expect(starts.slice(1).every((time, index) => time - starts[index] >= 1000 / 30)).toBe(true)
  handlers.onFrame.mockImplementation(() => {})
  vi.advanceTimersByTime(100)
  const callsAtStall = detectFrame.mock.calls.length
  vi.advanceTimersByTime(500)
  expect(detectFrame).toHaveBeenCalledTimes(callsAtStall)
  stop()
})

it('stops diagnostic collection when the owning camera connection is invalidated', () => {
  const { video, tracker, handlers } = synthetic()
  let current = true
  const stop = startPoseTracking({ video, tracker, pacing: 'responsive', isCurrent: () => current, ...handlers })
  vi.advanceTimersByTime(100)
  current = false
  vi.advanceTimersByTime(100)
  expect(readTrackingDiagnostics()?.active).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
  stop()
})

it('applies live service FPS caps while retaining responsive developer pacing', () => {
  const { video, tracker, handlers } = synthetic()
  const starts: number[] = []
  let maxFps: number | null = 10
  handlers.onFrame.mockImplementation((frame: PoseFrame) => {
    starts.push(frame.timeMs)
    video.currentTime += 0.05
  })
  const stop = startPoseTracking({
    video, tracker, pacing: 'responsive', getMaxFps: () => maxFps,
    isCurrent: () => true, ...handlers,
  })
  vi.advanceTimersByTime(500)
  const slow = starts.slice()
  expect(slow.length).toBeGreaterThan(0)
  expect(slow.slice(1).every((time, index) => time - slow[index] >= 100)).toBe(true)
  maxFps = 20
  vi.advanceTimersByTime(500)
  const fast = starts.slice(slow.length)
  expect(fast.length).toBeGreaterThan(slow.length)
  expect(fast.slice(1).every((time, index) => time - fast[index] >= 50)).toBe(true)
  expect(readTrackingDiagnostics()?.pacing).toBe('responsive')
  expect(inferenceInterval('GPU', 5, 'responsive', null)).toBe(1000 / 30)
  stop()
})
