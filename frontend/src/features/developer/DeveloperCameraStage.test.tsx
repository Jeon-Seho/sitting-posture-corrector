import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyGuidance, syntheticGuideFrame } from '../../../../model/prototype/developerGuidance'
import type { ForecastReading } from '../../../../model/prototype/forecast'
import type { CameraController } from '../../hooks/useCamera'
import DeveloperCameraStage, { fitVideoFrame, projectGuidePoint } from './DeveloperCameraStage'
import { emptySummary } from './session'
import type { DeveloperSession, LabGuideFrame } from './types'

const renderers: ReactTestRenderer[] = []
const makeCamera = () => ({ state: 'off', streamRef: { current: null } }) as unknown as CameraController
const makeSession = (patch: Partial<DeveloperSession> = {}): DeveloperSession => ({
  alerts: [], alertCount: 0, alertPeakDeviation: null, alertBasis: 'predictor', setAlertBasis: vi.fn(),
  soundEnabled: true, setSoundEnabled: vi.fn(), audioStatus: 'inactive', testAlertSound: vi.fn(),
  phase: 'idle', source: 'camera', predictor: 'hold_last', setPredictor: vi.fn(),
  model: null, modelStatus: 'missing', modelError: '', loadModel: vi.fn(), error: '',
  reading: null, readings: [], events: [], summary: emptySummary(), records: [], visiblePoints: 0,
  guidance: emptyGuidance(), start: vi.fn(), startDemo: vi.fn(), stop: vi.fn(), download: vi.fn(), ...patch,
})
const reading = (patch: Partial<ForecastReading> = {}): ForecastReading => ({
  schema_version: 'forecast-experiment-v1', timeMs: 10000, state: 'near_reference', ruleState: 'near_reference',
  deviation: .01, error: .001, errorLimit: .02, durationMs: 0, progress: 1, returnedExcursions: 0,
  modelId: 'hold_last', domainValidated: false, ...patch,
})
const frame = (): LabGuideFrame => ({ ...syntheticGuideFrame(0)!, width: 640, height: 480 })
const videoNode = () => ({ srcObject: null as MediaStream | null, videoWidth: 640, videoHeight: 480, play: vi.fn().mockResolvedValue(undefined) })
function render(session: DeveloperSession, camera = makeCamera(), video = videoNode()) {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(<DeveloperCameraStage camera={camera} session={session} />, { createNodeMock: element => {
      if (element.type === 'video') return video
      if (element.props.className === 'dc-viewport') return { getBoundingClientRect: () => ({ width: 960, height: 540 }) }
      return null
    } })
  })
  renderers.push(renderer)
  return renderer
}
const button = (renderer: ReactTestRenderer, name: string) => renderer.root.findAllByType('button').find(node => node.children.includes(name))!
afterEach(() => { for (const renderer of renderers.splice(0)) act(() => renderer.unmount()) })

describe('developer camera workspace with explicit synthetic geometry', () => {
  it('projects one mirror with vertical letterboxing in a portrait workspace', () => {
    const source = { width: 640, height: 480 }, viewport = { width: 360, height: 420 }
    expect(fitVideoFrame(source, viewport)).toEqual({ x: 0, y: 75, width: 360, height: 270 })
    expect(projectGuidePoint({ x: .25, y: .25 }, source, viewport)).toEqual({ x: 270, y: 142.5 })
    expect(projectGuidePoint({ x: 0, y: 0 }, source, viewport)).toEqual({ x: 360, y: 75 })
    expect(projectGuidePoint({ x: 1, y: 1 }, source, viewport)).toEqual({ x: 0, y: 345 })
  })

  it('projects horizontal letterboxing for a wide workspace without stretching the image', () => {
    const source = { width: 640, height: 480 }, viewport = { width: 960, height: 540 }
    expect(fitVideoFrame(source, viewport)).toEqual({ x: 120, y: 0, width: 720, height: 540 })
    expect(projectGuidePoint({ x: .25, y: .25 }, source, viewport)).toEqual({ x: 660, y: 135 })
    expect(projectGuidePoint({ x: .5, y: .5 }, source, viewport)).toEqual({ x: 480, y: 270 })
  })

  it('offers a single primary start action without starting a camera on mount', () => {
    const session = makeSession(), renderer = render(session)
    expect(session.start).not.toHaveBeenCalled()
    expect(renderer.root.findAllByProps({ className: 'dc-primary' })).toHaveLength(1)
    act(() => button(renderer, '자세 측정 시작').props.onClick())
    expect(session.start).toHaveBeenCalledOnce()
    act(() => button(renderer, '합성 데모 실행').props.onClick())
    expect(session.startDemo).toHaveBeenCalledOnce()
  })

  it('draws image points in the same contained viewport as the mirrored video and releases its preview', () => {
    const camera = makeCamera(), video = videoNode(), live = frame()
    live.points[0] = { x: .25, y: .25, visibility: .99 }
    camera.state = 'on'; camera.streamRef.current = {} as MediaStream
    const session = makeSession({ phase: 'measuring', reading: reading(), guidance: { ...emptyGuidance(), step: 'tracking', live } })
    const renderer = render(session, camera, video)
    expect(video.srcObject).toBe(camera.streamRef.current)
    expect(video.play).toHaveBeenCalledOnce()
    const pose = renderer.root.findByProps({ 'data-testid': 'live-pose' })
    expect(pose.findByProps({ 'data-point': 0 }).props).toMatchObject({ cx: 660, cy: 135 })
    expect(renderer.root.findByProps({ className: 'dc-overlay' }).props.viewBox).toBe('0 0 960 540')
    act(() => renderer.update(<DeveloperCameraStage camera={camera} session={{ ...session, phase: 'finished' }} />))
    expect(video.srcObject).toBeNull()
    expect(renderer.root.findAllByProps({ 'data-testid': 'live-pose' })).toHaveLength(0)
  })

  it('removes live geometry and movement values on input loss while preserving only the reference ghost', () => {
    const reference = frame(), live = frame(); live.points[0].x += .1
    const session = makeSession({ phase: 'measuring', reading: reading(), guidance: { ...emptyGuidance(), step: 'tracking', live, reference, lateralPercent: 10, shoulderDegrees: 5 } })
    const renderer = render(session)
    expect(renderer.root.findAllByProps({ 'data-testid': 'observed-displacement' })).toHaveLength(1)
    expect(renderer.root.findByProps({ className: 'dc-observed-values' }).findAllByType('strong').map(node => node.children.join(''))).toEqual(['-10.0%', '—', '-5.0°', '1.0%'])
    act(() => renderer.update(<DeveloperCameraStage camera={makeCamera()} session={{ ...session, reading: reading({ state: 'unmeasurable', ruleState: 'unmeasurable', deviation: null, error: null }), guidance: { ...session.guidance, live: null, lateralPercent: null, shoulderDegrees: null } }} />))
    expect(renderer.root.findAllByProps({ 'data-testid': 'reference-pose' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ 'data-testid': 'live-pose' })).toHaveLength(0)
    expect(renderer.root.findAllByProps({ 'data-testid': 'live-axis' })).toHaveLength(0)
    expect(renderer.root.findAllByProps({ 'data-testid': 'observed-displacement' })).toHaveLength(0)
    expect(renderer.root.findByProps({ className: 'dc-observed-values' }).findAllByType('strong').map(node => node.children.join(''))).toEqual(['—', '—', '—', '—'])
  })

  it('shows synthetic observations without video and keeps replay available after completion', () => {
    const video = videoNode(), session = makeSession({ phase: 'measuring', source: 'synthetic', reading: reading(), readings: [reading()], guidance: { ...emptyGuidance(), step: 'tracking', live: frame() } })
    const renderer = render(session, makeCamera(), video)
    expect(video.srcObject).toBeNull(); expect(video.play).not.toHaveBeenCalled()
    expect(renderer.root.findByType('video').props.hidden).toBe(true)
    expect(renderer.root.findByProps({ className: 'dc-source dc-source-synthetic' }).children).toContain('합성 관측 · 영상 아님')
    act(() => renderer.update(<DeveloperCameraStage camera={makeCamera()} session={{ ...session, phase: 'finished' }} />))
    act(() => button(renderer, '합성 데모 실행').props.onClick())
    act(() => button(renderer, '결과 내려받기').props.onClick())
    expect(session.startDemo).toHaveBeenCalledOnce(); expect(session.download).toHaveBeenCalledOnce()
  })

  it('hides reference comparisons when the camera aspect changes instead of stretching a past crop', () => {
    const reference = frame(), live = { ...frame(), width: 1280, height: 720 }
    const session = makeSession({ phase: 'measuring', reading: reading(), guidance: { ...emptyGuidance(), step: 'tracking', live, reference, lateralPercent: 10, shoulderDegrees: 5 } })
    const renderer = render(session)
    expect(renderer.root.findAllByProps({ 'data-testid': 'live-pose' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ 'data-testid': 'reference-pose' })).toHaveLength(0)
    expect(renderer.root.findAllByProps({ 'data-testid': 'observed-displacement' })).toHaveLength(0)
    expect(renderer.root.findByProps({ className: 'dc-observed-values' }).findAllByType('strong').map(node => node.children.join(''))).toEqual(['—', '—', '—', '—'])
    expect(JSON.stringify(renderer.toJSON())).toContain('영상 비율이 바뀌어 기준선을 숨겼습니다.')
  })

  it('follows the newest observation dimensions when a running camera changes resolution', () => {
    const camera = makeCamera(), video = videoNode(), reference = frame()
    camera.state = 'on'; camera.streamRef.current = {} as MediaStream
    const session = makeSession({ phase: 'measuring', reading: reading(), guidance: { ...emptyGuidance(), step: 'tracking', live: frame(), reference } })
    const renderer = render(session, camera, video)
    act(() => renderer.root.findByType('video').props.onLoadedMetadata())
    const wide = { ...frame(), width: 1280, height: 720 }
    wide.points[0] = { x: .25, y: .25, visibility: .99 }
    act(() => renderer.update(<DeveloperCameraStage camera={camera} session={{ ...session, guidance: { ...session.guidance, live: wide } }} />))
    expect(renderer.root.findByProps({ 'data-testid': 'live-pose' }).findByProps({ 'data-point': 0 }).props).toMatchObject({ cx: 720, cy: 135 })
    expect(renderer.root.findAllByProps({ 'data-testid': 'reference-pose' })).toHaveLength(0)
  })

  it('distinguishes a displaced image reference from the independent relative 3D posture reading', () => {
    const reference = frame(), live = frame()
    live.points = live.points.map(p => ({ ...p, y: p.y + .15 }))
    const session = makeSession({ phase: 'measuring', reading: reading({ deviation: .04 }),
      guidance: { ...emptyGuidance(), step: 'tracking', live, reference, lateralPercent: 0, verticalPercent: 15, shoulderDegrees: 0 } })
    const renderer = render(session)
    expect(renderer.root.findAllByProps({ 'data-testid': 'observed-displacement' })).toHaveLength(1)
    expect(renderer.root.findByProps({ className: 'dc-observed-values' }).findAllByType('strong').map(node => node.children.join('')))
      .toEqual(['0.0%', '15.0% ↓', '0.0°', '4.0%'])
    const output = JSON.stringify(renderer.toJSON())
    expect(output).toContain('자세 비교 · 기준 범위 안')
    expect(output).toContain('등록 당시 화면 위치')
    expect(output).toContain('몸 전체의 이동·크기 변화는 제외')
    act(() => renderer.update(<DeveloperCameraStage camera={makeCamera()} session={{ ...session,
      reading: reading({ state: 'warming', error: null }) }} />))
    expect(renderer.root.findByProps({ className: 'dc-state dc-state-neutral' }).children).toContain('연속 관측을 다시 모으는 중')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('자세 비교 · 기준 범위 안')
  })

  it('uses actual registration progress and retains the stop action while guiding', () => {
    const session = makeSession({ phase: 'registering', reading: reading({ state: 'registering', progress: .25 }), guidance: { ...emptyGuidance(), step: 'reference', instruction: '편안한 자세를 8초 동안 기록하고 있어요', live: frame() } })
    const renderer = render(session)
    expect(renderer.root.findByProps({ 'aria-label': '8초 기준 등록 진행' }).props.value).toBe(.25)
    expect(renderer.root.findByProps({ className: 'dc-hold' }).findByType('strong').children).toEqual(['6초'])
    expect(renderer.root.findByProps({ className: 'dc-viewport' }).findAllByProps({ className: 'dc-guidance ' })).toHaveLength(0)
    expect(renderer.root.findByProps({ className: 'dc-instruction-dock' }).findAllByProps({ className: 'dc-guidance ' })).toHaveLength(1)
    act(() => button(renderer, '측정 종료').props.onClick())
    expect(session.stop).toHaveBeenCalledOnce()
    act(() => renderer.update(<DeveloperCameraStage camera={makeCamera()} session={{ ...session, phase: 'guiding' }} />))
    expect(button(renderer, '측정 종료')).toBeDefined()
  })

  it('announces a camera error and routes retry through the one start action', () => {
    const session = makeSession({ phase: 'error', error: '카메라 사용 권한이 필요합니다.' }), renderer = render(session)
    expect(renderer.root.findByProps({ role: 'alert' }).children).toContain(session.error)
    act(() => button(renderer, '다시 연결').props.onClick())
    expect(session.start).toHaveBeenCalledOnce()
  })
  it('shows the delivered alert and deviation in the camera dock even when muted, without repeating a live alert region', () => {
    const r = reading({ state: 'persistent_deviation_candidate', ruleState: 'persistent_deviation_candidate', deviation: .18, durationMs: 3200 })
    const session = makeSession({ phase: 'measuring', source: 'synthetic', soundEnabled: false, reading: r,
      guidance: { ...emptyGuidance(), step: 'tracking', live: frame() },
      alerts: [{ id: 1, timeMs: 10000, basis: 'predictor', kind: 'first', deviation: .18, peakDeviation: .2, durationMs: 3000, error: .01, errorLimit: .02, source: 'synthetic' }],
    })
    const renderer = render(session)
    expect(JSON.stringify(renderer.toJSON())).toContain('합성 알림 · 지속적인 자세 변화')
    expect(JSON.stringify(renderer.toJSON())).toContain('거리 18.0% · 연속 3.2초')
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
    act(() => { renderer.update(<DeveloperCameraStage camera={makeCamera()} session={{ ...session, reading: reading({ state: 'unmeasurable', deviation: null }) }} />) })
    expect(renderer.root.findAll(node => node.props.className?.includes('dc-alert-active'))).toHaveLength(0)
  })

})
