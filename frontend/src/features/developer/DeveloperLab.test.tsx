import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { CameraController } from '../../hooks/useCamera'
import type { ForecastReading } from '../../../../model/prototype/forecast'
import DeveloperLab from './DeveloperLab'
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
    expect(renderer.root.findByType('fieldset').props.disabled).toBe(true)
    expect(renderer.root.findAllByType('input').find(i => i.props.type === 'file')!.props.disabled).toBe(true)
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

  it('uses the core rule threshold and only displays a personal error limit after registration', () => {
    const session = makeSession(), renderer = renderLab(session)
    expect(renderer.root.findAllByProps({ className: 'lab-threshold' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ className: 'lab-error-threshold' })).toHaveLength(0)
    act(() => renderer.update(<DeveloperLab camera={camera} session={{ ...session, readings: [reading(9000, 'near_reference', .03)] }} />))
    expect(renderer.root.findAllByProps({ className: 'lab-error-threshold' })).toHaveLength(1)
    act(() => renderer.unmount())
  })
})
