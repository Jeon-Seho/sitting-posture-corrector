import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { Landmark } from '../../../model/prototype/pose'
import { useCamera } from './useCamera'

const vision = vi.hoisted(() => ({ resolve: vi.fn(), create: vi.fn(), draw: vi.fn() }))
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vision.resolve },
  PoseLandmarker: { createFromOptions: vision.create },
}))
vi.mock('../lib/poseVisual', () => ({ drawPose: vision.draw }))

describe('camera lifecycle with fake tracks and synthetic landmarks only', () => {
  let renderer: ReactTestRenderer | undefined
  let camera: ReturnType<typeof useCamera>
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
  const calibrate = () => {
    act(() => camera.calibrate())
    act(() => {
      vi.advanceTimersByTime(5200)
    })
  }

  it('keeps the previous baseline during recalibration and restores it on cancel or poor quality', async () => {
    await connect()
    calibrate()
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
    calibrate()
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
    expect(camera.baseline).not.toEqual(previous)
    expect(camera.calibrationId).not.toBe(id)
    expect(camera.progress).toBeNull()
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
  it('falls back to CPU and clears reference identity on disconnection', async () => {
    vision.create.mockRejectedValueOnce(new Error('Synthetic GPU unavailable'))
    await connect()
    calibrate()
    expect(vision.create.mock.calls[1][1].baseOptions.delegate).toBe('CPU')
    act(() => track.onended?.())
    expect(camera.state).toBe('error')
    expect(camera.quality).toBe(false)
    expect(camera.baseline).toBeNull()
    expect(camera.calibrationId).toBeNull()
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
