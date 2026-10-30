import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { CameraController } from '../../hooks/useCamera'
import type { ForecastReading } from '../../../../model/prototype/forecast'
import DeveloperLab from './DeveloperLab'
import type { NormalCollectionController } from './useNormalCollection'
import { emptyNormalCollection } from './normalCollection'
import { AutoNormalCapture } from './autoNormalCollection'
import type { AutoNormalCollectionController } from './useAutoNormalCollection'
import type { DeveloperSession, LabRecord } from './types'

vi.mock('./DeveloperCameraStage', () => ({ default: ({ session }: { session: DeveloperSession }) => <div data-testid="camera-workspace"><button onClick={session.start}>자세 측정 시작</button><button onClick={session.startDemo}>합성 데모</button></div> }))
const camera = { state: 'off', metrics: { fps: 0 }, error: '' } as unknown as CameraController
const makeSession = (patch: Partial<DeveloperSession> = {}): DeveloperSession => ({
  alerts: [], alertCount: 0, alertPeakDeviation: null, alertBasis: 'predictor', setAlertBasis: vi.fn(),
  soundEnabled: true, setSoundEnabled: vi.fn(), audioStatus: 'inactive', testAlertSound: vi.fn(),
  phase: 'idle', source: 'camera', predictor: 'hold_last', setPredictor: vi.fn(), model: null, modelStatus: 'missing', modelError: '', loadModel: vi.fn(), error: '',
  reading: null, readings: [], events: [], summary: { elapsedMs: 0, validMs: 0, nearMs: 0, unavailableMs: 0, nearPercent: null, meanError: null, deviations: 0 },
  records: [], visiblePoints: 0, start: vi.fn(), startDemo: vi.fn(), stop: vi.fn(), download: vi.fn(),
  guidance: { step: 'intro', cue: 'waiting', instruction: '편안하게 앉아 주세요.', detail: '', ready: false, holdProgress: 0, introStep: 0, live: null, reference: null, lateralPercent: null, verticalPercent: null, shoulderDegrees: null },
  ...patch,
})
const button = (renderer: ReactTestRenderer, text: string) => renderer.root.findAllByType('button').find(b => b.children.some(c => typeof c === 'string' && c.includes(text)))!
const textOf = (renderer: ReactTestRenderer) => JSON.stringify(renderer.toJSON())
const renderLab = (session: DeveloperSession) => { let renderer: ReactTestRenderer; act(() => { renderer = create(<DeveloperLab camera={camera} session={session} />) }); return renderer! }
const reading = (timeMs: number, state: ForecastReading['state'], deviation: number | null): ForecastReading => ({ schema_version: 'forecast-experiment-v1', timeMs, state, ruleState: state, deviation, error: deviation, errorLimit: .02, durationMs: 0, progress: 1, returnedExcursions: 0, modelId: 'explicit-synthetic-hold-last', domainValidated: false })

describe('camera-focused developer laboratory', () => {
  it('defaults to dark mode and permits an explicit light theme without changing the camera', () => {
    const session = makeSession(), renderer = renderLab(session)
    expect(renderer.root.findByProps({ className: 'dev-lab' }).props['data-theme']).toBe('dark')
    act(() => renderer.root.findByProps({ 'aria-label': '라이트 모드로 전환' }).props.onClick())
    expect(renderer.root.findByProps({ className: 'dev-lab' }).props['data-theme']).toBe('light')
    expect(session.start).not.toHaveBeenCalled()
    expect(renderer.root.findAllByProps({ 'data-testid': 'camera-workspace' })).toHaveLength(1)
    act(() => renderer.unmount())
  })

  it('delegates the only primary start controls to the camera workspace and does not invent measurements', () => {
    const session = makeSession(), renderer = renderLab(session)
    expect(session.start).not.toHaveBeenCalled()
    expect(renderer.root.findAllByType('button').filter(b => b.children.includes('자세 측정 시작'))).toHaveLength(1)
    act(() => button(renderer, '자세 측정 시작').props.onClick())
    expect(session.start).toHaveBeenCalledOnce()
    expect(textOf(renderer)).toContain('관측한 수치가 없어 비어 있는 그래프')
    expect(textOf(renderer)).toContain('학습 모델 미연결')
    expect(textOf(renderer)).toContain('학습 모델이 아닌 단순 예측 비교군입니다.')
    expect(renderer.root.findByProps({ 'data-series': 'deviation' }).props.d).toBe('')
    act(() => renderer.unmount())
  })

  it('identifies synthetic provenance and exposes different forecast and rule states', () => {
    const value = { ...reading(10000, 'unexpected_motion_candidate', .2), ruleState: 'persistent_deviation_candidate' as const }
    const session = makeSession({ phase: 'measuring', source: 'synthetic', reading: value, readings: [value] }), renderer = renderLab(session)
    expect(textOf(renderer)).toContain('합성 데모 · 실제 측정 아님')
    expect(textOf(renderer)).toContain('현재 상태가 다름')
    const statuses = renderer.root.findAll(n => n.type === 'span' && typeof n.props.className === 'string' && n.props.className.startsWith('lab-state lab-state-'))
    expect(statuses.map(node => node.children.filter(c => typeof c === 'string').join(''))).toEqual(['예상 밖 움직임', '지속 이탈 후보'])
    act(() => renderer.unmount())
  })

  it('allows basic predictors without a model, disables LSTM, and freezes active guidance configuration', () => {
    const session = makeSession(), renderer = renderLab(session)
    act(() => button(renderer, '설정').props.onClick())
    const options = renderer.root.findAllByType('input').filter(i => i.props.type === 'radio')
    expect(options.find(i => i.props.value === 'lstm')!.props.disabled).toBe(true)
    expect(options.find(i => i.props.value === 'constant_velocity')!.props.disabled).toBe(false)
    act(() => options.find(i => i.props.value === 'constant_velocity')!.props.onChange())
    expect(session.setPredictor).toHaveBeenCalledWith('constant_velocity')
    act(() => renderer.update(<DeveloperLab camera={camera} session={{ ...session, phase: 'guiding' }} />))
    expect(renderer.root.findByProps({ className: 'lab-predictors' }).props.disabled).toBe(true)
    expect(renderer.root.findAllByType('input').find(i => i.props.type === 'file')!.props.disabled).toBe(true)
    act(() => renderer.unmount())
  })

  it('locks competing camera controls during model comparison but leaves cancellation accessible', () => {
    let renderer!: ReactTestRenderer
    act(() => { renderer = create(<DeveloperLab camera={camera} session={makeSession()} benchmarkBusy performancePanel={<button>비교 중단</button>} />) })
    const boundaries = renderer.root.findAllByProps({ className: 'lab-interaction-boundary' })
    expect(boundaries).toHaveLength(2)
    expect(boundaries.every(boundary => boundary.props.disabled)).toBe(true)
    const cancel = button(renderer, '비교 중단')
    let parent = cancel.parent
    while (parent) { expect(parent.type === 'fieldset' && parent.props.disabled).not.toBe(true); parent = parent.parent }
    act(() => renderer.unmount())
  })

  it('shows in-memory records and downloads the explicitly selected record', () => {
    const session = makeSession()
    const record: LabRecord = { id: 'explicit-synthetic-test', startedAt: '2026-10-13T00:00:00Z', source: 'synthetic', predictor: 'hold_last', summary: session.summary, readings: [], events: [], modelId: 'hold_last', modelSha256: null }
    session.records = [record]
    const renderer = renderLab(session)
    act(() => button(renderer, '기록').props.onClick())
    expect(textOf(renderer)).toContain('합성 데모 · 실제 측정 아님')
    act(() => renderer.root.findByProps({ 'aria-label': '실험 1 결과 내려받기' }).props.onClick())
    expect(session.download).toHaveBeenCalledWith(record)
    act(() => button(renderer, '결과 보기').props.onClick())
    expect(renderer.root.findAllByProps({ 'aria-label': '선택한 실험 상세' })).toHaveLength(1)
    act(() => renderer.unmount())
  })

  it('does not bridge unavailable periods in the measured distance plot', () => {
    const renderer = renderLab(makeSession({ readings: [reading(0, 'near_reference', .03), reading(100, 'near_reference', .04), reading(200, 'unmeasurable', null), reading(300, 'near_reference', .03), reading(400, 'near_reference', .02)] }))
    expect(renderer.root.findByProps({ 'data-series': 'deviation' }).props.d.match(/M/g)).toHaveLength(2)
    act(() => renderer.unmount())
  })

  it('plots the combined body score with a ratio boundary even when relative geometry stays at zero', () => {
    const imagePosture: NonNullable<ForecastReading['imagePosture']> = { policy: 'image-posture-anchor-v1', status: 'ready', score: 2, translation: 0, shrink: .4, translationLimit: .45, shrinkLimit: .2, strongest: 'scale' }
    const values = [0, 100].map(time => ({ ...reading(time, 'persistent_deviation_candidate', 0), postureScore: 2, imagePosture }))
    const renderer = renderLab(makeSession({ phase: 'measuring', alertBasis: 'rule', reading: values[1], readings: values }))
    expect(renderer.root.findByProps({ className: 'lab-chart-legend' }).findAllByType('span').map(node => node.children.filter(c => typeof c === 'string').join(''))).toContain('종합 이탈 경계 1배')
    expect(renderer.root.findByProps({ 'aria-label': '예측과 규칙 상태 타임라인' }).findAllByProps({ className: 'lab-track' })[1].findByType('span').children).toEqual(['종합 이탈'])
    expect(renderer.root.findByProps({ 'data-series': 'deviation' }).props.d).not.toContain('160.0')
    expect(textOf(renderer)).toContain('경계 대비 배수 · 확률 아님')
    const newValues = values.map(value => ({ ...value, postureEntryRatio: .7, postureRecoveryRatio: .7 * 2 / 3 }))
    act(() => renderer.update(<DeveloperLab camera={camera} session={makeSession({ phase: 'measuring', alertBasis: 'rule', reading: newValues[1], readings: newValues })} />))
    expect(textOf(renderer)).toContain('종합 이탈 경계 0.7배')
    act(() => renderer.unmount())
  })

  it('breaks both state tracks and the plot at a 200ms input gap even when warming has a numeric deviation', () => {
    const renderer = renderLab(makeSession({ readings: [reading(0, 'near_reference', .03), reading(100, 'near_reference', .04), reading(300, 'warming', .03), reading(400, 'near_reference', .02)] }))
    expect(renderer.root.findByProps({ 'data-series': 'deviation' }).props.d.match(/M/g)).toHaveLength(2)
    const tracks = renderer.root.findAllByProps({ className: 'lab-track-bar' })
    expect(tracks).toHaveLength(2)
    expect(tracks.map(track => track.findAllByType('i').length)).toEqual([2, 2])
    act(() => renderer.unmount())
  })

  it('coalesces continuous equal states into one track segment and preserves actual gaps', () => {
    const values = Array.from({ length: 100 }, (_, i) => reading(i * 100, 'near_reference', .03))
    const session = makeSession({ readings: values }), renderer = renderLab(session)
    expect(renderer.root.findAllByProps({ className: 'lab-track-bar' }).map(track => track.findAllByType('i').length)).toEqual([1, 1])
    const withGap = values.map((value, i) => i >= 50 ? { ...value, timeMs: value.timeMs + 200 } : value)
    act(() => renderer.update(<DeveloperLab camera={camera} session={{ ...session, readings: withGap }} />))
    expect(renderer.root.findAllByProps({ className: 'lab-track-bar' }).map(track => track.findAllByType('i').length)).toEqual([2, 2])
    act(() => renderer.unmount())
  })

  it('keeps elapsed session time on axes after old trace readings are trimmed', () => {
    const renderer = renderLab(makeSession({ readings: [reading(300000, 'near_reference', .03), reading(540000, 'near_reference', .04), reading(570000, 'near_reference', .03), reading(600000, 'near_reference', .02)] }))
    expect(renderer.root.findByProps({ className: 'lab-chart-times' }).findAllByType('span').map(s => s.children.join(''))).toEqual(['09:00', '09:30', '10:00'])
    act(() => renderer.unmount())
  })

  it('shows only posture distance by default and reveals the registered error limit on request', () => {
    const session = makeSession(), renderer = renderLab(session)
    expect(renderer.root.findAllByProps({ className: 'lab-threshold' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ className: 'lab-error-threshold' })).toHaveLength(0)
    act(() => renderer.update(<DeveloperLab camera={camera} session={{ ...session, readings: [reading(9000, 'near_reference', .03)] }} />))
    expect(renderer.root.findAllByProps({ className: 'lab-error-threshold' })).toHaveLength(0)
    act(() => button(renderer, '예측 오차 함께 보기').props.onClick())
    expect(renderer.root.findAllByProps({ className: 'lab-error-threshold' })).toHaveLength(1)
    act(() => renderer.unmount())
  })

  it('uses the compact results layout only after registration and permits reversible camera expansion', () => {
    const session = makeSession({ phase: 'registering' }), renderer = renderLab(session)
    expect(renderer.root.findByProps({ className: 'lab-monitor' }).props['data-layout']).toBe('focus')
    act(() => renderer.update(<DeveloperLab camera={camera} session={{ ...session, phase: 'measuring' }} />))
    expect(renderer.root.findByProps({ className: 'lab-monitor' }).props['data-layout']).toBe('dashboard')
    expect(renderer.root.findAllByProps({ 'aria-label': '현재 자세 요약' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ className: 'lab-disclosure' }).every(node => !node.props.open)).toBe(true)
    act(() => button(renderer, '크게 보기').props.onClick())
    expect(renderer.root.findByProps({ className: 'lab-monitor' }).props['data-layout']).toBe('focus')
    act(() => button(renderer, '작게 보기').props.onClick())
    expect(renderer.root.findByProps({ className: 'lab-monitor' }).props['data-layout']).toBe('dashboard')
    expect(session.start).not.toHaveBeenCalled(); expect(session.stop).not.toHaveBeenCalled()
    act(() => renderer.unmount())
  })
  it('interrupts explicit collection before switching to measurement and does not start either flow on navigation', () => {
    const session = makeSession(), collection = { snapshot: emptyNormalCollection(), profile: null, connecting: false, error: '', interrupt: vi.fn(), start: vi.fn() } as unknown as NormalCollectionController
    const c = { ...camera, stop: vi.fn(), streamRef: { current: null }, canvasRef: { current: null } } as unknown as CameraController
    let renderer!: ReactTestRenderer
    act(() => { renderer = create(<DeveloperLab camera={c} session={session} collection={collection} />) })
    act(() => button(renderer, '정상 자세 수집').props.onClick())
    expect(textOf(renderer)).toContain('정상 자세 데이터 수집')
    expect(collection.start).not.toHaveBeenCalled()
    act(() => button(renderer, '실험실로 돌아가기').props.onClick())
    expect(collection.interrupt).toHaveBeenCalledOnce(); expect(c.stop).toHaveBeenCalledOnce()
    expect(session.start).not.toHaveBeenCalled()
    act(() => renderer.update(<DeveloperLab camera={c} session={{ ...session, phase: 'measuring' }} collection={collection} />))
    expect(button(renderer, '정상 자세 수집').props.disabled).toBe(true)
    act(() => renderer.unmount())
  })

  it('separates automatic and manual collection and starts automatic work only through the camera session control', () => {
    const session = makeSession(), collection = { snapshot: emptyNormalCollection(), profile: null, connecting: false, error: '',
      interrupt: vi.fn(), start: vi.fn() } as unknown as NormalCollectionController
    const automatic = { snapshot: new AutoNormalCapture('synthetic_p01', 'synthetic_capture', '2026-10-14T00:00:00Z').snapshot(),
      error: '', observe: vi.fn(), markGap: vi.fn(), endRun: vi.fn(), setEnabled: vi.fn(), setMaximumDeviation: vi.fn(), setParticipantCode: vi.fn(),
      discard: vi.fn(), downloadDataset: vi.fn() } as AutoNormalCollectionController
    const c = { ...camera, stop: vi.fn(), streamRef: { current: null }, canvasRef: { current: null } } as unknown as CameraController
    let renderer!: ReactTestRenderer
    act(() => { renderer = create(<DeveloperLab camera={c} session={session} collection={collection} automatic={automatic} />) })
    expect(textOf(renderer)).toContain('정상자세(자동)')
    expect(automatic.observe).not.toHaveBeenCalled()
    act(() => button(renderer, '정상 자세 수집').props.onClick())
    const modes = () => renderer.root.findByProps({ 'aria-label': '정상 데이터 수집 방식' }).findAllByType('button')
    expect(modes()[0].props['aria-pressed']).toBe(true)
    act(() => modes()[1].props.onClick())
    expect(textOf(renderer)).toContain('정상자세(수동)')
    expect(renderer.root.findByProps({ id: 'normal-participant' }).props.value).toBe('synthetic_p01')
    expect(button(renderer, '30초 측정하기').props.disabled).toBe(false)
    act(() => modes()[0].props.onClick())
    expect(collection.interrupt).toHaveBeenCalled()
    expect(session.start).not.toHaveBeenCalled()
    act(() => button(renderer, '자동 수집 측정 시작').props.onClick())
    expect(automatic.setEnabled).toHaveBeenCalledWith(true)
    expect(session.start).toHaveBeenCalledOnce()
    expect(collection.start).not.toHaveBeenCalled()
    act(() => renderer.unmount())
  })

})
