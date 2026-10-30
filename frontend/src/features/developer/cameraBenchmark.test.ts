import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { PoseFrame, PoseTracker, PoseTrackerOptions } from '../mediapipe'
import { benchmarkStats, BENCHMARK_CONFIGURATIONS, runCameraBenchmark } from './cameraBenchmark'

const mocks = vi.hoisted(() => ({ create: vi.fn(), request: vi.fn() }))
vi.mock('../mediapipe', () => ({ createPoseTracker: mocks.create }))
vi.mock('../camera/devices', async importOriginal => ({
  ...await importOriginal<typeof import('../camera/devices')>(), requestCamera: mocks.request,
}))

let processingMs = 0
let active = true
let stop: ReturnType<typeof vi.fn>
let video: { muted: boolean; playsInline: boolean; videoWidth: number; videoHeight: number; srcObject: unknown; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> }
let canvases: { width: number; height: number; getContext: ReturnType<typeof vi.fn> }[]
let trackers: { close: ReturnType<typeof vi.fn>; detectFrame: ReturnType<typeof vi.fn> }[]

/** Explicit synthetic points; no participant pixels or coordinates are fixtures. */
function syntheticFrame(valid: boolean, timeMs: number, delegate: 'CPU' | 'GPU'): PoseFrame {
  const image = Array.from({ length: 13 }, () => ({ x: .5, y: .5, z: 0, visibility: valid ? .9 : .1 }))
  const world = Array.from({ length: 13 }, (_, i) => ({ x: i === 11 ? -.2 : i === 12 ? .2 : 0, y: 0, z: 0, visibility: .9 }))
  return { landmarks: image, worldLandmarks: world, timeMs, videoTimeMs: timeMs, width: 640, height: 480, delegate, inferenceMs: 10 }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-14T00:00:00Z'))
  processingMs = 0; active = true; canvases = []; trackers = []
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now() + processingMs)
  stop = vi.fn()
  mocks.request.mockResolvedValue({ getTracks: () => [{ stop }] })
  video = { muted: false, playsInline: false, videoWidth: 640, videoHeight: 480, srcObject: null, play: vi.fn(async () => {}), pause: vi.fn() }
  Object.defineProperty(video, 'currentTime', { configurable: true, get: () => Date.now() / 1000 })
  vi.stubGlobal('document', {
    hidden: false, visibilityState: 'visible',
    createElement: (kind: string) => {
      if (kind === 'video') return video
      const canvas = { width: 0, height: 0, getContext: vi.fn(() => ({ drawImage: vi.fn() })) }
      canvases.push(canvas); return canvas
    },
  })
  vi.stubGlobal('navigator', { userAgent: 'explicit-synthetic-benchmark-test' })
  mocks.create.mockImplementation(async (_isCurrent: () => boolean, options: PoseTrackerOptions): Promise<PoseTracker> => {
    let call = 0
    const tracker = {
      delegate: options.delegate as 'CPU' | 'GPU', close: vi.fn(),
      diagnostics: { variant: options.variant!, modelId: 'explicit-synthetic-model', requestedDelegate: options.delegate!, actualDelegate: options.delegate as 'CPU' | 'GPU', initializationMs: 5, fallbackReason: null },
      detectFrame: vi.fn((_canvas: HTMLCanvasElement, timeMs: number) => {
        processingMs += call < 4 ? 100 : 10
        // Invalid image quality is excluded by the real forecast input validator.
        const valid = call < 4 || (call - 4) % 8 !== 0
        call++
        return syntheticFrame(valid, timeMs, options.delegate as 'CPU' | 'GPU')
      }),
    }
    trackers.push(tracker); return tracker
  })
})
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  mocks.create.mockReset(); mocks.request.mockReset()
})

it('computes nearest-rank percentiles from finite measurements without mutating samples', () => {
  const samples = [5, NaN, 1, 100, 3, Infinity]
  expect(benchmarkStats(samples)).toEqual({ count: 4, mean: 27.25, p50: 3, p95: 100, max: 100 })
  expect(samples).toEqual([5, NaN, 1, 100, 3, Infinity])
  expect(benchmarkStats([])).toEqual({ count: 0, mean: 0, p50: 0, p95: 0, max: 0 })
})

it('replays identical memory frames to all six strict configurations in reverse second-round order', async () => {
  const pending = runCameraBenchmark({ isCurrent: () => active, onProgress: vi.fn(), deviceId: 'synthetic-camera' })
  await vi.runAllTimersAsync()
  const report = await pending
  expect(mocks.request).toHaveBeenCalledWith('synthetic-camera')
  expect(mocks.create.mock.calls.map(call => call[1])).toEqual([...BENCHMARK_CONFIGURATIONS, ...[...BENCHMARK_CONFIGURATIONS].reverse()])
  expect(report.results).toHaveLength(12)
  expect(report).toMatchObject({ width: 640, height: 480, captureFrames: 24, rounds: 2, warmupFrames: 4 })
  for (const [index, result] of report.results.entries()) {
    expect(result.inference).toEqual({ count: 24, mean: 10, p50: 10, p95: 10, max: 10 })
    expect(result).toMatchObject({ frames: 24, validFrames: 21, validRate: 21 / 24, error: null })
    expect(trackers[index].detectFrame.mock.calls.map(call => call[0])).toEqual([...Array(4).fill(canvases[0]), ...canvases])
    const times = trackers[index].detectFrame.mock.calls.map(call => call[1] as number)
    expect(times.every((time, i) => i === 0 || time > times[i - 1])).toBe(true)
    expect(trackers[index].close).toHaveBeenCalledOnce()
  }
  expect(stop).toHaveBeenCalledOnce()
  expect(video.srcObject).toBeNull()
  expect(video.pause).toHaveBeenCalledOnce()
  expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true)
  // No report field retains pixels, model inputs or landmarks.
  expect(JSON.stringify(report)).not.toMatch(/"(?:landmarks|worldLandmarks|srcObject|getContext|imageData)"/)
})

it('retains explicit GPU failures as failures and still measures the other configurations', async () => {
  mocks.create.mockRejectedValueOnce(new Error('Synthetic GPU unavailable'))
  const pending = runCameraBenchmark({ isCurrent: () => active, onProgress: vi.fn() })
  await vi.runAllTimersAsync()
  const report = await pending
  expect(report.results[0]).toMatchObject({ variant: 'lite', delegate: 'GPU', frames: 0, error: 'Synthetic GPU unavailable' })
  expect(report.results[1]).toMatchObject({ variant: 'lite', delegate: 'CPU', frames: 24, error: null })
  expect(mocks.create).toHaveBeenCalledTimes(12)
  expect(trackers).toHaveLength(11)
  expect(trackers.every(tracker => tracker.close.mock.calls.length === 1)).toBe(true)
})

it('releases the camera and captured pixels when canceled during capture', async () => {
  const pending = runCameraBenchmark({ isCurrent: () => active, onProgress: (message: string) => {
    if (message.includes('3/24')) active = false
  } })
  const rejected = expect(pending).rejects.toThrow('중단')
  await vi.runAllTimersAsync(); await rejected
  expect(mocks.create).not.toHaveBeenCalled()
  expect(stop).toHaveBeenCalledOnce()
  expect(video.srcObject).toBeNull()
  expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true)
})

it('closes a tracker when cancellation occurs immediately after model creation', async () => {
  const close = vi.fn()
  mocks.create.mockImplementationOnce(async () => { active = false; return { close } })
  const pending = runCameraBenchmark({ isCurrent: () => active, onProgress: vi.fn() })
  const rejected = expect(pending).rejects.toThrow('중단')
  await vi.runAllTimersAsync(); await rejected
  expect(close).toHaveBeenCalledOnce()
  expect(stop).toHaveBeenCalledOnce()
  expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true)
})

it('releases a camera whose video playback fails', async () => {
  video.play.mockRejectedValueOnce(new Error('Synthetic playback failure'))
  await expect(runCameraBenchmark({ isCurrent: () => active, onProgress: vi.fn() })).rejects.toThrow('playback failure')
  expect(stop).toHaveBeenCalledOnce()
  expect(video.srcObject).toBeNull()
  expect(mocks.create).not.toHaveBeenCalled()
})

it('does not request hardware when already canceled or hidden', async () => {
  active = false
  await expect(runCameraBenchmark({ isCurrent: () => active, onProgress: vi.fn() })).rejects.toThrow('중단')
  active = true
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
  await expect(runCameraBenchmark({ isCurrent: () => active, onProgress: vi.fn() })).rejects.toThrow('숨겨져')
  expect(mocks.request).not.toHaveBeenCalled()
})

it('aborts a frozen camera instead of comparing duplicate frames as a healthy sample', async () => {
  Object.defineProperty(video, 'currentTime', { get: () => 1 })
  const pending = runCameraBenchmark({ isCurrent: () => active, onProgress: vi.fn() })
  const rejected = expect(pending).rejects.toThrow('프레임이 멈춰')
  await vi.runAllTimersAsync(); await rejected
  expect(canvases).toHaveLength(1)
  expect(canvases[0]).toMatchObject({ width: 0, height: 0 })
  expect(stop).toHaveBeenCalledOnce()
  expect(mocks.create).not.toHaveBeenCalled()
})
