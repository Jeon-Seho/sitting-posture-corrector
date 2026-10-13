import { afterEach, expect, it, vi } from 'vitest'
import { createPoseTracker } from './detector'
import { POSE_CONFIG } from './config'

const sdk = vi.hoisted(() => ({ resolve: vi.fn(), create: vi.fn() }))
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: sdk.resolve },
  PoseLandmarker: { createFromOptions: sdk.create },
}))
afterEach(() => { vi.restoreAllMocks(); sdk.resolve.mockReset(); sdk.create.mockReset() })

it('exposes a raw-frame tracker without leaking SDK types or reused buffers', async () => {
  sdk.resolve.mockResolvedValue({})
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }))
  const close = vi.fn()
  sdk.create.mockResolvedValue({ close, detectForVideo: vi.fn(() => ({ landmarks: [points], worldLandmarks: [] })) })
  const tracker = await createPoseTracker(() => true)
  const video = { currentTime: 1.25, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement
  const frame = tracker!.detectFrame(video, 5000)
  expect(frame).toMatchObject({ timeMs: 5000, videoTimeMs: 1250, width: 640, height: 480, delegate: 'GPU' })
  expect(frame.landmarks).toHaveLength(13)
  expect(frame.worldLandmarks).toEqual([])
  expect(frame).not.toHaveProperty('features')
  expect(sdk.create.mock.calls[0][1].baseOptions.modelAssetPath).toBe(POSE_CONFIG.modelAssetPath)
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
