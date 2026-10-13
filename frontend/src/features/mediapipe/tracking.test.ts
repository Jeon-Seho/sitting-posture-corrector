import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { startPoseTracking } from './tracking'
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
})
