import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { liveForecastPoints, type ForecastReading } from '../../../../model/prototype/forecast'
import DeveloperDecisionNumbers, { screenWidthChange } from './DeveloperDecisionNumbers'
import type { DeveloperSession, LabAlert, LabGuideFrame } from './types'

const reading = (patch: Partial<ForecastReading> = {}): ForecastReading => ({
  schema_version: 'forecast-experiment-v1', evaluationMode: 'observed-v2', timeMs: 12000,
  state: 'warming', ruleState: 'persistent_deviation_candidate', deviation: .2, error: null, errorLimit: .02,
  durationMs: 3300, ruleDurationMs: 3200, ruleReturnedExcursions: 2, returnedExcursions: 7,
  ruleRecoveryMs: 0, predictionRecoveryMs: 0, progress: 1, modelId: 'explicit-synthetic-test', domainValidated: false, ...patch,
})
const session = (patch: Partial<DeveloperSession> = {}) => ({
  phase: 'measuring', source: 'synthetic', alertBasis: 'rule', soundEnabled: false,
  reading: reading(), alerts: [], alertCount: 0,
  guidance: { live: null, reference: null, lateralPercent: null, verticalPercent: null, shoulderDegrees: null },
  ...patch,
} as DeveloperSession)
const render = (s: DeveloperSession) => { let tree!: ReactTestRenderer; act(() => { tree = create(<DeveloperDecisionNumbers session={s} />) }); return tree }
const value = (tree: ReactTestRenderer, key: string) => tree.root.findByProps({ 'data-testid': `decision-${key}` }).children.join('')
const text = (tree: ReactTestRenderer) => JSON.stringify(tree.toJSON())
const alert: LabAlert = { id: 1, timeMs: 12000, basis: 'rule', kind: 'first', deviation: .2, peakDeviation: .2, durationMs: 3200, error: null, errorLimit: .02, source: 'synthetic' }
const frame = (): LabGuideFrame => ({ timeMs: 12000, width: 640, height: 480, points: Array.from({ length: 13 }, (_, i) => ({ x: i === 11 ? .3 : i === 12 ? .7 : .5, y: i < 11 ? .3 : .6, visibility: 1 })) })

describe('live test numbers from actual policy and alert events', () => {
  it('shows whole-body and composite scores independently of a near-zero relative normal score', () => {
    const r = reading({ normalProfileId: 'explicit-synthetic-profile', normalScore: .1, deviation: 0, postureScore: 2,
      imagePosture: { policy: 'image-posture-anchor-v1', status: 'ready', score: 2, translation: 0, shrink: .4, translationLimit: .45, shrinkLimit: .2, strongest: 'scale' } })
    const tree = render(session({ reading: r }))
    expect(text(tree)).toContain('2.00 / 1.00배')
    expect(text(tree)).toContain('0.10')
    expect(text(tree)).toContain('40.0 / 20.0%')
    expect(text(tree)).toContain('이전 기준의 측정')
    expect(value(tree, 'persistent')).toBe('1')
    act(() => tree.update(<DeveloperDecisionNumbers session={session({ reading: { ...r, postureEntryRatio: .7, postureRecoveryRatio: .7 * 2 / 3 } })} />))
    expect(text(tree)).toContain('2.00 / 0.70배')
    act(() => tree.unmount())
  })
  it('shows unknown flags before registration and never invents a normal or zero measurement', () => {
    const tree = render(session({ phase: 'idle', reading: null }))
    for (const key of ['pending', 'returned', 'persistent', 'duration', 'alert']) expect(value(tree, key)).toBe('—')
    expect(value(tree, 'count')).toBe('0회')
    expect(text(tree)).toContain('무음 테스트')
    expect(text(tree)).toContain('이동 ')
    expect(text(tree)).toContain('18')
    expect(text(tree)).toContain('12')
    act(() => tree.unmount())
  })
  it('keeps observed rule numbers available during LSTM warmup and uses its own counters', () => {
    const tree = render(session())
    expect(value(tree, 'persistent')).toBe('1')
    expect(value(tree, 'pending')).toBe('0')
    expect(value(tree, 'duration')).toBe('3.2초')
    expect(value(tree, 'returned')).toBe('2회')
    act(() => tree.update(<DeveloperDecisionNumbers session={session({ alertBasis: 'predictor', reading: reading({ state: 'unexpected_motion_candidate' }) })} />))
    expect(value(tree, 'pending')).toBe('1')
    expect(value(tree, 'duration')).toBe('3.3초')
    expect(value(tree, 'returned')).toBe('7회')
    act(() => tree.unmount())
  })
  it('pulses only for a delivered event, then expires, without turning persistence into another alert', () => {
    const s = session({ alerts: [alert], alertCount: 1 }), tree = render(s)
    expect(value(tree, 'alert')).toBe('1')
    act(() => tree.update(<DeveloperDecisionNumbers session={{ ...s, reading: reading({ timeMs: 13000 }) }} />))
    expect(value(tree, 'alert')).toBe('0')
    expect(value(tree, 'persistent')).toBe('1')
    expect(value(tree, 'count')).toBe('1회')
    act(() => tree.update(<DeveloperDecisionNumbers session={{ ...s, phase: 'finished' }} />))
    expect(value(tree, 'alert')).toBe('0')
    expect(text(tree)).toContain('종료된 측정의 기록')
    act(() => tree.unmount())
  })
  it('hides decision flags and screen values on quality loss while preserving historical deliveries', () => {
    const f = frame(), tree = render(session({ alerts: [alert], alertCount: 1, reading: reading({ state: 'unmeasurable', ruleState: 'unmeasurable', deviation: null }), guidance: { live: f, reference: f, lateralPercent: 40, verticalPercent: 30, shoulderDegrees: 20 } as DeveloperSession['guidance'] }))
    for (const key of ['pending', 'persistent', 'duration', 'alert']) expect(value(tree, key)).toBe('—')
    expect(value(tree, 'count')).toBe('1회')
    expect(text(tree)).not.toContain('+40.0%')
    expect(text(tree)).not.toContain('+30.0%')
    act(() => tree.unmount())
  })
  it('shows recovery progress without calling it another pending or persistent event', () => {
    const tree = render(session({ reading: reading({ ruleState: 'recovery_pending', ruleDurationMs: 0, ruleRecoveryMs: 1700 }) }))
    expect(value(tree, 'pending')).toBe('0'); expect(value(tree, 'persistent')).toBe('0')
    expect(text(tree)).toContain('1.7초 / 3.0초')
    act(() => tree.unmount())
  })
  it('shows the fitted normal ratio separately from geometric distance and preserves the engine verdict', () => {
    const tree = render(session({ reading: reading({ normalProfileId: 'explicit-synthetic-profile', normalScore: .8, deviation: .3, ruleState: 'near_reference', ruleDurationMs: 0 }) }))
    expect(text(tree)).toContain('0.80 / 1.00배')
    expect(text(tree)).not.toContain('30.0 / 12.0%')
    expect(value(tree, 'persistent')).toBe('0')
    act(() => tree.unmount())
  })
  it('exposes scale changes removed by world shoulder normalization, without creating a posture verdict', () => {
    const f = frame(), smaller = { ...f, points: f.points.map(p => ({ ...p, x: p.x * .5 + .2, y: p.y * .5 + .2 })) }
    const world = f.points.map(p => ({ ...p, z: .1 }))
    const normalized = liveForecastPoints(world, world)!
    const transformed = liveForecastPoints(smaller.points.map(p => ({ ...p, z: .1 })), world.map(p => ({ ...p, x: p.x * 2 + 3, y: p.y * 2 - 1, z: p.z * 2 + 4 })))!
    expect(normalized).toHaveLength(39)
    normalized.forEach((v, i) => expect(transformed[i]).toBeCloseTo(v, 10))
    expect(screenWidthChange(smaller, f)).toBeCloseTo(-50)
    expect(screenWidthChange({ ...smaller, height: 640 }, f)).toBeNull()
    expect(screenWidthChange({ ...f, points: f.points.map(p => ({ ...p, visibility: .1 })) }, f)).toBeNull()
  })
})
