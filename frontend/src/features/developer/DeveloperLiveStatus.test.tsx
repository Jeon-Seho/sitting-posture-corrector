import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { ForecastReading } from '../../../../model/prototype/forecast'
import DeveloperLiveStatus from './DeveloperLiveStatus'
import type { DeveloperSession } from './types'

const makeSession = (patch: Partial<DeveloperSession> = {}): DeveloperSession => ({
  phase: 'idle', source: 'camera', predictor: 'hold_last', setPredictor: vi.fn(), model: null, modelStatus: 'missing', modelError: '', loadModel: vi.fn(), error: '',
  reading: null, readings: [], events: [], summary: { elapsedMs: 0, validMs: 0, nearMs: 0, unavailableMs: 0, nearPercent: null, meanError: null, deviations: 0 },
  records: [], visiblePoints: 0, start: vi.fn(), startDemo: vi.fn(), stop: vi.fn(), download: vi.fn(),
  guidance: { step: 'intro', cue: 'waiting', instruction: '', detail: '', ready: false, holdProgress: 0, introStep: 0, live: null, reference: null, lateralPercent: null, verticalPercent: null, shoulderDegrees: null },
  alerts: [], alertCount: 0, alertPeakDeviation: null, alertBasis: 'predictor', setAlertBasis: vi.fn(), soundEnabled: true, setSoundEnabled: vi.fn(), audioStatus: 'inactive', testAlertSound: vi.fn(),
  ...patch,
})
const makeReading = (patch: Partial<ForecastReading> = {}): ForecastReading => ({
  schema_version: 'forecast-experiment-v1', timeMs: 16000, state: 'persistent_deviation_candidate', ruleState: 'persistent_deviation_candidate',
  deviation: .18, error: .01, errorLimit: .02, durationMs: 3500, progress: 1, returnedExcursions: 0,
  modelId: 'explicit-synthetic-hold-last', domainValidated: false, ...patch,
})
const render = (session: DeveloperSession) => { let renderer: ReactTestRenderer; act(() => { renderer = create(<DeveloperLiveStatus session={session} />) }); return renderer! }
const text = (renderer: ReactTestRenderer) => JSON.stringify(renderer.toJSON())
const metric = (renderer: ReactTestRenderer, name: string) => renderer.root.findByProps({ className: name }).findByType('strong')

describe('developer compact live result', () => {
  it('shows composite departure even when the personal normal and relative geometry remain near zero', () => {
    const r = makeReading({ evaluationMode: 'observed-v2', state: 'warming', ruleState: 'persistent_deviation_candidate',
      normalProfileId: 'synthetic-profile', normalScore: .1, deviation: 0, postureScore: 1.8,
      imagePosture: { policy: 'image-posture-anchor-v1', status: 'ready', score: 1.8, translation: 0, shrink: .36, translationLimit: .45, shrinkLimit: .2, strongest: 'scale' } })
    const tree = render(makeSession({ phase: 'measuring', alertBasis: 'rule', reading: r }))
    expect(metric(tree, 'dls-distance').children[0]).toBe('1.8')
    expect(text(tree)).toContain('종합 이탈 기준 대비')
    expect(text(tree)).toContain('자세 변화가 이어져요')
    expect(tree.root.findByProps({ role: 'img' }).props['aria-label']).toContain('종합 이탈 경계 1.0배')
    expect(text(tree)).toContain('1배 초과가 3초 이어지면 시각 알림')
    act(() => tree.update(<DeveloperLiveStatus session={makeSession({ phase: 'measuring', alertBasis: 'rule', reading: { ...r, postureEntryRatio: .7, postureRecoveryRatio: .7 * 2 / 3 } })} />))
    expect(tree.root.findByProps({ role: 'img' }).props['aria-label']).toContain('종합 이탈 경계 0.7배')
    expect(text(tree)).toContain('0.7배 초과가 3초 이어지면 시각 알림')
    act(() => tree.update(<DeveloperLiveStatus session={makeSession({ phase: 'measuring', alertBasis: 'predictor', reading: r })} />))
    expect(text(tree)).toContain('예측 오차 조건을 함께 확인하며, 이탈이 5초')
    act(() => tree.update(<DeveloperLiveStatus session={makeSession({ reading: { ...r, state: 'unmeasurable', ruleState: 'unmeasurable', postureScore: null, imagePosture: { ...r.imagePosture!, status: 'needs_reference', score: null } } })} />))
    expect(metric(tree, 'dls-distance').children).toEqual(['—'])
    expect(text(tree)).toContain('새 측정으로 기준을 다시 등록')
    act(() => tree.unmount())
  })
  it('shows no invented distance or duration before observations arrive', () => {
    const renderer = render(makeSession())
    expect(metric(renderer, 'dls-distance').children).toEqual(['—'])
    expect(metric(renderer, 'dls-duration').children[0]).toBe('—')
    expect(text(renderer)).toContain('시작하면 여기에 보여요')
    expect(renderer.root.findByProps({ role: 'img' }).props['aria-label']).toContain('측정값 없음')
    act(() => renderer.unmount())
  })

  it.each(['needs_reference', 'registering', 'warming', 'unmeasurable'] as const)('never turns %s into a positive rule result or stale numeric values', state => {
    const renderer = render(makeSession({ phase: 'measuring', alertBasis: 'rule', reading: makeReading({ state, ruleState: 'near_reference' }) }))
    expect(text(renderer)).not.toContain('기준 범위 안이에요')
    expect(metric(renderer, 'dls-distance').children).toEqual(['—'])
    expect(metric(renderer, 'dls-duration').children[0]).toBe('—')
    expect(renderer.root.findByType('section').props.className).toContain('dls-tone-neutral')
    act(() => renderer.unmount())
  })

  it('uses the chosen engine state without classifying the numeric distance again', () => {
    const session = makeSession({ phase: 'measuring', reading: makeReading({ state: 'unexpected_motion_candidate', ruleState: 'persistent_deviation_candidate', deviation: .09 }), alertBasis: 'rule' })
    const renderer = render(session)
    expect(text(renderer)).toContain('자세 변화가 이어져요')
    expect(text(renderer)).toContain('거리 + 지속시간')
    act(() => renderer.update(<DeveloperLiveStatus session={{ ...session, alertBasis: 'predictor' }} />))
    expect(text(renderer)).toContain('움직임을 확인하고 있어요')
    expect(text(renderer)).not.toContain('자세 변화가 이어져요')
    act(() => renderer.unmount())
  })

  it('explains the normalized distance and keeps values outside the live announcement', () => {
    const session = makeSession({ phase: 'measuring', predictor: 'lstm', reading: makeReading(), alertCount: 2 })
    const renderer = render(session)
    expect(metric(renderer, 'dls-distance').children[0]).toBe('18.0')
    expect(metric(renderer, 'dls-duration').children[0]).toBe('3.5')
    expect(text(renderer)).toContain('어깨 너비를 100%로 본 변화 거리예요.')
    expect(text(renderer)).toContain('건강 점수가 아니며')
    expect(renderer.root.findByProps({ role: 'img' }).props['aria-label']).toContain('거리 기준 12%')
    expect(text(renderer)).toContain('LSTM + 거리·시간')
    const announcement = JSON.stringify(renderer.root.findByProps({ role: 'status' }).findByType('p').children)
    act(() => renderer.update(<DeveloperLiveStatus session={{ ...session, reading: makeReading({ deviation: .25, durationMs: 4100 }) }} />))
    expect(metric(renderer, 'dls-distance').children[0]).toBe('25.0')
    expect(JSON.stringify(renderer.root.findByProps({ role: 'status' }).findByType('p').children)).toBe(announcement)
    act(() => renderer.unmount())
  })

  it.each(['finished', 'error'] as const)('labels a %s session as its last observation', phase => {
    const renderer = render(makeSession({ phase, reading: makeReading({ state: 'near_reference' }), source: 'synthetic' }))
    expect(text(renderer)).toContain('마지막 측정 결과')
    expect(text(renderer)).toContain('현재 자세는 측정하지 않아요.')
    expect(text(renderer)).toContain('합성 데모')
    expect(renderer.root.findByProps({ role: 'img' }).props['aria-label']).toContain('마지막 기준 차이')
    act(() => renderer.unmount())
  })

  it('keeps mute available during measurement and exposes blocked sound without claiming it works', () => {
    const session = makeSession({ phase: 'measuring', soundEnabled: true, audioStatus: 'blocked' })
    const renderer = render(session)
    const button = renderer.root.findByType('button')
    expect(button.props['aria-label']).toBe('알림 소리 끄기')
    expect(button.props['aria-pressed']).toBe(true)
    act(() => button.props.onClick())
    expect(session.setSoundEnabled).toHaveBeenCalledWith(false)
    expect(text(renderer)).toContain('소리 차단됨')
    act(() => renderer.update(<DeveloperLiveStatus session={{ ...session, soundEnabled: false }} />))
    expect(renderer.root.findByType('button').props['aria-label']).toBe('알림 소리 켜기')
    expect(text(renderer)).not.toContain('소리 차단됨')
    act(() => renderer.unmount())
  })
  it('shows a valid observed rule alert while LSTM is warming and keeps normal score separate from geometry', () => {
    const session = makeSession({ phase: 'measuring', alertBasis: 'rule', reading: makeReading({
      evaluationMode: 'observed-v2', state: 'warming', ruleState: 'persistent_deviation_candidate',
      normalScore: 1.4, normalProfileId: 'synthetic-profile', deviation: .07, error: null,
    }) })
    const renderer = render(session)
    expect(text(renderer)).toContain('자세 변화가 이어져요')
    expect(metric(renderer, 'dls-distance').children[0]).toBe('1.4')
    expect(text(renderer)).toContain('정상 범위 경계 1.0배')
    expect(text(renderer)).not.toContain('거리 기준 12%')
    expect(text(renderer)).toContain('자세 비교와 알림은 계속됩니다.')
    act(() => renderer.update(<DeveloperLiveStatus session={{ ...session, reading: { ...session.reading!, state: 'unmeasurable', ruleState: 'unmeasurable', normalScore: null, deviation: null } }} />))
    expect(metric(renderer, 'dls-distance').children).toEqual(['—'])
    act(() => renderer.unmount())
  })

})
