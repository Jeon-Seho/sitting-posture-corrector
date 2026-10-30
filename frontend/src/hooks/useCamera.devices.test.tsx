import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { Landmark } from '../../../model/prototype/pose'
import { CAMERA_ERRORS } from '../features/camera/errors'
import { useCamera } from './useCamera'
import {
  baselineResponse,
  installFakeBaselineServer,
  removeFakeBaselineServer,
} from '../features/baseline/fakeBaselineServer'

/**
 * Several cameras (built-in + USB) with the behavior as of 2026-10-16, before plan 0053.
 * Fake devices and tracks only; no real camera is opened. Tests marked "plan 0053" record a
 * current gap that the plan changes, so they are expected to be rewritten then.
 */
const vision = vi.hoisted(() => ({ resolve: vi.fn(), create: vi.fn(), draw: vi.fn() }))
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vision.resolve },
  PoseLandmarker: { createFromOptions: vision.create },
}))
vi.mock('../lib/poseVisual', () => ({ drawPose: vision.draw }))

const BUILT_IN = 'built-in-id'
const USB = 'usb-id'
const devices = [
  { kind: 'videoinput', deviceId: BUILT_IN, label: 'Integrated Webcam', groupId: 'a' },
  { kind: 'videoinput', deviceId: USB, label: 'USB Camera', groupId: 'b' },
] as MediaDeviceInfo[]

type FakeTrack = { stop: ReturnType<typeof vi.fn>; getSettings: () => { deviceId: string }; onended?: () => void }

describe('several cameras (synthetic devices only)', () => {
  let renderer: ReactTestRenderer | undefined
  let camera: ReturnType<typeof useCamera>
  let getUserMedia: ReturnType<typeof vi.fn>
  let enumerateDevices: ReturnType<typeof vi.fn>
  let listeners: Record<string, () => void>
  let store: Map<string, string>
  let tracks: FakeTrack[]
  let size = { width: 640, height: 480 }
  const points: Landmark[] = Array.from({ length: 33 }, (_, i) => ({
    x: i === 11 ? 0.3 : i === 12 ? 0.7 : 0.5,
    y: i === 0 ? 0.25 : 0.5,
    z: 0,
    visibility: 0.95,
  }))

  /** The OS default (no deviceId) is the built-in camera, as on most laptops. */
  const open = (constraints: MediaStreamConstraints) => {
    const video = constraints.video as MediaTrackConstraints
    const wanted = (video.deviceId as { exact?: string } | undefined)?.exact
    if (wanted && !devices.some((d) => d.deviceId === wanted)) {
      return Promise.reject(Object.assign(new Error('gone'), { name: 'OverconstrainedError' }))
    }
    const track: FakeTrack = { stop: vi.fn(), getSettings: () => ({ deviceId: wanted ?? BUILT_IN }) }
    tracks.push(track)
    return Promise.resolve({ getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream)
  }
  const requested = () =>
    getUserMedia.mock.calls.map(([c]) => ((c.video as MediaTrackConstraints).deviceId as { exact?: string })?.exact ?? 'default')

  function Probe() {
    camera = useCamera()
    return null
  }
  const mount = () => {
    act(() => {
      renderer = create(<Probe />)
    })
    Object.assign(camera!.videoRef, {
      current: {
        srcObject: null,
        readyState: 2,
        get videoWidth() {
          return size.width
        },
        get videoHeight() {
          return size.height
        },
        get currentTime() {
          return Date.now() / 1000
        },
        play: vi.fn().mockResolvedValue(undefined),
      },
    })
  }
  const connect = async (id?: string) => {
    await act(async () => {
      await camera.connect(id)
    })
    act(() => {
      vi.advanceTimersByTime(100)
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
    size = { width: 640, height: 480 }
    tracks = []
    listeners = {}
    store = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
    getUserMedia = vi.fn(open)
    enumerateDevices = vi.fn().mockResolvedValue(devices)
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia,
        enumerateDevices,
        addEventListener: (type: string, fn: () => void) => void (listeners[type] = fn),
        removeEventListener: (type: string) => void delete listeners[type],
      },
    })
    vision.resolve.mockReset().mockResolvedValue({})
    vision.create.mockReset().mockResolvedValue({
      close: vi.fn(),
      detectForVideo: vi.fn(() => ({ landmarks: [points], worldLandmarks: [] })),
    })
  })
  afterEach(() => {
    removeFakeBaselineServer()
    act(() => renderer?.unmount())
    renderer = undefined
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses the OS default (built-in) camera when no main camera was chosen — plan 0053 picks the USB one', async () => {
    mount()
    await connect()
    expect(requested()).toEqual(['default'])
    expect(camera.deviceId).toBe(BUILT_IN)
    expect(camera.devices).toHaveLength(2)
    expect(camera.mainDeviceId).toBe('')
  })

  it('opens the saved main camera exactly', async () => {
    store.set('posegood.v2.mainCamera', USB)
    mount()
    await connect()
    expect(requested()).toEqual([USB])
    expect(camera.deviceId).toBe(USB)
    expect(camera.mainMissing).toBe(false)
  })

  it('falls back to the default camera when the saved one is unplugged, keeping the choice', async () => {
    store.set('posegood.v2.mainCamera', 'unplugged-id')
    mount()
    await connect()
    expect(requested()).toEqual(['unplugged-id', 'default'])
    expect(camera.state).toBe('on')
    expect(camera.deviceId).toBe(BUILT_IN)
    expect(camera.mainMissing).toBe(true)
    expect(store.get('posegood.v2.mainCamera')).toBe('unplugged-id')
  })

  it('switches to and saves a camera chosen while another one is on', async () => {
    mount()
    await connect()
    await act(async () => {
      camera.chooseMainCamera(USB)
    })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(requested()).toEqual(['default', USB])
    expect(camera.deviceId).toBe(USB)
    expect(store.get('posegood.v2.mainCamera')).toBe(USB)
    expect(tracks[0].stop).toHaveBeenCalled()
  })

  it('only refreshes the list when a camera is plugged in — plan 0053 adds a notice', async () => {
    enumerateDevices.mockResolvedValue([devices[0]])
    mount()
    await connect()
    expect(camera.devices).toHaveLength(1)
    enumerateDevices.mockResolvedValue(devices)
    await act(async () => {
      listeners.devicechange?.()
    })
    expect(camera.devices).toHaveLength(2)
    expect(requested()).toEqual(['default'])
    expect(camera.deviceId).toBe(BUILT_IN)
  })

  it('reports the disconnection when the camera in use is unplugged (the measurement then ends, ServiceApp test)', async () => {
    mount()
    await connect()
    expect(camera.state).toBe('on')
    act(() => tracks[0].onended?.())
    expect(camera.state).toBe('error')
    expect(camera.error).toBe(CAMERA_ERRORS.disconnected)
  })

  it('explains a camera held by another app', async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('busy'), { name: 'NotReadableError' }))
    mount()
    await connect()
    expect(camera.state).toBe('error')
    expect(camera.error).toBe(CAMERA_ERRORS.deviceBusy)
  })

  it('accepts a camera that opened at another size — plan 0053 (F13) refuses anything but 640x480', async () => {
    size = { width: 1280, height: 720 }
    mount()
    await connect()
    expect(camera.state).toBe('on')
  })

  it('keeps the one posture when switching cameras, without asking to register again (plan 0053)', async () => {
    const calibrationId = '22222222-2222-4222-8222-222222222222'
    const joint = { x: 0.5, y: 0.5 }
    installFakeBaselineServer(
      baselineResponse(
        {
          nose: { x: 0.5, y: 0.25 },
          left_eye: joint,
          right_eye: joint,
          left_ear: joint,
          right_ear: joint,
          mouth_left: joint,
          mouth_right: joint,
          left_shoulder: { x: 0.3, y: 0.5 },
          right_shoulder: { x: 0.7, y: 0.5 },
        },
        new Date(0).toISOString(),
        calibrationId,
      ),
    )
    mount()
    await connect()
    // Registered on the server (no camera kept), used as is on either camera.
    expect(camera.deviceId).toBe(BUILT_IN)
    expect(camera.calibrationId).toBe(calibrationId)
    expect(camera.baseline).not.toBeNull()
    await act(async () => {
      camera.chooseMainCamera(USB)
    })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(camera.deviceId).toBe(USB)
    expect(camera.calibrationId).toBe(calibrationId)
  })
})
