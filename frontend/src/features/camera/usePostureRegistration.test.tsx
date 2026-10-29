import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { Landmark } from '../../../../model/prototype/pose'
import { useCamera } from '../../hooks/useCamera'
import { usePostureRegistration } from './usePostureRegistration'
import {
  installFakeBaselineServer,
  removeFakeBaselineServer,
  type FakeBaselineServer,
} from '../baseline/fakeBaselineServer'

const vision = vi.hoisted(() => ({ resolve: vi.fn(), create: vi.fn(), draw: vi.fn() }))
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vision.resolve },
  PoseLandmarker: { createFromOptions: vision.create },
}))
vi.mock('../../lib/poseVisual', () => ({ drawPose: vision.draw }))

/** The real camera hook and frame loop with a fake detector (synthetic landmarks only). */
describe('posture registration with the real camera hook', () => {
  let renderer: ReactTestRenderer | undefined
  let camera: ReturnType<typeof useCamera>
  let flow: ReturnType<typeof usePostureRegistration>
  let points: Landmark[]
  let server: FakeBaselineServer
  function Probe() {
    camera = useCamera()
    flow = usePostureRegistration(camera, false)
    return null
  }
  const advance = (ms: number) => {
    for (let left = ms; left > 0; left -= 50)
      act(() => {
        vi.advanceTimersByTime(Math.min(50, left))
      })
  }
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
    points = Array.from({ length: 33 }, (_, i) => ({
      x: i === 11 ? 0.3 : i === 12 ? 0.7 : 0.5,
      y: i === 0 ? 0.25 : 0.5,
      z: 0,
      visibility: 0.95,
    }))
    const track = { stop: vi.fn(), getSettings: () => ({ deviceId: 'synthetic-device' }) }
    const incoming = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream
    vision.resolve.mockReset().mockResolvedValue({})
    vision.create
      .mockReset()
      .mockResolvedValue({ close: vi.fn(), detectForVideo: vi.fn(() => ({ landmarks: [points], worldLandmarks: [] })) })
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(incoming), enumerateDevices: vi.fn().mockResolvedValue([]) },
    })
    server = installFakeBaselineServer()
    act(() => {
      renderer = create(<Probe />)
    })
    Object.assign(camera.videoRef, {
      current: {
        srcObject: null,
        readyState: 2,
        videoWidth: 640,
        videoHeight: 480,
        get currentTime() {
          return Date.now() / 1000
        },
        play: vi.fn().mockResolvedValue(undefined),
      },
    })
    await act(async () => {
      await camera.connect()
    })
    // The registration page arms the flow once B2 said nothing is registered (SetupPage).
    expect(camera.baselineLoading).toBe(false)
    expect(camera.baseline).toBeNull()
    act(() => flow.start())
  })
  afterEach(() => {
    removeFakeBaselineServer()
    act(() => renderer?.unmount())
    renderer = undefined
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const settle = async () => {
    await act(async () => {
      await Promise.resolve()
    })
  }

  it('counts down, captures, saves on the server and ends by itself with a steady pose', async () => {
    advance(300)
    expect(flow.phase).toBe('countdown')
    advance(3000)
    expect(flow.phase).toBe('capturing')
    advance(3600)
    expect(flow.phase).toBe('saving')
    await settle()
    expect(server.posts).toHaveLength(1)
    expect(camera.baseline).not.toBeNull()
    expect(camera.progress).toBeNull()
    expect(flow.phase).toBe('done')
    advance(10000)
    expect(flow.phase).toBe('done')
    expect(camera.progress).toBeNull()
  })

  it('gives up instead of looping when the pose keeps becoming unmeasurable', () => {
    advance(3400)
    expect(flow.phase).toBe('capturing')
    // Every other frame loses the nose: the capture keeps restarting from zero.
    let flip = false
    const steady = points
    const broken = points.map((p, i) => (i === 0 ? { ...p, visibility: 0.1 } : p))
    for (let t = 0; t < 16000; t += 100) {
      flip = !flip
      points = flip ? broken : steady
      advance(100)
    }
    expect(flow.phase).toBe('failed')
    expect(camera.progress).toBeNull()
  })

  it('says why the server did not save the posture', async () => {
    server.failWith.push(503, 503, 503, 503)
    advance(6900)
    expect(flow.phase).toBe('saving')
    // Retried at 1·2·4 s with the same body, then explained.
    for (const ms of [1000, 2000, 4000, 0]) {
      await settle()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
      })
    }
    expect(server.posts).toHaveLength(0)
    expect(flow.phase).toBe('failed')
    expect(flow.error).toBe('서버가 다른 작업을 처리하고 있어요. 잠시 뒤 다시 등록해 주세요.')
    expect(camera.baseline).toBeNull()
  })
})
