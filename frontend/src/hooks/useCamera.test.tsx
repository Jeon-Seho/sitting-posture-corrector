import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { Landmark } from '../../../model/prototype/pose'
import { useCamera } from './useCamera'
import { readTrackingDiagnostics } from '../features/mediapipe/trackingDiagnostics'

const vision = vi.hoisted(() => ({ resolve: vi.fn(), create: vi.fn(), draw: vi.fn() }))
const archive = vi.hoisted(() => ({ save: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../features/camera/baselineArchive', async (original) => ({
  ...await original<typeof import('../features/camera/baselineArchive')>(), saveBaseline: archive.save,
}))
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
    archive.save.mockClear()
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

  it('archives completed calibration only, with independent raw samples and an assumed label', async () => {
    await connect()
    act(() => camera.calibrate())
    act(() => { vi.advanceTimersByTime(1000) })
    act(() => camera.cancelCalibration())
    expect(archive.save).not.toHaveBeenCalled()
    calibrate()
    expect(archive.save).toHaveBeenCalledTimes(1)
    const record = archive.save.mock.calls[0][0]
    expect(record.calibration_id).toBe(camera.calibrationId)
    expect(record.frames).toHaveLength(camera.calibrationSummary!.sampleCount)
    expect(record.label).toBe('baseline_posture')
    expect(record.ground_truth_verified).toBe(false)
    expect(record.frames.every((frame: { landmarks: unknown[] }) => frame.landmarks.length === 13)).toBe(true)
    points[0].x = 0.9
    expect(record.frames[0].landmarks[0].x).toBe(0.5)
    act(() => camera.stop())
    expect(archive.save).toHaveBeenCalledTimes(1)
  })

  it('drops interrupted calibration samples before saving the restarted baseline', async () => {
    await connect()
    act(() => camera.calibrate())
    act(() => { vi.advanceTimersByTime(1000) })
    points[0].visibility = 0.1
    act(() => { vi.advanceTimersByTime(100) })
    points[0].visibility = 0.95
    act(() => { vi.advanceTimersByTime(3200) })
    const record = archive.save.mock.calls[0][0]
    expect(record.frames).toHaveLength(camera.calibrationSummary!.sampleCount)
    expect(record.frames[0].timeMs).toBeGreaterThan(1100)
  })

  it('shares only raw face and shoulder coordinates, preserving poor-quality observations', async () => {
    const world = points.map((p) => ({ ...p, x: p.x * 2 }))
    detect.mockImplementation(() => ({ landmarks: [points], worldLandmarks: [world] }))
    const listener = vi.fn()
    camera.subscribe(listener)
    await connect()
    let observation = listener.mock.calls.at(-1)![0]
    expect(observation.landmarks).toEqual(points.slice(0, 13))
    expect(observation.worldLandmarks).toEqual(world.slice(0, 13))
    expect(observation.features).not.toBeNull()
    points[0].visibility = 0.1
    act(() => {
      vi.advanceTimersByTime(100)
    })
    observation = listener.mock.calls.at(-1)![0]
    expect(observation.features).toBeNull()
    expect(observation.landmarks).toHaveLength(13)
    expect(observation.landmarks[0].visibility).toBe(0.1)
    expect(points).toHaveLength(33)
  })

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
  it('keeps the registered baseline when the camera is turned off and on again', async () => {
    await connect()
    calibrate()
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
    calibrate()
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
  it('forwards developer model, delegate and pacing options and restores service defaults on reconnect', async () => {
    await act(async () => { await camera.connect('synthetic-device', { variant: 'full', delegate: 'CPU', pacing: 'responsive' }) })
    expect(vision.create.mock.calls[0][1].baseOptions).toEqual({ modelAssetPath: '/mediapipe/pose_landmarker_full.task', delegate: 'CPU' })
    expect(camera.trackerDiagnostics).toMatchObject({ variant: 'full', requestedDelegate: 'CPU', actualDelegate: 'CPU', fallbackReason: null })
    expect(readTrackingDiagnostics()).toMatchObject({ active: true, pacing: 'responsive', delegate: 'CPU' })
    act(() => camera.stop())
    expect(readTrackingDiagnostics()?.active).toBe(false)
    await act(async () => { await camera.connect() })
    expect(vision.create.mock.calls[1][1].baseOptions).toEqual({ modelAssetPath: '/mediapipe/pose_landmarker_heavy.task', delegate: 'GPU' })
    expect(camera.trackerDiagnostics).toMatchObject({ variant: 'heavy', requestedDelegate: 'auto', actualDelegate: 'GPU' })
    expect(readTrackingDiagnostics()).toMatchObject({ pacing: 'legacy', delegate: 'GPU' })
  })
  it('reports an explicit GPU failure without silently starting a CPU camera', async () => {
    vision.create.mockRejectedValueOnce(new Error('Synthetic strict GPU failure'))
    await act(async () => { await camera.connect(undefined, { variant: 'lite', delegate: 'GPU' }) })
    expect(vision.create).toHaveBeenCalledOnce()
    expect(camera.state).toBe('error')
    expect(camera.trackerDiagnostics).toBeNull()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(detect).not.toHaveBeenCalled()
  })
})
