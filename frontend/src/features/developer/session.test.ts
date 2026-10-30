import { describe, expect, it } from 'vitest'
import { LiveForecastExperiment, type ForecastReading } from '../../../../model/prototype/forecast'
import { LAB_LIMITS, LabAccumulator, exportLabRecord, syntheticForecastValues } from './session'

const reading = (timeMs: number, state: ForecastReading['state'] = 'near_reference', error: number | null = .01): ForecastReading => ({
  schema_version: 'forecast-experiment-v1', timeMs, state, ruleState: state,
  deviation: .01, error, errorLimit: .02, durationMs: 0, progress: 0, returnedExcursions: 0,
  modelId: 'hold_last', domainValidated: false,
})

describe('developer session aggregation with explicit synthetic observations', () => {
  it('exports scalar composite provenance while removing nested image reference payloads', () => {
    const r = { ...reading(0), postureScore: 2, imagePosture: { policy: 'image-posture-anchor-v1' as const, status: 'ready' as const,
      score: 2, translation: 0, shrink: .4, translationLimit: .45, shrinkLimit: .2, strongest: 'scale' as const,
      rawImage: [{ x: 99 }], reference: { participantCode: 'private' } } }
    const out = exportLabRecord({ id: 'synthetic', startedAt: '2026-10-15T00:00:00Z', source: 'synthetic', predictor: 'hold_last',
      modelId: 'hold_last', modelSha256: null, summary: new LabAccumulator('rule').snapshot(0), readings: [r], events: [] })
    expect(out.readings[0]).toMatchObject({ postureScore: 2, imagePosture: { policy: 'image-posture-anchor-v1', score: 2 } })
    expect(JSON.stringify(out)).not.toMatch(/rawImage|participantCode|private|"reference"/)
    const updated = exportLabRecord({ id: 'synthetic-seven', startedAt: '2026-10-15T00:00:00Z', source: 'synthetic', predictor: 'hold_last',
      modelId: 'hold_last', modelSha256: null, summary: new LabAccumulator('rule').snapshot(0),
      readings: [{ ...r, evaluationMode: 'observed-v2', postureEntryRatio: .7, postureRecoveryRatio: .7 * 2 / 3 }], events: [] })
    expect(updated.readings[0]).toMatchObject({ postureEntryRatio: .7, postureRecoveryRatio: .7 * 2 / 3 })
    expect(updated.observation_settings).toMatchObject({ composite_entry_ratio: .7, composite_recovery_ratio: .7 * 2 / 3 })
    expect(out.readings[0]).not.toHaveProperty('postureEntryRatio')
  })
  it('excludes registration, warming, quality loss and gaps from valid/near time', () => {
    const a = new LabAccumulator()
    a.add(reading(0, 'registering', 90)); a.add(reading(100, 'registering', 90))
    a.add(reading(200, 'warming', null)); a.add(reading(300)); a.add(reading(400))
    a.add(reading(500, 'deviation_pending')); a.add(reading(600, 'unmeasurable', null))
    a.add(reading(1600)); a.add(reading(1700))
    const summary = a.snapshot(2000)
    expect(summary).toMatchObject({ elapsedMs: 2000, validMs: 300, nearMs: 200, unavailableMs: 1100, deviations: 0 })
    expect(summary.nearPercent).toBeCloseTo(200 / 3)
    expect(summary.meanError).toBeCloseTo(.01)
  })

  it('counts a persistent episode once until completed recovery or missing observations', () => {
    const a = new LabAccumulator()
    a.add(reading(0, 'persistent_deviation_candidate'))
    a.add(reading(100, 'recovery_pending')); a.add(reading(200, 'persistent_deviation_candidate'))
    expect(a.snapshot(200).deviations).toBe(1)
    a.add(reading(300, 'near_reference')); a.add(reading(400, 'persistent_deviation_candidate'))
    a.add(reading(500, 'unmeasurable')); a.add(reading(600, 'persistent_deviation_candidate'))
    expect(a.snapshot(600).deviations).toBe(3)
    a.add(reading(1000, 'persistent_deviation_candidate'))
    expect(a.snapshot(1000).deviations).toBe(4)
  })

  it('keeps full-run statistics while bounding traces and rejecting nonmonotonic readings', () => {
    const a = new LabAccumulator()
    for (let i = 0; i <= 4000; i++) a.add(reading(i * 100))
    expect(a.readings).toHaveLength(LAB_LIMITS.readings)
    expect(a.snapshot(400000).validMs).toBe(400000)
    expect(a.add(reading(100))).toBe(false)
    expect(a.add(reading(Number.NaN))).toBe(false)
    for (let i = 0; i < 150; i++) a.event(i, '합성 사건')
    expect(a.events).toHaveLength(LAB_LIMITS.events)
  })

  it('follows the model continuity boundary for a 200ms sample gap', () => {
    const a = new LabAccumulator()
    a.add(reading(0, 'persistent_deviation_candidate'))
    a.add(reading(200, 'warming'))
    a.add(reading(300, 'persistent_deviation_candidate'))
    expect(a.snapshot(300)).toMatchObject({ unavailableMs: 200, validMs: 0, deviations: 2 })
  })

  it('runs the deterministic demo through registration, excursion, deviation, recovery and missing data', () => {
    const core = new LiveForecastExperiment(null, 'hold_last'), a = new LabAccumulator()
    core.register()
    for (let t = 0; t <= 40000; t += 100) {
      const r = core.step(t, syntheticForecastValues(t)); if (r) a.add(r)
    }
    const states = new Set(a.readings.map(r => r.state))
    for (const state of ['registering', 'near_reference', 'deviation_pending', 'persistent_deviation_candidate', 'recovery_pending', 'unmeasurable', 'warming']) expect(states.has(state as ForecastReading['state'])).toBe(true)
    expect(a.readings.some(r => r.returnedExcursions === 1)).toBe(true)
    expect(a.snapshot(40000).deviations).toBe(1)
  })

  it('exports only diagnostic readings and explicit provenance, never input coordinates or weights', () => {
    const r = { ...reading(0), landmarks: [{ x: 999 }], video: 'private', weights: [888] }
    const a = new LabAccumulator(); a.add(r)
    const exported = exportLabRecord({ id: 'synthetic', startedAt: '2026-10-13T00:00:00Z',
      source: 'synthetic', predictor: 'hold_last', modelId: 'hold_last', modelSha256: null,
      summary: a.snapshot(0), readings: [r], events: a.events })
    expect(exported).toMatchObject({ schema_version: 'developer-lab-export-v1', source: 'synthetic', domain_validated: false, model_sha256: null })
    expect(JSON.stringify(exported)).not.toMatch(/landmarks|private|weights/)
    expect(exported.summary_definition.near_percent).toContain('not_accuracy')
  })
  it('exports bounded whitelisted alarm snapshots, settings and full count without input or audio data', () => {
    const alerts = Array.from({ length: 110 }, (_, id) => ({ id: id + 1, timeMs: id * 100,
      basis: 'predictor' as const, kind: 'first' as const, deviation: .15, peakDeviation: .17,
      durationMs: 3000, error: .01, errorLimit: .02, source: 'synthetic' as const,
      landmarks: [999], audioContext: 'private', video: 'private',
    }))
    const exported = exportLabRecord({ id: 'synthetic', startedAt: '2026-10-13T00:00:00Z',
      source: 'synthetic', predictor: 'hold_last', modelId: 'hold_last', modelSha256: null,
      summary: new LabAccumulator().snapshot(0), readings: [], events: [], alerts,
      alertCount: 110, alertSettings: { basis: 'predictor', reminderMs: 60000 },
    })
    expect(exported).toMatchObject({ alert_count: 110, alert_limit: 100, alert_settings: { basis: 'predictor', reminder_ms: 60000 } })
    expect(exported.alerts).toHaveLength(100); expect(exported.alerts![0].id).toBe(11)
    expect(JSON.stringify(exported)).not.toMatch(/landmarks|audioContext|private|video/)
  })

  it('counts observed rule time and incidents independently of forecast readiness, and excludes actual gaps', () => {
    const a = new LabAccumulator('rule')
    const observed = (t: number): ForecastReading => ({ ...reading(t, 'warming', null), evaluationMode: 'observed-v2', ruleState: 'persistent_deviation_candidate' })
    a.add(observed(0)); a.add(observed(200)); a.add(observed(400))
    expect(a.snapshot(400)).toMatchObject({ validMs: 400, unavailableMs: 0, deviations: 1 })
    a.add({ ...observed(500), state: 'unmeasurable', ruleState: 'unmeasurable' })
    a.add(observed(600)); a.add(observed(800)); a.add(observed(1100))
    expect(a.snapshot(1100)).toMatchObject({ validMs: 600, unavailableMs: 500, deviations: 3 })
  })
  it('exports personal-model scores and actual observation policy without profile coordinates', () => {
    const r = { ...reading(0), evaluationMode: 'observed-v2' as const, normalScore: 1.3, normalProfileId: 'synthetic-profile', predictionTimeMs: null,
      profile: { center: [99], participantCode: 'private-person' } }
    const a = new LabAccumulator('rule'); a.add(r)
    const result = exportLabRecord({ id: 'synthetic', source: 'synthetic', predictor: 'hold_last',
      startedAt: '2026-10-14T00:00:00Z', modelId: 'hold_last', modelSha256: null,
      normalProfileId: 'synthetic-profile', readings: [r], events: [], summary: a.snapshot(0),
      alertSettings: { basis: 'rule', reminderMs: 60000 } })
    expect(result.observation_settings).toMatchObject({ maximum_gap_ms: 250, summary_basis: 'rule', normal_entry_ratio: 1 })
    expect(result.observation_settings).not.toHaveProperty('predictor_max_gap_ms')
    expect(result.readings[0]).toMatchObject({ normalScore: 1.3, normalProfileId: 'synthetic-profile' })
    expect(JSON.stringify(result)).not.toMatch(/private-person|"center"|"profile"/)
  })

  it('records the predictor-only cadence setting without rewriting old observed readings', () => {
    const core = new LiveForecastExperiment(null, 'hold_last', { mode: 'observed' })
    core.register()
    const r = core.step(0, syntheticForecastValues(0))!
    const result = exportLabRecord({ id: 'synthetic-cadence', source: 'synthetic', predictor: 'hold_last',
      startedAt: '2026-10-14T00:00:00Z', modelId: 'hold_last', modelSha256: null,
      readings: [r], events: [], summary: new LabAccumulator().snapshot(0) })
    expect(result.observation_settings).toMatchObject({ maximum_gap_ms: 250, predictor_max_gap_ms: 500 })
    expect(result.readings[0].predictionInputMaxGapMs).toBe(500)
  })

})
