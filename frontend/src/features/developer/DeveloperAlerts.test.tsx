import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { ForecastReading } from '../../../../model/prototype/forecast'
import DeveloperAlerts from './DeveloperAlerts'
import type { DeveloperSession, LabAlert } from './types'

const makeSession = (patch: Partial<DeveloperSession> = {}): DeveloperSession => ({
  phase: 'idle', source: 'camera', predictor: 'hold_last', setPredictor: vi.fn(), model: null, modelStatus: 'missing', modelError: '', loadModel: vi.fn(), error: '',
  reading: null, readings: [], events: [], summary: { elapsedMs: 0, validMs: 0, nearMs: 0, unavailableMs: 0, nearPercent: null, meanError: null, deviations: 0 },
  records: [], visiblePoints: 0, start: vi.fn(), startDemo: vi.fn(), stop: vi.fn(), download: vi.fn(),
  guidance: { step: 'intro', cue: 'waiting', instruction: '', detail: '', ready: false, holdProgress: 0, introStep: 0, live: null, reference: null, lateralPercent: null, verticalPercent: null, shoulderDegrees: null },
  alerts: [], alertCount: 0, alertPeakDeviation: null, alertBasis: 'predictor', setAlertBasis: vi.fn(), soundEnabled: true, setSoundEnabled: vi.fn(), audioStatus: 'inactive', testAlertSound: vi.fn(),
  ...patch,
})
const makeReading = (patch: Partial<ForecastReading> = {}): ForecastReading => ({ schema_version: 'forecast-experiment-v1', timeMs: 16000, state: 'persistent_deviation_candidate', ruleState: 'persistent_deviation_candidate', deviation: .18, error: .01, errorLimit: .02, durationMs: 3500, progress: 1, returnedExcursions: 0, modelId: 'explicit-synthetic-hold-last', domainValidated: false, ...patch })
const makeAlert = (patch: Partial<LabAlert> = {}): LabAlert => ({ id: 1, timeMs: 15500, basis: 'predictor', kind: 'first', deviation: .18, peakDeviation: .2, durationMs: 3000, error: .01, errorLimit: .02, source: 'camera', ...patch })
const render = (session: DeveloperSession) => { let renderer: ReactTestRenderer; act(() => { renderer = create(<DeveloperAlerts session={session} />) }); return renderer! }
const textOf = (renderer: ReactTestRenderer) => JSON.stringify(renderer.toJSON())
const button = (renderer: ReactTestRenderer, text: string) => renderer.root.findAllByType('button').find(node => node.children.some(child => typeof child === 'string' && child.includes(text)))!

describe('developer deviation alarm presentation', () => {
  it('keeps composite-only alerts visible while the separate relative distance is zero', () => {
    const imagePosture: NonNullable<ForecastReading['imagePosture']> = { policy: 'image-posture-anchor-v1', status: 'ready', score: 2, translation: 0, shrink: .4, translationLimit: .45, shrinkLimit: .2, strongest: 'scale' }
    const value = makeReading({ deviation: 0, postureScore: 2, imagePosture })
    const alerts = [makeAlert({ deviation: 0, postureScore: 2, peakPostureScore: 2.1, imagePosture }), makeAlert({ id: 2, kind: 'reminder', deviation: 0, postureScore: 2, peakPostureScore: 2.1, imagePosture })]
    const renderer = render(makeSession({ reading: value, alerts, alertCount: 2, soundEnabled: false }))
    expect(textOf(renderer)).toContain('종합 이탈 ')
    expect(renderer.root.findByProps({ className: 'da-metrics' }).findAllByType('strong')[0].children).toEqual(['2.00배'])
    expect(renderer.root.findByProps({ className: 'da-meter' }).props['aria-label']).toContain('거리 기준의 0.00배')
    expect(renderer.root.findByProps({ className: 'da-recent-alerts' }).findAllByType('strong').map(node => node.children.join(''))).toEqual(['종합 2.00배', '종합 2.00배'])
    expect(button(renderer, '소리 테스트').props.disabled).toBe(true)
    act(() => renderer.update(<DeveloperAlerts session={makeSession({ reading: { ...value, postureEntryRatio: .7, postureRecoveryRatio: .7 * 2 / 3 }, alerts, alertCount: 2, soundEnabled: false })} />))
    expect(renderer.root.findAllByProps({ className: 'da-meter' })).toHaveLength(0)
    expect(textOf(renderer)).toContain('0.7')
    expect(textOf(renderer)).toContain('0.47')
    act(() => renderer.unmount())
  })
  it('does not invent a distance or an alarm before any measurement', () => {
    const renderer = render(makeSession())
    expect(renderer.root.findByProps({ className: 'da-distance-value' }).findByType('strong').children).toEqual(['—'])
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
    expect(textOf(renderer)).toContain('아직 측정 거리가 없습니다.')
    expect(textOf(renderer)).toContain('0')
    act(() => renderer.unmount())
  })

  it('shows the measured normalized distance, threshold ratio, duration, episode peak, and count', () => {
    const session = makeSession({ phase: 'measuring', reading: makeReading(), alertPeakDeviation: .25, alertCount: 2 }), renderer = render(session)
    expect(renderer.root.findByProps({ className: 'da-distance-value' }).findByType('strong').children).toEqual(['18.0'])
    const metrics = renderer.root.findByProps({ className: 'da-metrics' }).findAllByType('strong')
    expect(metrics[0].children).toEqual(['1.50배'])
    expect(metrics[1].children).toEqual(['3.5초'])
    expect(metrics[2].children).toEqual(['25.0%'])
    expect(renderer.root.findByProps({ className: 'da-alert-count' }).findByType('strong').children[0]).toBe('2')
    act(() => renderer.unmount())
  })

  it('consumes the selected rule state without reclassifying it or claiming a confirmed collapse', () => {
    const value = makeReading({ state: 'unexpected_motion_candidate', ruleState: 'persistent_deviation_candidate' })
    const session = makeSession({ reading: value, alertBasis: 'rule' }), renderer = render(session)
    const state = () => renderer.root.findAllByType('span').find(node => typeof node.props.className === 'string' && node.props.className.startsWith('da-current-state'))!
    expect(state().children).toContain('지속 이탈 후보')
    act(() => renderer.update(<DeveloperAlerts session={{ ...session, alertBasis: 'predictor' }} />))
    expect(state().children).toContain('예상 밖 움직임 · 복귀 확인')
    expect(textOf(renderer)).not.toContain('붕괴 확정')
    act(() => renderer.unmount())
  })

  it('freezes the basis while guiding but keeps mute and sound testing available', () => {
    const session = makeSession({ phase: 'guiding' }), renderer = render(session)
    expect(renderer.root.findByType('select').props.disabled).toBe(true)
    expect(button(renderer, '알림 소리 켜짐').props.disabled).toBeUndefined()
    act(() => button(renderer, '알림 소리 켜짐').props.onClick())
    expect(session.setSoundEnabled).toHaveBeenCalledWith(false)
    act(() => button(renderer, '소리 테스트').props.onClick())
    expect(session.testAlertSound).toHaveBeenCalledOnce()
    expect(session.alertCount).toBe(0)
    act(() => renderer.update(<DeveloperAlerts session={{ ...session, phase: 'finished' }} />))
    expect(renderer.root.findByType('select').props.disabled).toBe(false)
    act(() => renderer.root.findByType('select').props.onChange({ target: { value: 'rule' } }))
    expect(session.setAlertBasis).toHaveBeenCalledWith('rule')
    act(() => renderer.unmount())
  })

  it('prioritizes preparation and measurement quality over a persistent rule result', () => {
    for (const state of ['needs_reference', 'registering', 'warming', 'unmeasurable'] as const) {
      const renderer = render(makeSession({ alertBasis: 'rule', reading: makeReading({ state, ruleState: 'persistent_deviation_candidate' }) }))
      const badge = renderer.root.findAllByType('span').find(node => typeof node.props.className === 'string' && node.props.className.startsWith('da-current-state'))!
      expect(badge.children).not.toContain('지속 이탈 후보')
      expect(badge.props.className).toContain('da-tone-neutral')
      act(() => renderer.unmount())
    }
  })

  it('marks finished and failed session values as the last observation', () => {
    for (const phase of ['finished', 'error'] as const) {
      const renderer = render(makeSession({ phase, reading: makeReading() }))
      expect(textOf(renderer)).toContain('종료된 실험의 마지막 관측입니다.')
      expect(textOf(renderer)).toContain('마지막 관측 거리')
      act(() => renderer.unmount())
    }
  })

  it('disables sound testing while muted and explains how to enable it', () => {
    const renderer = render(makeSession({ soundEnabled: false, audioStatus: 'ready' }))
    expect(button(renderer, '소리 테스트').props.disabled).toBe(true)
    expect(textOf(renderer)).toContain('소리를 켜면 테스트할 수 있습니다.')
    act(() => renderer.unmount())
  })

  it('keeps the announced alert snapshot unchanged while live distance updates at frame rate', () => {
    const alert = makeAlert(), session = makeSession({ phase: 'measuring', reading: makeReading(), alerts: [alert], alertCount: 1 }), renderer = render(session)
    const before = renderer.root.findByProps({ role: 'alert' }).findByType('p').children.join('')
    act(() => renderer.update(<DeveloperAlerts session={{ ...session, reading: makeReading({ timeMs: 18000, deviation: .45, durationMs: 6000 }), alertPeakDeviation: .45 }} />))
    expect(renderer.root.findByProps({ role: 'alert' }).findByType('p').children.join('')).toBe(before)
    expect(before).toContain('18.0%')
    expect(before).not.toContain('45.0%')
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(1)
    act(() => renderer.unmount())
  })

  it('announces synthetic reminders as synthetic and shows only the latest three alert records', () => {
    const alerts = Array.from({ length: 5 }, (_, i) => makeAlert({ id: i + 1, source: 'synthetic', kind: i === 0 ? 'first' : 'reminder', timeMs: 15500 + i * 60000 }))
    const renderer = render(makeSession({ source: 'synthetic', alerts, alertCount: 5 }))
    expect(renderer.root.findByProps({ role: 'alert' }).findByType('strong').children.join('')).toContain('합성 데모 알림')
    expect(renderer.root.findByProps({ className: 'da-recent-alerts' }).findAllByType('li')).toHaveLength(3)
    expect(textOf(renderer)).toContain('같은 사건 재알림')
    act(() => renderer.unmount())
  })

  it('explains blocked audio and disables testing only when audio is unsupported', () => {
    const session = makeSession({ audioStatus: 'blocked' }), renderer = render(session)
    expect(textOf(renderer)).toContain('브라우저가 소리를 차단했습니다.')
    expect(button(renderer, '소리 테스트').props.disabled).toBe(false)
    act(() => renderer.update(<DeveloperAlerts session={{ ...session, audioStatus: 'unsupported' }} />))
    expect(button(renderer, '소리 테스트').props.disabled).toBe(true)
    expect(button(renderer, '알림 소리 켜짐').props.disabled).toBeUndefined()
    act(() => renderer.unmount())
  })

  it('keeps optional measurements and policy collapsed while sound controls remain directly accessible', () => {
    const renderer = render(makeSession())
    expect(renderer.root.findAllByType('details')).toHaveLength(2)
    for (const detail of renderer.root.findAllByType('details')) {
      expect(detail.props.open).toBeUndefined()
      expect(detail.findAllByType('button')).toHaveLength(0)
      expect(detail.findAllByType('select')).toHaveLength(0)
    }
    const text = textOf(renderer)
    expect(text).toContain('아직 발생한 알림이 없습니다.')
    expect(text).toContain('측정 수치 자세히')
    expect(text).toContain('알림이 울리는 기준')
    expect(text).toContain('최근 ')
    expect(text).toContain('스트레칭과 자세 붕괴의 의도를 구분하지 않습니다.')
    expect(text).toContain('오래 유지한 스트레칭도 지속 이탈 후보가 될 수 있습니다.')
    expect(text).toContain('같은 이탈이 이어지면 ')
    expect(text).toContain('최소 기준 2%')
    expect(text).not.toContain('개인 한계')
    act(() => renderer.unmount())
  })
})
