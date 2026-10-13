import { describe, expect, it } from 'vitest'
import { LiveForecastExperiment, type ForecastReading } from '../../../../model/prototype/forecast'
import { LAB_LIMITS, LabAccumulator, exportLabRecord, syntheticForecastValues } from './session'

const reading = (timeMs: number, state: ForecastReading['state'] = 'near_reference', error: number | null = .01): ForecastReading => ({
  schema_version: 'forecast-experiment-v1', timeMs, state, ruleState: state,
  deviation: .01, error, errorLimit: .02, durationMs: 0, progress: 0, returnedExcursions: 0,
  modelId: 'hold_last', domainValidated: false,
})

describe('developer session aggregation with explicit synthetic observations', () => {
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

})
