import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CameraController } from '../../hooks/useCamera'
import { frameJoints, jointsComplete } from '../session/realtime/frames'

const server = vi.hoisted(() => ({
  registerBaseline: vi.fn(),
  fetchCurrentBaseline: vi.fn(async () => null),
}))
vi.mock('./guard', () => ({ requireSyntheticMode: () => {} }))
vi.mock('../baseline/client', () => server)
vi.mock('../platform/serverAuth', () => ({
  getServerAuth: () => ({ userId: 'synthetic-user' }),
  subscribeServerAuth: () => () => {},
}))

const { emitSyntheticFrame, useCamera } = await import('./useSyntheticCamera')
const { normalLandmarks } = await import('./syntheticPose')

let camera: CameraController
function Probe() {
  camera = useCamera()
  return null
}

const normalFrame = (timeMs: number) => ({
  timeMs, videoTimeMs: timeMs, landmarks: normalLandmarks(), worldLandmarks: [], measurable: true,
  shoulders: 'seen' as const, width: 640, height: 480, inferenceMs: 1, delegate: 'CPU' as const,
})

describe('synthetic browser camera', () => {
  let renderer: ReactTestRenderer | undefined
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = undefined
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('sends all 9 joints of the normal pose with coordinates', () => {
    const landmarks = normalLandmarks()
    expect(jointsComplete(landmarks)).toBe(true)
    const joints = frameJoints(landmarks)!
    expect(joints).toHaveLength(9)
    expect(joints.every(([x, y, visibility]) => x >= .02 && x <= .98 && y >= .02 && y <= .98 && visibility >= .65)).toBe(true)
    expect(Math.abs(joints[7][0] - joints[8][0])).toBeGreaterThanOrEqual(.1)
  })

  it('registers through the app capture and B1, and uses the server baseline id', async () => {
    vi.stubGlobal('location', { search: '' })
    server.registerBaseline.mockImplementation(async (captured) => ({
      baselineId: 'server-baseline', registeredAt: '2026-10-30T14:59:50.000Z', landmarks: captured.landmarks,
    }))
    await act(async () => { renderer = create(<Probe />) })
    await act(async () => { await camera.connect() })
    expect(camera.framing).toBe(null)
    act(() => camera.calibrate())
    expect(camera.progress).toBe(0)
    expect(camera.calibrationId).toBe(null)

    for (let i = 0; i < 20; i++) act(() => emitSyntheticFrame(true, normalFrame(1000 + i * 250)))
    expect(camera.framing).toBe('ok')
    expect(server.registerBaseline).toHaveBeenCalledOnce()
    const [captured] = server.registerBaseline.mock.calls[0]
    expect(captured.sampleCount).toBe(20)
    expect(captured.landmarks.left_shoulder).toEqual({ x: .65, y: .6 })
    expect(camera.registering).toBe(true)

    await act(async () => {})
    expect(camera.registering).toBe(false)
    expect(camera.registrationError).toBe(null)
    expect(camera.calibrationId).toBe('server-baseline')
  })

  it('stopping the camera cancels a capture in progress', async () => {
    vi.stubGlobal('location', { search: '' })
    await act(async () => { renderer = create(<Probe />) })
    await act(async () => { await camera.connect() })
    act(() => camera.calibrate())
    act(() => emitSyntheticFrame(true, normalFrame(1000)))
    act(() => camera.stop())
    expect(camera.progress).toBe(null)
    expect(server.registerBaseline).not.toHaveBeenCalled()
  })
})
