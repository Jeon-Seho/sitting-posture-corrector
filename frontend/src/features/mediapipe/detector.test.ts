import { afterEach, expect, it, vi } from 'vitest'
import { createPoseTracker } from './detector'
import { POSE_CONFIG, POSE_MODELS } from './config'

const sdk = vi.hoisted(() => ({ resolve: vi.fn(), create: vi.fn() }))
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: sdk.resolve },
  PoseLandmarker: { createFromOptions: sdk.create },
}))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); sdk.resolve.mockReset(); sdk.create.mockReset() })

it('exposes a raw-frame tracker without leaking SDK types or reused buffers', async () => {
  sdk.resolve.mockResolvedValue({})
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }))
  const close = vi.fn()
  sdk.create.mockResolvedValue({ close, detectForVideo: vi.fn(() => ({ landmarks: [points], worldLandmarks: [] })) })
  const tracker = await createPoseTracker(() => true)
  const video = { currentTime: 1.25, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement
  const frame = tracker!.detectFrame(video, 5000)
  expect(frame).toMatchObject({ timeMs: 5000, videoTimeMs: 1250, width: 640, height: 480, delegate: 'GPU', poseModelId: POSE_MODELS.heavy.modelId })
  expect(frame.landmarks).toHaveLength(13)
  expect(frame.worldLandmarks).toEqual([])
  expect(frame).not.toHaveProperty('features')
  expect(sdk.create.mock.calls[0][1].baseOptions.modelAssetPath).toBe(POSE_CONFIG.modelAssetPath)
  expect(tracker?.diagnostics).toMatchObject({ variant: 'heavy', requestedDelegate: 'auto', actualDelegate: 'GPU', fallbackReason: null })
  points[0].x = 0.1
  expect(frame.landmarks[0].x).toBe(0.5)
  tracker!.close()
  expect(close).toHaveBeenCalledOnce()
})

it('does not start a CPU retry when a failed GPU request was canceled', async () => {
  sdk.resolve.mockResolvedValue({})
  let reject!: (error: Error) => void
  sdk.create.mockImplementation(() => new Promise((_, failed) => { reject = failed }))
  let active = true
  const pending = createPoseTracker(() => active)
  await Promise.resolve()
  active = false
  reject(new Error('Synthetic GPU failure after cancel'))
  expect(await pending).toBeNull()
  expect(sdk.create).toHaveBeenCalledOnce()
})

it.each(['lite', 'full', 'heavy'] as const)('uses the pinned %s model with an explicit CPU request', async variant => {
  sdk.resolve.mockResolvedValue({})
  sdk.create.mockResolvedValue({ close: vi.fn() })
  const tracker = await createPoseTracker(() => true, { variant, delegate: 'CPU' })
  expect(sdk.create).toHaveBeenCalledOnce()
  expect(sdk.create.mock.calls[0][1].baseOptions).toEqual({
    modelAssetPath: `/mediapipe/${POSE_MODELS[variant].filename}`, delegate: 'CPU',
  })
  expect(tracker?.diagnostics).toMatchObject({ variant, modelId: POSE_MODELS[variant].modelId, requestedDelegate: 'CPU', actualDelegate: 'CPU' })
})

it('records automatic GPU failure and the actual CPU delegate', async () => {
  sdk.resolve.mockResolvedValue({})
  sdk.create.mockRejectedValueOnce(new Error('Synthetic unavailable WebGL')).mockResolvedValueOnce({ close: vi.fn() })
  const tracker = await createPoseTracker(() => true, { variant: 'full' })
  expect(sdk.create).toHaveBeenCalledTimes(2)
  expect(tracker?.diagnostics).toMatchObject({ requestedDelegate: 'auto', actualDelegate: 'CPU', fallbackReason: 'Synthetic unavailable WebGL' })
  expect(tracker?.delegate).toBe('CPU')
  expect(sdk.create.mock.calls[1][1].baseOptions.delegate).toBe('CPU')
})

it.each(['GPU', 'CPU'] as const)('never silently changes an explicit %s benchmark delegate', async delegate => {
  sdk.resolve.mockResolvedValue({})
  sdk.create.mockRejectedValue(new Error('Synthetic delegate unavailable'))
  await expect(createPoseTracker(() => true, { variant: 'lite', delegate })).rejects.toThrow('Synthetic delegate unavailable')
  expect(sdk.create).toHaveBeenCalledOnce()
})

it('accepts identical cached canvases with their capture timestamps, without leaking output buffers', async () => {
  sdk.resolve.mockResolvedValue({})
  const points = Array.from({ length: 33 }, () => ({ x: 0.4, y: 0.6, z: -0.2, visibility: 0.8 }))
  const detect = vi.fn(() => ({ landmarks: [points], worldLandmarks: [points] }))
  const close = vi.fn()
  sdk.create.mockResolvedValue({ close, detectForVideo: detect })
  const tracker = (await createPoseTracker(() => true, { delegate: 'GPU' }))!
  const canvas = { width: 640, height: 480 } as HTMLCanvasElement
  const result = tracker.detectFrame(canvas, 4000, 250)
  expect(detect).toHaveBeenCalledWith(canvas, 250)
  expect(result).toMatchObject({ timeMs: 4000, videoTimeMs: 250, width: 640, height: 480 })
  expect(result.landmarks).toHaveLength(13)
  expect(result.worldLandmarks).toHaveLength(13)
  points[0].x = 99
  expect(result.worldLandmarks[0].x).toBe(0.4)
  expect(tracker.detectFrame(canvas, 4100).videoTimeMs).toBe(4100)
  tracker.close()
  tracker.close()
  expect(close).toHaveBeenCalledOnce()
  expect(() => tracker.detectFrame(canvas, 4200)).toThrow('closed')
})

it('uses monotonic captured-frame stamps for SDK smoothing without changing the observation clock', async () => {
  sdk.resolve.mockResolvedValue({})
  const detect = vi.fn((_input: HTMLVideoElement, _stamp: number) => ({ landmarks: [], worldLandmarks: [] }))
  sdk.create.mockResolvedValue({ close: vi.fn(), detectForVideo: detect })
  const tracker = (await createPoseTracker(() => true, { delegate: 'CPU' }))!
  const video = { currentTime: 1.25, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement
  const frames = [tracker.detectFrame(video, 5000)]
  video.currentTime = 1.283
  frames.push(tracker.detectFrame(video, 5100))
  // Repeated or restarted video clocks cannot make SDK time go backwards.
  frames.push(tracker.detectFrame(video, 5300))
  video.currentTime = 0.1
  frames.push(tracker.detectFrame(video, 5400))
  expect(detect.mock.calls.map((call) => call[1])).toEqual([1250, 1283, 1284, 1285])
  expect(frames.map((frame) => frame.timeMs)).toEqual([5000, 5100, 5300, 5400])
  expect(frames.map((frame) => frame.videoTimeMs)).toEqual([1250, 1283, 1283, 100])
  tracker.close()
})

it('closes a late successful detector after cancellation', async () => {
  sdk.resolve.mockResolvedValue({})
  let resolve!: (detector: unknown) => void
  sdk.create.mockImplementation(() => new Promise(ready => { resolve = ready }))
  let active = true
  const pending = createPoseTracker(() => active, { variant: 'lite', delegate: 'GPU' })
  await Promise.resolve()
  active = false
  const close = vi.fn()
  resolve({ close })
  expect(await pending).toBeNull()
  expect(close).toHaveBeenCalledOnce()
})

it('does not resolve assets when already canceled', async () => {
  expect(await createPoseTracker(() => false)).toBeNull()
  expect(sdk.resolve).not.toHaveBeenCalled()
  expect(sdk.create).not.toHaveBeenCalled()
})

it.each([
  ['ANGLE (Apple, Apple M3, OpenGL 4.1)', false],
  ['ANGLE (Google, Vulkan SwiftShader Device)', true],
] as const)('reports the SDK context renderer %s without claiming GPU utilization', async (renderer, softwareRenderer) => {
  const gl = {
    RENDERER: 1, VENDOR: 2, VERSION: 3,
    getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 4, UNMASKED_VENDOR_WEBGL: 5 }),
    getParameter: (key: number) => ({ 4: renderer, 5: 'Synthetic vendor', 3: 'WebGL 2.0' })[key],
  }
  const getContext = vi.fn(() => gl)
  vi.stubGlobal('OffscreenCanvas', class { getContext = getContext })
  sdk.resolve.mockResolvedValue({})
  sdk.create.mockResolvedValue({ close: vi.fn() })
  const tracker = await createPoseTracker(() => true, { delegate: 'GPU' })
  expect(sdk.create.mock.calls[0][1].canvas.getContext).toBe(getContext)
  expect(tracker?.diagnostics?.graphics).toEqual({ renderer, vendor: 'Synthetic vendor', version: 'WebGL 2.0', softwareRenderer })
  expect(getContext).toHaveBeenCalledWith('webgl2')
})

it('keeps GPU diagnostics honest when renderer details are restricted', async () => {
  vi.stubGlobal('OffscreenCanvas', class { getContext() { throw new Error('Synthetic browser restriction') } })
  sdk.resolve.mockResolvedValue({})
  sdk.create.mockResolvedValue({ close: vi.fn() })
  const tracker = await createPoseTracker(() => true, { delegate: 'GPU' })
  expect(tracker?.delegate).toBe('GPU')
  expect(tracker?.diagnostics?.graphics).toBeNull()
})
