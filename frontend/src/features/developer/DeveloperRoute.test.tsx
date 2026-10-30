import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCamera, type CameraController } from '../../hooks/useCamera'
import { CAMERA_ERRORS } from '../camera/errors'
import ObservationLab from './ObservationLab'
import { ConfirmDialog } from '../dialog/ConfirmDialog'
import { ObservationReplay } from './ObservationReplayPanel'
import DeveloperRoute from './DeveloperRoute'

const vision = vi.hoisted(() => ({ resolve: vi.fn(), create: vi.fn(), draw: vi.fn() }))
vi.mock('@mediapipe/tasks-vision', () => ({ FilesetResolver: { forVisionTasks: vision.resolve }, PoseLandmarker: { createFromOptions: vision.create } }))
vi.mock('../../lib/poseVisual', async original => ({ ...await original<typeof import('../../lib/poseVisual')>(), drawPose: vision.draw }))
const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('')
// Explicit synthetic media and landmarks; no real camera or participant data.
const syntheticPoints = () => Array.from({ length: 33 }, (_, index) => ({
  x: index === 11 ? .3 : index === 12 ? .7 : .5, y: index < 11 ? .3 : .6, z: 0, visibility: .99,
}))

describe('unified /dev observation route with real camera hook and synthetic media', () => {
  let renderer: ReactTestRenderer | undefined, camera: CameraController
  let getUserMedia: ReturnType<typeof vi.fn>, close: ReturnType<typeof vi.fn>, stop: ReturnType<typeof vi.fn>
  let win: EventTarget & { location: { search: string } }
  function App() { camera = useCamera({ baselineMode: 'local' }); return <DeveloperRoute camera={camera} /> }
  const button = (label: string) => renderer!.root.findAllByType('button').find(node => text(node) === label)!
  beforeEach(async () => {
    vi.useFakeTimers(); vi.setSystemTime(0)
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
    stop = vi.fn(); close = vi.fn()
    const track = { stop, getSettings: () => ({ deviceId: 'synthetic-route-camera' }), readyState: 'live', onended: null }
    getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track], getVideoTracks: () => [track] })
    const points = syntheticPoints()
    vision.resolve.mockReset().mockResolvedValue({})
    vision.create.mockReset().mockResolvedValue({ close, detectForVideo: vi.fn(() => ({ landmarks: [points], worldLandmarks: [points] })) })
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) } })
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
    vi.stubGlobal('document', Object.assign(new EventTarget(), { title: 'synthetic test', visibilityState: 'visible', createElement: vi.fn(() => ({ getContext: () => null, click: vi.fn() })) }))
    win = Object.assign(new EventTarget(), { location: { search: '' } }); vi.stubGlobal('window', win)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    await act(async () => { renderer = create(<App />, { createNodeMock: element => {
      if (element.type === 'video') return { srcObject: null, readyState: 2, videoWidth: 640, videoHeight: 480,
        get currentTime() { return Date.now() / 1000 }, play: vi.fn().mockResolvedValue(undefined) }
      return null
    } }) })
  })
  afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
  const start = async (mode: 'auto' | 'manual' = 'auto') => {
    const calls = getUserMedia.mock.calls.length
    act(() => button('카메라 켜기').props.onClick())
    expect(getUserMedia).toHaveBeenCalledTimes(calls)
    act(() => renderer!.root.findAllByProps({type:'radio'}).find(r => r.props.value === mode)!.props.onChange())
    await act(async () => { await button('카메라 켜고 시작').props.onClick() })
  }
  it.each([
    ['', false], ['?view=observation', false], ['?view=anything', false],
    ['?demo=1', true], ['?view=observation&demo=1', true],
  ])('renders the observation surface at search %s, without starting a camera or legacy experiment', (search, demo) => {
    win.location.search = search
    act(() => renderer!.update(<App />))
    expect(renderer!.root.findByType(ObservationLab).props.demo).toBe(demo)
    expect(renderer!.root.findAllByProps({className:'capture-source'})).toHaveLength(1)
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('실시간 자세 실험')
    expect(getUserMedia).not.toHaveBeenCalled()
    const links = renderer!.root.findAllByType('a').map(link => link.props.href)
    expect(links).toContain(demo ? '/dev' : '/dev?demo=1')
    expect(links.every(href => !href.includes('view=observation'))).toBe(true)
  })
  it('connects Heavy, waits for reference confirmation and releases the camera on stop', async () => {
    await start()
    expect(camera.state).toBe('on'); expect(getUserMedia).toHaveBeenCalledOnce()
    expect(vision.create.mock.calls[0][1].baseOptions).toMatchObject({ delegate: 'GPU', modelAssetPath: expect.stringMatching(/\/mediapipe\/pose_landmarker_heavy\.task$/) })
    for (let elapsed = 0; elapsed < 14000; elapsed += 100) act(() => { vi.advanceTimersByTime(100) })
    expect(renderer!.root.findByProps({'aria-label':'동작 안내'}).props['data-state']).toBe('idle')
    const beginReference = renderer!.root.findByProps({ 'aria-label': '기준 자세 등록 시작' })
    expect(beginReference.props.disabled).toBe(false)
    act(() => beginReference.props.onClick())
    for (let elapsed = 0; elapsed < 11000; elapsed += 100) act(() => { vi.advanceTimersByTime(100) })
    expect(renderer!.root.findByProps({'aria-label':'동작 안내'}).props['data-state']).toBe('running')
    expect(button('측정 종료').props.disabled).not.toBe(true)
    act(() => button('측정 종료').props.onClick())
    expect(camera.state).toBe('on')
    act(() => renderer!.root.findByType(ConfirmDialog).props.onConfirm())
    expect(camera.state).toBe('off'); expect(stop).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce()
    const recording = renderer!.root.findByType(ObservationReplay).props.getRecording()
    expect(recording.frames.length).toBeGreaterThan(0)
    expect(recording.frames[0].image).toHaveLength(33)
    expect(recording.frames[0].world).toHaveLength(33)
    expect(recording.frames[0].image.every((point: unknown) => point !== null)).toBe(true)
    expect(recording.frames[0].world.every((point: unknown) => point !== null)).toBe(true)
    expect(recording.frames[0]).toMatchObject({ measurable: true, poseModelId: expect.stringContaining('heavy') })
    expect(recording.frames[0].rawFeatures).toMatchObject({ quality: .99 })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('shows the camera timeout when permission never resolves', async () => {
    getUserMedia.mockReturnValue(new Promise(() => {}))
    await start(); expect(camera.state).toBe('loading')
    expect(renderer!.root.findAllByProps({ className: 'oc-camera-empty' })).toHaveLength(0)
    expect(renderer!.root.findAllByProps({ role: 'timer' })).toHaveLength(0)
    expect(renderer!.root.findByProps({ className: 'oc-status' }).props.children).toBe('카메라를 연결하고 있어요.')
    act(() => { vi.advanceTimersByTime(30_001) })
    expect(renderer!.root.findByProps({role:'alert'}).props.children).toContain(CAMERA_ERRORS.preparationTimeout)
    expect(vision.create).not.toHaveBeenCalled()
  })
  it('can reconnect after a camera permission failure', async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('synthetic denied'), { name: 'NotAllowedError' }))
    await start(); expect(camera.state).toBe('error')
    expect(renderer!.root.findByProps({ role: 'alert' }).props.children).toContain(CAMERA_ERRORS.permissionDenied)
    await start(); expect(camera.state).toBe('on')
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    act(() => { vi.advanceTimersByTime(500) })
    expect(renderer!.root.findByProps({ 'aria-label': '기준 자세 등록 시작' }).props.disabled).toBe(false)
  })
  it('offers manual measurement immediately after reference registration with Heavy', async () => {
    await start('manual')
    for (let elapsed = 0; elapsed < 500; elapsed += 100) act(() => { vi.advanceTimersByTime(100) })
    act(() => renderer!.root.findByProps({ 'aria-label': '기준 자세 등록 시작' }).props.onClick())
    for (let elapsed = 0; elapsed < 8200; elapsed += 100) act(() => { vi.advanceTimersByTime(100) })
    expect(renderer!.root.findByProps({ 'aria-label': '동작 안내' }).props['data-state']).toBe('waiting')
    expect(renderer!.root.findByProps({ 'aria-label': '측정 시작' }).props.disabled).toBe(false)
    expect(vision.create.mock.calls[0][1].baseOptions.modelAssetPath).toMatch(/\/mediapipe\/pose_landmarker_heavy\.task$/)
  })
})
