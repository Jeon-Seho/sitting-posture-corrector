import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCamera, type CameraController } from '../../hooks/useCamera'
import { CAMERA_ERRORS } from '../camera/errors'
import { POSE_MODELS } from '../mediapipe'
import { liveForecastPoints } from '../../../../model/prototype/forecast'
import { fitNormalPostureProfile, type NormalPostureProfile } from '../../../../model/prototype/normalPosture'
import DeveloperLab from './DeveloperLab'
import DeveloperRoute from './DeveloperRoute'

const vision = vi.hoisted(() => ({ resolve: vi.fn(), create: vi.fn(), draw: vi.fn() }))
vi.mock('@mediapipe/tasks-vision', () => ({ FilesetResolver: { forVisionTasks: vision.resolve }, PoseLandmarker: { createFromOptions: vision.create } }))
vi.mock('../../lib/poseVisual', async original => ({ ...await original<typeof import('../../lib/poseVisual')>(), drawPose: vision.draw }))
const button = (renderer: ReactTestRenderer, text: string) => renderer.root.findAllByType('button').find(node => node.children.some(child => typeof child === 'string' && child.includes(text)))!
// Explicit synthetic training fixture, never real captured landmarks or an accuracy claim.
const syntheticPoints = () => Array.from({ length: 33 }, (_, index) => ({
  x: index === 11 ? .3 : index === 12 ? .7 : .5, y: index < 11 ? .3 : .6, z: 0, visibility: .99,
}))
const profileFixture = (poseModelId?: string): NormalPostureProfile => fitNormalPostureProfile(
  Array.from({ length: 301 }, (_, index) => ({ timeMs: index * 100, values: liveForecastPoints(syntheticPoints(), syntheticPoints())! })),
  { id: 'synthetic_route_profile', participantCode: 'synthetic_participant', sessionCode: 'synthetic_normal',
    purpose: 'personal_calibration', createdAt: '2026-10-14T00:00:00Z', ...(poseModelId ? { poseModelId } : {}) },
)

describe('actual developer route, camera hook and session integration with synthetic media only', () => {
  let renderer: ReactTestRenderer | undefined, camera: CameraController
  let getUserMedia: ReturnType<typeof vi.fn>, close: ReturnType<typeof vi.fn>, stop: ReturnType<typeof vi.fn>
  function App() { camera = useCamera(); return <DeveloperRoute camera={camera} /> }
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
    vi.stubGlobal('document', { title: 'synthetic test', visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn(),
      createElement: vi.fn(() => ({ getContext: () => null, click: vi.fn() })) })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    await act(async () => { renderer = create(<App />, { createNodeMock: element => {
      if (element.type === 'video') return { srcObject: null, readyState: 2, videoWidth: 640, videoHeight: 480,
        get currentTime() { return Date.now() / 1000 }, play: vi.fn().mockResolvedValue(undefined) }
      if (element.type === 'div') return { getBoundingClientRect: () => ({ width: 640, height: 480 }) }
      return null
    } }) })
  })
  afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
  const phase = () => renderer!.root.findByProps({ 'aria-label': '카메라 측정 작업공간' }).props['data-phase']
  const session = () => renderer!.root.findByType(DeveloperLab).props.session
  const collection = () => renderer!.root.findByType(DeveloperLab).props.collection
  const feed = (milliseconds = 14_000) => {
    for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) act(() => { vi.advanceTimersByTime(100) })
  }
  const importProfileThroughUi = async (profile: NormalPostureProfile) => {
    act(() => button(renderer!, '정상 자세 수집').props.onClick())
    act(() => renderer!.root.findByProps({ 'aria-label': '정상 데이터 수집 방식' }).findAllByType('button')[1].props.onClick())
    const text = JSON.stringify(profile)
    await act(async () => renderer!.root.findByProps({ 'aria-label': '개인 정상 범위 JSON 선택' }).props.onChange({
      target: { files: [{ size: text.length, text: async () => text }], value: 'synthetic-profile.json' },
    }))
    expect(collection().profile?.id).toBe(profile.id)
    act(() => button(renderer!, '실험실로 돌아가기').props.onClick())
  }

  it('passes model/runtime options through the real hook and enters guiding, then measuring', async () => {
    expect(getUserMedia).not.toHaveBeenCalled()
    await act(async () => button(renderer!, '자세 측정 시작').props.onClick())
    expect(camera.state).toBe('on')
    expect(phase()).toBe('guiding')
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(vision.create.mock.calls[0][1].baseOptions).toMatchObject({ delegate: 'GPU', modelAssetPath: '/mediapipe/pose_landmarker_full.task' })
    expect(button(renderer!, '현재 측정 20초 분석').props.disabled).toBe(false)
    for (let elapsed = 0; elapsed < 14000; elapsed += 100) act(() => { vi.advanceTimersByTime(100) })
    expect(phase()).toBe('measuring')
    expect(camera.state).toBe('on')
    expect(stop).not.toHaveBeenCalled()
    act(() => button(renderer!, '측정 종료').props.onClick())
    expect(camera.state).toBe('off')
    expect(phase()).toBe('finished')
    expect(stop).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it('shows preparation timeout after 30 seconds when camera permission never resolves', async () => {
    getUserMedia.mockReturnValue(new Promise(() => {}))
    await act(async () => button(renderer!, '자세 측정 시작').props.onClick())
    expect(camera.state).toBe('loading')
    expect(phase()).toBe('connecting')
    expect(button(renderer!, '현재 측정 20초 분석').props.disabled).toBe(true)
    act(() => { vi.advanceTimersByTime(30_001) })
    expect(phase()).toBe('error')
    expect(JSON.stringify(renderer!.toJSON())).toContain(CAMERA_ERRORS.preparationTimeout)
    expect(vision.create).not.toHaveBeenCalled()
  })

  it('applies an imported Full profile to the actual Full camera session and its measured readings', async () => {
    const profile = profileFixture(POSE_MODELS.full.modelId)
    await importProfileThroughUi(profile)
    expect(renderer!.root.findByType(DeveloperLab).props.normalProfileNotice).toBeUndefined()
    await act(async () => button(renderer!, '자세 측정 시작').props.onClick())
    feed()
    expect(camera.trackerDiagnostics).toMatchObject({ variant: 'full', modelId: POSE_MODELS.full.modelId })
    expect(session().phase).toBe('measuring')
    expect(session().reading).toMatchObject({ normalProfileId: profile.id, normalScore: 0 })
    act(() => button(renderer!, '측정 종료').props.onClick())
    expect(session().records[0].normalProfileId).toBe(profile.id)
    expect(collection().profile).toEqual(profile)
  })

  it.each([
    ['legacy unknown', undefined],
    ['Heavy', POSE_MODELS.heavy.modelId],
  ])('retains a %s profile but warns and uses distance rules while the selected extractor is Full', async (_, poseModelId) => {
    const profile = profileFixture(poseModelId)
    await importProfileThroughUi(profile)
    expect(renderer!.root.findByType(DeveloperLab).props.normalProfileNotice).toContain('추출 모델이 다르거나 기록되지 않았습니다')
    expect(JSON.stringify(renderer!.toJSON())).toContain('현재는 거리·시간 규칙을 사용합니다')
    await act(async () => button(renderer!, '자세 측정 시작').props.onClick())
    feed()
    expect(session().phase).toBe('measuring')
    expect(session().reading.ruleState).toBe('near_reference')
    expect(session().reading.normalProfileId).toBeUndefined()
    expect(session().reading.normalScore).toBeUndefined()
    expect(collection().profile).toEqual(profile)
    act(() => button(renderer!, '측정 종료').props.onClick())
    expect(session().records[0].normalProfileId).toBeNull()
    expect(collection().profile).toEqual(profile)

    // Preserved Heavy provenance becomes compatible only after an explicit model switch.
    if (poseModelId) {
      act(() => renderer!.root.findByProps({ 'aria-label': 'MediaPipe 모델' }).props.onChange({ target: { value: 'heavy' } }))
      expect(renderer!.root.findByType(DeveloperLab).props.normalProfileNotice).toBeUndefined()
      await act(async () => button(renderer!, '새 측정 시작').props.onClick())
      feed()
      expect(camera.trackerDiagnostics?.modelId).toBe(POSE_MODELS.heavy.modelId)
      expect(session().reading?.normalProfileId).toBe(profile.id)
      expect(collection().profile).toEqual(profile)
    }
  })
})
