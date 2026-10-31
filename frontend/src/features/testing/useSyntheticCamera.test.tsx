import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CameraController } from '../../hooks/useCamera'
import { FrameBatcher } from '../session/realtime/frames'

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
const { syntheticObservation } = await import('./syntheticPose')

let camera: CameraController
function Probe() {
  camera = useCamera()
  return null
}

const normalFrame = (timeMs: number) => syntheticObservation('normal', timeMs)

/** The `/v2/realtime` message LiveSession sends for one synthetic frame (same path as `useLiveSession`). */
function wire(kind: 'normal' | 'deviation' | 'poor' | 'absent') {
  const frame = syntheticObservation(kind, 1000)
  const batcher = new FrameBatcher(1000)
  batcher.push({ timeMs: frame.timeMs, landmarks: frame.landmarks, judgeable: frame.shoulders !== 'missing' })
  const [item] = batcher.finish(1250)
  return JSON.parse(JSON.stringify({ type: 'features', items: [item] }))
}

/** BE `FrameFeatures.features`: nose and shoulders visible inside the edges, shoulders 10 % apart. */
function judgeableByServer(p: [number, number, number][]) {
  const [nose, left, right] = [p[0], p[7], p[8]]
  const inside = [nose, left, right].every(([x, y, v]) => v >= .65 && v <= 1 && x >= .02 && x <= .98 && y >= .02 && y <= .98)
  return inside && Math.hypot((left[0] - right[0]) * 640, (left[1] - right[1]) * 480) >= 64
}

describe('synthetic browser camera', () => {
  let renderer: ReactTestRenderer | undefined
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = undefined
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('sends each kind in the current posture.frames.v1 format', () => {
    const normal = wire('normal')
    expect(normal).toMatchObject({
      type: 'features',
      items: [{ schema_version: '3.0', feature_version: 'keypoints-9-v1', sequence: 0, start_ms: 0, end_ms: 250, phase: 'running' }],
    })
    const [frame] = normal.items[0].frames
    expect(Object.keys(frame)).toEqual(['t_ms', 'p'])
    expect(frame.p).toHaveLength(9)
    expect(judgeableByServer(frame.p)).toBe(true)

    const deviation = wire('deviation').items[0].frames[0]
    expect(judgeableByServer(deviation.p)).toBe(true)
    expect(deviation.p[0][1]).toBeGreaterThan(frame.p[0][1])
    expect(deviation.p[0][0] - (deviation.p[3][0] + deviation.p[4][0]) / 2).toBeCloseTo(frame.p[0][0] - (frame.p[3][0] + frame.p[4][0]) / 2)

    expect(wire('poor').items[0].frames).toEqual([{ t_ms: 0, p: null, valid: false }])
    expect(wire('absent').items[0].frames).toEqual([{ t_ms: 0, p: null }])
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
