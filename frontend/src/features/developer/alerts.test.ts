import { describe, expect, it } from 'vitest'
import { ALERT_SETTINGS, DeveloperAlertTracker } from './alerts'
import { LiveForecastExperiment, type ForecastReading } from '../../../../model/prototype/forecast'
const reading = (timeMs: number, patch: Partial<ForecastReading> = {}): ForecastReading => ({
  schema_version: 'forecast-experiment-v1', timeMs, state: 'persistent_deviation_candidate',
  ruleState: 'persistent_deviation_candidate', deviation: .15, durationMs: 5000, error: .01, errorLimit: .02,
  progress: 1, returnedExcursions: 0, modelId: 'explicit-synthetic', domainValidated: false, ...patch,
})
describe('developer notification delivery with explicit synthetic readings', () => {
  it('waits for core persistence rather than inventing a movement classifier', () => {
    const t = new DeveloperAlertTracker('predictor', 'camera')
    expect(t.observe(reading(0, { state: 'unexpected_motion_candidate', deviation: .3 }))).toBeNull()
    expect(t.observe(reading(100, { state: 'deviation_pending' }))).toBeNull()
    expect(t.observe(reading(200))).toMatchObject({ id: 1, kind: 'first', peakDeviation: .3, source: 'camera', durationMs: 5000 })
  })
  it('delivers once per event and reminds only after 60 seconds of continuous observations', () => {
    const t = new DeveloperAlertTracker('predictor', 'synthetic')
    expect(t.observe(reading(0))?.kind).toBe('first')
    for (let time = 100; time < 60000; time += 100) expect(t.observe(reading(time))).toBeNull()
    expect(t.observe(reading(60000))).toMatchObject({ id: 2, kind: 'reminder', source: 'synthetic' })
  })
  it('does not repeat the first alert during recovery bounces and resolves only completed recovery', () => {
    const t = new DeveloperAlertTracker('predictor', 'camera')
    t.observe(reading(0)); t.observe(reading(100, { state: 'recovery_pending', deviation: .04 }))
    expect(t.observe(reading(200))).toBeNull()
    t.observe(reading(300, { state: 'near_reference', deviation: .02 }))
    expect(t.peakDeviation).toBeNull()
    expect(t.observe(reading(400))).toMatchObject({ id: 2, kind: 'first', peakDeviation: .15 })
  })
  it.each(['unmeasurable', 'registering', 'needs_reference'] as const)('suppresses %s and waits for a new valid core incident', state => {
    const t = new DeveloperAlertTracker('rule', 'camera')
    t.observe(reading(0)); expect(t.observe(reading(100, { state }))).toBeNull()
    expect(t.peakDeviation).toBeNull()
    expect(t.observe(reading(200))).toMatchObject({ id: 2, kind: 'first' })
  })
  it('breaks continuity for gaps and rejects stale timestamps or invalid distances', () => {
    const t = new DeveloperAlertTracker('predictor', 'camera')
    t.observe(reading(0)); expect(t.observe(reading(200))).toBeNull()
    expect(t.observe(reading(200))).toBeNull(); expect(t.observe(reading(-1))).toBeNull()
    expect(t.observe(reading(NaN))).toBeNull()
    expect(t.observe(reading(300, { deviation: NaN }))).toBeNull()
    expect(t.observe(reading(400, { deviation: null }))).toBeNull()
    expect(t.observe(reading(500))).toMatchObject({ id: 2, kind: 'first' })
  })
  it('locks the selected rule or hybrid basis independently', () => {
    const hybrid = new DeveloperAlertTracker('predictor', 'synthetic'), rule = new DeveloperAlertTracker('rule', 'synthetic')
    const r = reading(0, { state: 'unexpected_motion_candidate' })
    expect(hybrid.observe(r)).toBeNull()
    expect(rule.observe(r)).toMatchObject({ basis: 'rule' })
  })
  it('bounds diagnostic snapshots while retaining total count and cleans error values', () => {
    const t = new DeveloperAlertTracker('predictor', 'synthetic')
    for (let i = 0; i < 110; i++) {
      t.observe(reading(i * 200, { state: 'near_reference' }))
      t.observe(reading(i * 200 + 100, { error: NaN, errorLimit: Infinity }))
    }
    expect(t.count).toBe(110); expect(t.alerts).toHaveLength(ALERT_SETTINGS.history_limit)
    expect(t.alerts[0].id).toBe(11); expect(t.alerts.at(-1)).toMatchObject({ id: 110, error: null, errorLimit: null })
  })
  it('preserves one incident through a transient unmatched forecast in real core jitter', () => {
    const core = new LiveForecastExperiment(null, 'hold_last')
    const tracker = new DeveloperAlertTracker('predictor', 'synthetic')
    core.register()
    let next: ForecastReading | null = null
    for (let time = 0; time <= 8000; time += 100) { next = core.step(time, Array(39).fill(0)); if (next) tracker.observe(next) }
    for (let time = 8100; time <= 11200; time += 100) { next = core.step(time, Array(39).fill(1)); if (next) tracker.observe(next) }
    expect(tracker.count).toBe(1)
    for (const time of [11370, 11540, 11635, 11730]) { next = core.step(time, Array(39).fill(1)); if (next) tracker.observe(next) }
    expect(next).toMatchObject({ state: 'warming', ruleState: 'persistent_deviation_candidate' })
    expect(tracker.peakDeviation).not.toBeNull()
    next = core.step(11830, Array(39).fill(1))
    expect(next?.state).toBe('persistent_deviation_candidate')
    expect(tracker.observe(next!)).toBeNull(); expect(tracker.count).toBe(1)
  })

  it('delivers observed rule incidents during predictor warmup but preserves the legacy gate', () => {
    const rule = new DeveloperAlertTracker('rule', 'synthetic')
    const hybrid = new DeveloperAlertTracker('predictor', 'synthetic')
    const legacy = new DeveloperAlertTracker('rule', 'synthetic')
    const pendingPrediction = reading(0, { state: 'warming', error: null })
    expect(legacy.observe(pendingPrediction)).toBeNull()
    expect(hybrid.observe({ ...pendingPrediction, evaluationMode: 'observed-v2' })).toBeNull()
    expect(rule.observe({ ...pendingPrediction, evaluationMode: 'observed-v2' })).toMatchObject({ basis: 'rule', error: null })
  })

  it.each([5, 10, 11, 15, 30])('delivers one observed rule alarm at %s FPS and resets on actual quality loss', fps => {
    const core = new LiveForecastExperiment(null, 'hold_last', { mode: 'observed' })
    const tracker = new DeveloperAlertTracker('rule', 'synthetic')
    core.register()
    for (let t = 0; t <= 8000; t += 100) core.step(t, Array(39).fill(0))
    for (let i = 1; i <= fps * 5; i++) tracker.observe(core.step(8000 + i * 1000 / fps, Array(39).fill(.2))!)
    expect(tracker.count).toBe(1)
    expect(tracker.observe(core.step(13100, null)!)).toBeNull()
    expect(tracker.peakDeviation).toBeNull()
    expect(tracker.observe(core.step(13200, Array(39).fill(.2))!)).toBeNull()
  })

})
