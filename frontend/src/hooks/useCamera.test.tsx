import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { Landmark } from '../../../model/prototype/pose'
import { useCamera } from './useCamera'
import {
  installFakeBaselineServer,
  removeFakeBaselineServer,
  type FakeBaselineServer,
} from '../features/baseline/fakeBaselineServer'

const vision = vi.hoisted(() => ({ resolve: vi.fn(), create: vi.fn(), draw: vi.fn() }))
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vision.resolve },
  PoseLandmarker: { createFromOptions: vision.create },
}))
vi.mock('../lib/poseVisual', () => ({ drawPose: vision.draw }))

describe('camera lifecycle with fake tracks and synthetic landmarks only', () => {
  let renderer: ReactTestRenderer | undefined
  let camera: ReturnType<typeof useCamera>
  let server: FakeBaselineServer
  let points: Landmark[],
    track: {
      stop: ReturnType<typeof vi.fn>
      getSettings: () => { deviceId: string }
      onended?: () => void
    }
  let incoming: MediaStream
  let getUserMedia: ReturnType<typeof vi.fn>,
    close: ReturnType<typeof vi.fn>,
    detect: ReturnType<typeof vi.fn>
  const defer = <T,>() => {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((done) => {
      resolve = done
    })
    return { promise, resolve }
  }
  function Probe() {
    camera = useCamera()
    return null
  }
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
    points = Array.from({ length: 33 }, (_, i) => ({
      x: i === 11 ? 0.3 : i === 12 ? 0.7 : 0.5,
      y: i === 0 ? 0.25 : 0.5,
      z: 0,
      visibility: 0.95,
    }))
    track = { stop: vi.fn(), getSettings: () => ({ deviceId: 'synthetic-device' }) }
    incoming = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream
    getUserMedia = vi.fn().mockResolvedValue(incoming)
    close = vi.fn()
    detect = vi.fn(() => ({ landmarks: [points], worldLandmarks: [] }))
    vision.resolve.mockReset().mockResolvedValue({})
    vision.create.mockReset().mockResolvedValue({ close, detectForVideo: detect })
    vision.draw.mockClear()
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) },
    })
    server = installFakeBaselineServer()
    act(() => {
      renderer = create(<Probe />)
    })
    Object.assign(camera!.videoRef, {
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
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = undefined
    removeFakeBaselineServer()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  const connect = async () => {
    await act(async () => {
      await camera.connect()
    })
    act(() => {
      vi.advanceTimersByTime(100)
    })
  }
  /** Lets the fake B1 answer and the hook apply it. */
  const settle = async () => {
    await act(async () => {
      await Promise.resolve()
    })
  }
  const calibrate = async () => {
    act(() => camera.calibrate())
    act(() => {
      vi.advanceTimersByTime(5200)
    })
    await settle()
  }

  it('keeps the previous baseline during recalibration and restores it on cancel or poor quality', async () => {
    await connect()
    await calibrate()
    const previous = camera.baseline,
      id = camera.calibrationId
    expect(previous).not.toBeNull()
    act(() => camera.calibrate())
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(camera.baseline).toBe(previous)
    expect(camera.progress).not.toBeNull()
    points[11].visibility = 0.1
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(camera.progress).toBe(0)
    expect(camera.baseline).toBe(previous)
    act(() => camera.cancelCalibration())
    expect(camera.progress).toBeNull()
    expect(camera.baseline).toBe(previous)
    expect(camera.calibrationId).toBe(id)
  })
  it('replaces the baseline only after all continuous valid observations are collected', async () => {
    await connect()
    await calibrate()
    const previous = camera.baseline,
      id = camera.calibrationId
    points[0].y = 0.3
    act(() => camera.calibrate())
    act(() => {
      vi.advanceTimersByTime(2900)
    })
    expect(camera.baseline).toBe(previous)
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(camera.progress).toBeNull()
    expect(camera.registering).toBe(true)
    await settle()
    expect(camera.registering).toBe(false)
    expect(camera.baseline).not.toEqual(previous)
    expect(camera.calibrationId).not.toBe(id)
    // B1 gets the mean of the 9 joints (2026-10-20 team meeting), not the app's features.
    const sent = server.posts.at(-1)!
    expect(sent.calibration_ms).toBeGreaterThanOrEqual(3000)
    expect(sent.sample_count).toBeGreaterThanOrEqual(20)
    expect(Object.keys(sent.landmarks as object)).toHaveLength(9)
    expect((sent.landmarks as Record<string, { x: number; y: number }>).nose).toEqual({ x: 0.5, y: 0.3 })
  })
  it('explains a registration the server did not save and keeps the previous posture', async () => {
    await connect()
    await calibrate()
    const previous = camera.calibrationId
    // Still 401 after the token was renewed once (api.ts): the login is over.
    server.failWith.push(401, 401)
    await calibrate()
    expect(camera.registrationError).toBe('로그인이 필요해요. 다시 로그인한 뒤 등록해 주세요.')
    expect(camera.calibrationId).toBe(previous)
    act(() => camera.calibrate())
    expect(camera.registrationError).toBeNull()
  })
  it('does not send a posture whose mean is out of the frame', async () => {
    await connect()
    const before = server.posts.length
    points[7].x = -0.2
    await calibrate()
    expect(camera.registrationError).toBe('얼굴과 양쪽 어깨가 화면 안에 들어오게 앉은 뒤 다시 등록해 주세요.')
    expect(server.posts).toHaveLength(before)
    expect(camera.progress).toBeNull()
  })
  it('loads the registered posture from the server instead of this PC', async () => {
    await connect()
    await calibrate()
    const id = camera.calibrationId
    act(() => renderer?.unmount())
    act(() => {
      renderer = create(<Probe />)
    })
    expect(camera.calibrationId).toBeNull()
    await settle()
    expect(camera.calibrationId).toBe(id)
    expect(camera.baseline).not.toBeNull()
  })
  it('says when the registered posture could not be loaded and clears it on a successful reload', async () => {
    await connect()
    await calibrate()
    const id = camera.calibrationId
    act(() => renderer?.unmount())
    server.failCurrent.push(0)
    act(() => {
      renderer = create(<Probe />)
    })
    await settle()
    expect(camera.baselineLoading).toBe(false)
    expect(camera.baseline).toBeNull()
    expect(camera.baselineError).toBe('서버에 연결하지 못했어요. 연결을 확인한 뒤 다시 불러와 주세요.')
    await act(async () => {
      await camera.reloadBaseline()
    })
    expect(camera.baselineError).toBeNull()
    expect(camera.calibrationId).toBe(id)
  })
  it('cancels pending permission requests and stops late-arriving tracks', async () => {
    const request = defer<MediaStream>()
    getUserMedia.mockReturnValueOnce(request.promise)
    let pending!: Promise<void>
    await act(async () => {
      pending = camera.connect()
    })
    expect(camera.state).toBe('loading')
    act(() => camera.stop())
    await act(async () => {
      request.resolve(incoming)
      await pending
    })
    expect(camera.state).toBe('off')
    expect(track.stop).toHaveBeenCalledOnce()
    expect(vision.create).not.toHaveBeenCalled()
  })
  it('ends an excessive preparation wait and releases late tracks without reconnecting automatically', async () => {
    const request = defer<MediaStream>()
    getUserMedia.mockReturnValueOnce(request.promise)
    let pending!: Promise<void>
    await act(async () => {
      pending = camera.connect()
    })
    act(() => {
      vi.advanceTimersByTime(30001)
    })
    expect(camera.state).toBe('error')
    expect(camera.error).toContain('오래')
    await act(async () => {
      request.resolve(incoming)
      await pending
    })
    expect(track.stop).toHaveBeenCalledOnce()
    expect(camera.state).toBe('error')
  })
  it('closes a model that finishes loading after the connection was canceled', async () => {
    const request = defer<unknown>()
    vision.create.mockReturnValueOnce(request.promise)
    let pending!: Promise<void>
    await act(async () => {
      pending = camera.connect()
      await Promise.resolve()
    })
    expect(vision.create).toHaveBeenCalled()
    act(() => camera.stop())
    await act(async () => {
      request.resolve({ close, detectForVideo: detect })
      await pending
    })
    expect(close).toHaveBeenCalledOnce()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(camera.state).toBe('off')
  })
  it('does not adopt a loaded model if cancellation arrives before the hook resumes', async () => {
    vision.create.mockImplementationOnce(() => {
      // Cancel after the loader checks its token, before its caller resumes.
      Promise.resolve().then(() => {
        Promise.resolve().then(() => camera.stop())
      })
      return Promise.resolve({ close, detectForVideo: detect })
    })
    await act(async () => {
      await camera.connect()
    })
    expect(camera.state).toBe('off')
    expect(camera.videoRef.current?.srcObject).toBeNull()
    expect(close).toHaveBeenCalledOnce()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(detect).not.toHaveBeenCalled()
  })
  it('keeps the registered baseline when the camera is turned off and on again', async () => {
    await connect()
    await calibrate()
    const registered = camera.baseline,
      id = camera.calibrationId
    expect(registered).not.toBeNull()
    act(() => camera.stop())
    expect(camera.state).toBe('off')
    await connect()
    expect(camera.baseline).toBe(registered)
    expect(camera.calibrationId).toBe(id)
  })
  it('falls back to CPU and keeps the registered baseline on disconnection', async () => {
    vision.create.mockRejectedValueOnce(new Error('Synthetic GPU unavailable'))
    await connect()
    await calibrate()
    expect(vision.create.mock.calls[1][1].baseOptions.delegate).toBe('CPU')
    act(() => track.onended?.())
    expect(camera.state).toBe('error')
    expect(camera.quality).toBe(false)
    expect(camera.baseline).not.toBeNull()
    expect(camera.calibrationId).not.toBeNull()
    expect(close).toHaveBeenCalledOnce()
  })
  it('reports tracking failures and releases resources', async () => {
    await connect()
    detect.mockImplementationOnce(() => {
      throw new Error('Synthetic inference failure')
    })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(camera.state).toBe('error')
    expect(camera.error).toContain('추적')
    expect(track.stop).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })
})
