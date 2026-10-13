import { describe, it, expect } from 'vitest'
import { ForecastPolicy, LiveForecastExperiment, liveForecastPoints, predictLstm, readForecastWeights,
  type ForecastWeights } from '../../../../model/prototype/forecast'

export function syntheticForecastWeights(): ForecastWeights {
  return { schema_version: 'forecast-weights-v1', model_id: 'explicit-synthetic-zero-lstm', source_sha256: '0'.repeat(64),
    domain_validated: false, config: { steps: 30, dimensions: 39, hidden: 48, horizon: 3, point_definition: 'Panoptic-face9-body4-not-MediaPipe' },
    mean: Array(39).fill(0), scale: Array(39).fill(1), weights: {
      'lstm.weight_ih_l0': Array(192 * 39).fill(0), 'lstm.weight_hh_l0': Array(192 * 48).fill(0),
      'lstm.bias_ih_l0': Array(192).fill(0), 'lstm.bias_hh_l0': Array(192).fill(0),
      'output.weight': Array(39 * 48).fill(0), 'output.bias': Array(39).fill(0),
    } }
}
describe('live research forecast with explicit synthetic observations', () => {
  it('validates actual weight shape and rejects unsupported inputs', () => {
    const model = syntheticForecastWeights(); expect(readForecastWeights(model)).toBe(model)
    const broken = structuredClone(model); broken.scale[0] = 0
    expect(() => readForecastWeights(broken)).toThrow()
    expect(() => readForecastWeights({ ...model, domain_validated: true })).toThrow()
    expect(() => predictLstm(model, [])).toThrow()
  })
  it('executes the LSTM equation with a known zero correction and residual forecast', () => {
    const input = Array.from({ length: 30 }, (_, t) => Array(39).fill(t * .01))
    const result = predictLstm(syntheticForecastWeights(), input)
    expect(result[0]).toBeCloseTo(.32, 10)
    expect(result).toHaveLength(39)
  })
  it('requires all thirteen measured points and world geometry', () => {
    const image = Array.from({ length: 13 }, () => ({ x: .5, y: .5, z: 0, visibility: .95 }))
    const world = image.map(p => ({ ...p })); world[11].x = -.2; world[12].x = .2
    expect(liveForecastPoints(image, world)).toHaveLength(39)
    expect(liveForecastPoints(image, [])).toBeNull()
    image[2].visibility = .1; expect(liveForecastPoints(image, world)).toBeNull()
    image[2].visibility = .95; image[2].x = 1.1; expect(liveForecastPoints(image, world)).toBeNull()
  })
  it('registers only continuous good reference observations and compares due forecasts', () => {
    const e = new LiveForecastExperiment(syntheticForecastWeights()); e.register()
    let r = e.step(0, Array(39).fill(0))!
    for (let t = 100; t <= 8000; t += 100) r = e.step(t, Array(39).fill(0))!
    expect(e.ready).toBe(true); expect(r.state).toBe('near_reference'); expect(r.error).toBe(0)
    const changed = Array(39).fill(1)
    const sudden = e.step(8100, changed)!
    expect(sudden.error).toBeGreaterThan(.1) // actual vs forecast made at 7800, not new prediction
    expect(sudden.state).toBe('unexpected_motion_candidate')
    expect(sudden.ruleState).toBe('deviation_pending')
    expect(e.step(8200, null)!.state).toBe('unmeasurable')
    const resume = e.step(8300, changed)!
    expect(resume.error).toBeNull(); expect(resume.durationMs).toBe(0)
    expect(() => e.step(8300, changed)).toThrow()
  })
  it('breaks baseline registration on low quality and handles sampling gaps', () => {
    const e = new LiveForecastExperiment(syntheticForecastWeights()); e.register()
    for (let t = 0; t < 5000; t += 100) e.step(t, Array(39).fill(0))
    e.step(5000, null)
    for (let t = 5100; t <= 10000; t += 100) e.step(t, Array(39).fill(0))
    expect(e.ready).toBe(false)
    for (let t = 10100; t <= 13200; t += 100) e.step(t, Array(39).fill(0))
    expect(e.ready).toBe(true)
    const resumed = e.step(14000, Array(39).fill(1))!
    expect(resumed.error).toBeNull(); expect(resumed.durationMs).toBe(0)
  })
  it('confirms persistence despite high error and only confirms short excursions on return', () => {
    const p = new ForecastPolicy()
    expect(p.step(0, .3, .4, .02)).toBe('unexpected_motion_candidate')
    expect(p.step(1000, 0, 0, .02)).toBe('near_reference'); expect(p.returned).toBe(1)
    p.reset()
    for (let t = 2000; t < 7000; t += 100) expect(p.step(t, .3, .4, .02)).not.toBe('persistent_deviation_candidate')
    expect(p.step(7000, .3, .4, .02)).toBe('persistent_deviation_candidate')
    expect(p.step(7100, 0, 0, .02)).toBe('recovery_pending')
    expect(p.step(10100, 0, 0, .02)).toBe('near_reference')
    expect(p.returned).toBe(1)
  })
})
