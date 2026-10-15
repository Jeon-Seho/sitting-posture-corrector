import { describe, it, expect } from 'vitest'
import { ForecastPolicy, LiveForecastExperiment, liveForecastPoints, predictLstm, readForecastWeights,
  type ForecastWeights } from '../../../../model/prototype/forecast'
import { fitNormalPostureProfile } from '../../../../model/prototype/normalPosture'

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
  it('exposes the actual 39-coordinate LSTM output and its own grid input without sharing mutable arrays', () => {
    const model = syntheticForecastWeights()
    model.weights['output.bias'][0] = .17
    model.weights['output.bias'][14] = -.08
    model.weights['output.bias'][36] = .04
    const experiment = new LiveForecastExperiment(model, 'lstm', { mode: 'observed' })
    const input = Array.from({ length: 30 }, (_, step) => Array(39).fill(step / 100))
    input.forEach((values, index) => experiment.step(index * 100, values))
    const display = experiment.predictionDisplay!
    expect(display).toMatchObject({ predictor: 'lstm', modelId: model.model_id, inputAtMs: 2900, targetAtMs: 3200 })
    expect(display.values).toEqual(predictLstm(model, input))
    expect(display.inputValues).toEqual(input[29])
    expect(display.values[0]).toBeCloseTo(.49)
    expect(display.values[14]).toBeCloseTo(.24)
    display.values[0] = 99; display.inputValues[0] = 99
    expect(experiment.predictionDisplay!.values[0]).toBeCloseTo(.49)
    expect(experiment.predictionDisplay!.inputValues[0]).toBeCloseTo(.29)
    experiment.step(2950, Array(39).fill(.295))
    expect(experiment.predictionDisplay!.inputAtMs).toBe(2900)
    expect(experiment.predictionDisplay!.inputValues[0]).toBe(.29)
  })
  it('clears displayed forecasts after invalid observations, gaps and fresh registration', () => {
    const experiment = new LiveForecastExperiment(null, 'constant_velocity', { mode: 'observed' })
    for (let time = 0; time <= 2900; time += 100) experiment.step(time, Array(39).fill(time / 10000))
    expect(experiment.predictionDisplay).not.toBeNull()
    experiment.unavailable(3000)
    expect(experiment.predictionDisplay).toBeNull()
    for (let time = 3100; time <= 6000; time += 100) experiment.step(time, Array(39).fill(time / 10000))
    expect(experiment.predictionDisplay).not.toBeNull()
    experiment.step(6501, Array(39).fill(.6501))
    expect(experiment.predictionDisplay).toBeNull()
    for (let time = 6601; time <= 9501; time += 100) experiment.step(time, Array(39).fill(time / 10000))
    expect(experiment.predictionDisplay).not.toBeNull()
    experiment.register()
    expect(experiment.predictionDisplay).toBeNull()
  })
  it('returns a reference snapshot only after registration and protects the engine baseline', () => {
    const experiment = new LiveForecastExperiment(null, 'hold_last', { mode: 'observed' })
    experiment.register()
    expect(experiment.referenceValues).toBeNull()
    for (let time = 0; time <= 8000; time += 100) experiment.step(time, Array(39).fill(.1))
    expect(experiment.referenceValues).toEqual(Array(39).fill(.1))
    experiment.referenceValues![0] = 100
    expect(experiment.referenceValues![0]).toBe(.1)
    experiment.register()
    expect(experiment.referenceValues).toBeNull()
  })
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
  it('requires real weights when selecting LSTM and retains LSTM as the default', () => {
    expect(() => new LiveForecastExperiment(null)).toThrow('학습 모델이 필요합니다')
    expect(() => new LiveForecastExperiment(null, 'lstm')).toThrow('학습 모델이 필요합니다')
    const model = syntheticForecastWeights()
    expect(new LiveForecastExperiment(model).step(0, Array(39).fill(0))!.modelId).toBe(model.model_id)
  })
  it.each(['hold_last', 'constant_velocity'] as const)('registers and forecasts with %s without a model', predictor => {
    const e = new LiveForecastExperiment(null, predictor); e.register()
    let r = e.step(0, Array(39).fill(0))!
    for (let t = 100; t <= 8000; t += 100) r = e.step(t, Array(39).fill(0))!
    expect(e.model).toBeNull(); expect(e.ready).toBe(true)
    expect(r).toMatchObject({ state: 'near_reference', modelId: predictor, domainValidated: false, error: 0, errorLimit: .02 })

    // Explicit synthetic linear motion: each dimension moves .01 per 100 ms.
    for (let t = 8100; t <= 8400; t += 100) r = e.step(t, Array(39).fill((t - 8000) / 10000))!
    expect(r.error).toBeCloseTo(predictor === 'hold_last' ? Math.sqrt(3) * .03 : 0, 10)
  })
  it('preserves unavailable and interrupted states without model weights', () => {
    const e = new LiveForecastExperiment(null, 'hold_last'); e.register()
    for (let t = 0; t <= 8000; t += 100) e.step(t, Array(39).fill(0))
    let r = e.step(8100, Array(39).fill(1))!
    for (let t = 8200; t <= 11200; t += 100) r = e.step(t, Array(39).fill(1))!
    expect(r.state).toBe('persistent_deviation_candidate')
    expect(e.step(11300, null)).toMatchObject({ state: 'unmeasurable', ruleState: 'unmeasurable', deviation: null, error: null, durationMs: 0 })
    const resumed = e.step(11400, Array(39).fill(1))!
    expect(resumed).toMatchObject({ state: 'warming', ruleState: 'deviation_pending', error: null, durationMs: 0, returnedExcursions: 0 })
    for (let t = 11500; t <= 15700; t += 100) r = e.step(t, Array(39).fill(1))!
    expect(r.state).toBe('persistent_deviation_candidate')
    expect(e.step(16200, Array(39).fill(1))).toMatchObject({ state: 'warming', ruleState: 'deviation_pending', error: null, durationMs: 0, returnedExcursions: 0 })
    expect(e.unavailable(16800)).toMatchObject({ state: 'unmeasurable', ruleState: 'unmeasurable', deviation: null, error: null, durationMs: 0 })
  })
  it('starts new reference registration with new excursion counts but preserves them across gaps', () => {
    const e = new LiveForecastExperiment(null, 'hold_last'); e.register()
    for (let t = 0; t <= 8000; t += 100) e.step(t, Array(39).fill(0))
    e.step(8100, Array(39).fill(1))
    expect(e.step(8200, Array(39).fill(0))!.returnedExcursions).toBe(1)
    expect(e.unavailable(8300)!.returnedExcursions).toBe(1)
    e.register()
    expect(e.ready).toBe(false)
    expect(e.step(8400, Array(39).fill(0))).toMatchObject({ state: 'registering', returnedExcursions: 0, errorLimit: null, progress: 0 })
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
  it('keeps valid baseline samples through a short frame delay but never extends tracking continuity', () => {
    const e = new LiveForecastExperiment(null, 'hold_last'); e.register()
    const values = Array(39).fill(0)
    for (let t = 0; t <= 3000; t += 100) e.step(t, values)
    const before = e.step(3300, values)!
    expect(before).toMatchObject({ state: 'registering' })
    expect(before.progress).toBeGreaterThan(.3)
    for (let t = 3400; t <= 8500; t += 100) e.step(t, values)
    expect(e.ready).toBe(true)
    expect(e.step(8800, values)).toMatchObject({ state: 'warming', ruleState: 'near_reference' })
  })

  it('finishes registration on a slower camera without matched forecast errors', () => {
    const e = new LiveForecastExperiment(null, 'hold_last'); e.register()
    const values = Array(39).fill(0)
    let reading = e.step(0, values)!
    for (let t = 200; t <= 8000; t += 200) reading = e.step(t, values)!
    expect(reading).toMatchObject({ state: 'registering', error: null })
    expect(reading.progress).toBeCloseTo(41 / 65)
    for (let t = 8200; t <= 12800; t += 200) reading = e.step(t, values)!
    expect(e.ready).toBe(true)
    expect(reading).toMatchObject({ ruleState: 'near_reference', errorLimit: .02 })
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

describe('raw observation mode with explicit synthetic time series', () => {
  const values = (x = 0) => Array.from({ length: 39 }, (_, i) => i % 3 === 0 ? x : 0)
  const registered = (predictor: 'hold_last' | 'constant_velocity' = 'hold_last') => {
    const core = new LiveForecastExperiment(null, predictor, { mode: 'observed' })
    core.register()
    for (let t = 0; t <= 8000; t += 100) core.step(t, values())
    return core
  }

  it.each([300, 450, 500])('builds real forecasts through repeated %s ms camera delays without extending rule time', delay => {
    const core = registered('constant_velocity')
    core.unavailable(8100)
    const resetCount = core.predictionStatus.resetCount
    let time = 8100
    let readyPredictions = 0
    for (let frame = 1; frame <= 100; frame++) {
      const gap = frame % 18 === 0 ? delay : 100
      time += gap
      const reading = core.step(time, values((time - 8100) / 100000))!
      if (gap > 250) {
        expect(reading).toMatchObject({ state: 'unmeasurable', ruleState: 'unmeasurable',
          error: null, predictionTimeMs: null, durationMs: 0, predictionInputMaxGapMs: 500 })
      } else if (reading.error !== null) {
        expect(reading.error).toBeLessThan(1e-10)
        readyPredictions++
      }
    }
    expect(readyPredictions).toBeGreaterThan(50)
    expect(core.predictionDisplay).not.toBeNull()
    expect(core.predictionStatus).toMatchObject({ collectedSteps: 30, requiredSteps: 30,
      resetCount, lastResetReason: 'quality', bridgedGapCount: 5 })
  })

  it('treats no-frame watchdog calls as display/rule interruptions without inventing source observations', () => {
    const core = registered()
    core.step(8100, values(.2))
    core.step(8200, values(.2))
    const status = core.predictionStatus
    expect(core.delayed(8570)).toMatchObject({ state: 'unmeasurable', ruleState: 'unmeasurable', durationMs: 0, error: null })
    expect(core.predictionDisplay).toBeNull()
    expect(core.predictionStatus).toMatchObject({ collectedSteps: status.collectedSteps,
      resetCount: status.resetCount, lastGapMs: 370 })
    // A late-delivered frame is newer than the actual source, though older than the watchdog reading.
    expect(core.step(8500, values(.2))).toMatchObject({ state: 'unmeasurable', ruleState: 'unmeasurable', error: null })
    expect(core.predictionDisplay).not.toBeNull()
    expect(core.step(8600, values(.2))).toMatchObject({ ruleState: 'deviation_pending', durationMs: 0 })
    expect(core.step(8700, values(.2))).toMatchObject({ ruleState: 'deviation_pending', durationMs: 100 })
    expect(core.delayed(8750).error).toBeNull()
    expect(core.predictionDisplay).toBeNull()
  })

  it('hard clears a watchdog stall once source age exceeds 500 ms, without advancing source time', () => {
    const core = registered()
    const resets = core.predictionStatus.resetCount
    core.delayed(8500)
    expect(core.predictionStatus.collectedSteps).toBe(30)
    core.delayed(8501)
    expect(core.predictionStatus).toMatchObject({ collectedSteps: 0, resetCount: resets + 1,
      lastResetReason: 'gap', lastGapMs: 501 })
    core.delayed(8750)
    expect(core.predictionStatus.resetCount).toBe(resets + 1)
    expect(core.step(8400, values())).toMatchObject({ state: 'unmeasurable' })
    expect(core.predictionStatus.collectedSteps).toBe(1)
    expect(core.predictionDisplay).toBeNull()
  })

  it('bridges at most 500 ms and never uses the delayed interpolated targets as observed forecast errors', () => {
    const core = registered('constant_velocity')
    expect(core.step(8500, values(.2))).toMatchObject({ state: 'unmeasurable', ruleState: 'unmeasurable',
      error: null, predictionTimeMs: null })
    expect(core.predictionStatus).toMatchObject({ collectedSteps: 30, lastGapMs: 500, bridgedGapCount: 1 })
    expect(core.predictionDisplay).toMatchObject({ inputAtMs: 8500, targetAtMs: 8800 })
    expect(core.step(9001, values(.2))).toMatchObject({ state: 'unmeasurable' })
    expect(core.predictionStatus).toMatchObject({ collectedSteps: 0, lastResetReason: 'gap', lastGapMs: 501 })
    for (let t = 9101; t <= 12101; t += 100) core.step(t, values())
    expect(core.predictionDisplay).not.toBeNull()
    core.unavailable(12201, 'reset')
    expect(core.predictionStatus).toMatchObject({ collectedSteps: 0, lastResetReason: 'reset' })
    core.step(12301, values())
    expect(() => core.step(12301, values())).toThrow('관측 시각')
    expect(core.predictionStatus).toMatchObject({ collectedSteps: 0, lastResetReason: 'time' })
    core.step(12401, values(NaN))
    expect(core.predictionStatus).toMatchObject({ collectedSteps: 0, lastResetReason: 'quality' })
  })

  it.each([5, 10, 11, 15, 30])('detects sustained raw-observed departure at %s FPS without aliasing or model weights', fps => {
    const core = new LiveForecastExperiment(null, 'hold_last', { mode: 'observed' })
    core.register()
    let frame = 0
    for (; frame <= fps * 15 && !core.ready; frame++) core.step(frame * 1000 / fps, values())
    expect(core.ready).toBe(true)
    const start = frame * 1000 / fps
    let firstPersistent: number | null = null
    let count = 0
    for (let i = 0; i <= fps * 5; i++) {
      const t = start + i * 1000 / fps
      const result = core.step(t, values(.2))!
      expect(result).toMatchObject({ evaluationMode: 'observed-v2', deviation: expect.closeTo(.2) })
      expect(result.ruleState).not.toBe('warming')
      if (result.ruleState === 'persistent_deviation_candidate') firstPersistent ??= t
      count++
    }
    expect(count).toBe(fps * 5 + 1)
    expect(firstPersistent).not.toBeNull()
    expect(firstPersistent! - start).toBeGreaterThanOrEqual(3000)
    expect(firstPersistent! - start).toBeLessThanOrEqual(3000 + 1000 / fps + 1e-6)
  })

  it.each([5, 10, 11, 15, 30])('uses exact 100ms forecast targets for a synthetic linear trajectory at %s FPS', fps => {
    const core = registered('constant_velocity')
    let result = core.step(8000 + 1000 / fps, values(.01))!
    for (let i = 2; i <= fps * 5; i++) {
      const t = 8000 + i * 1000 / fps
      result = core.step(t, values((t - 8000) / 100000))!
    }
    expect(result.error).not.toBeNull()
    expect(result.error!).toBeLessThan(1e-10)
    expect(result.predictionTimeMs).toBeGreaterThan(12800)
    expect(result.predictionTimeMs!).toBeLessThanOrEqual(result.timeMs + 1e-6)
  })

  it('keeps rule persistence available during predictor warmup after a real invalid observation', () => {
    const core = registered()
    expect(core.step(8100, null)).toMatchObject({ state: 'unmeasurable', deviation: null, durationMs: 0 })
    for (let t = 8200; t < 11200; t += 100) {
      expect(core.step(t, values(.2))!.error).toBeNull()
    }
    expect(core.step(11200, values(.2))).toMatchObject({ state: 'warming', ruleState: 'persistent_deviation_candidate',
      error: null, predictionTimeMs: null, durationMs: 3000 })
  })

  it('does not interpolate across invalid frames or long gaps and rejects invalid timestamps', () => {
    const core = registered()
    expect(core.step(8600, values(.2))).toMatchObject({ state: 'unmeasurable', ruleState: 'unmeasurable', durationMs: 0, error: null })
    expect(core.step(8700, values(.2))).toMatchObject({ state: 'warming', ruleState: 'deviation_pending', durationMs: 0 })
    expect(core.step(8800, values(NaN))).toMatchObject({ state: 'unmeasurable' })
    expect(core.step(8900, values(.2))).toMatchObject({ ruleState: 'deviation_pending', durationMs: 0, predictionTimeMs: null })
    for (const time of [8900, 8800, -1, NaN, Infinity]) expect(() => core.step(time, values())).toThrow('관측 시각')
    expect(() => core.unavailable(8900)).toThrow('관측 시각')
  })

  it('preserves real reference samples during a brief guide pause without forecasting through the missing frame', () => {
    const core = new LiveForecastExperiment(null, 'hold_last', { mode: 'observed' })
    core.register()
    let result = core.step(0, values())!
    for (let t = 100; t <= 4000; t += 100) result = core.step(t, values())!
    expect(result.error).toBe(0)
    const progress = result.progress
    core.pauseReference()
    result = core.step(4200, values())!
    expect(result.error).toBeNull()
    expect(result.progress).toBeGreaterThan(progress)
    for (let t = 4300; t <= 7200; t += 100) expect(core.step(t, values())!.error).toBeNull()
    expect(core.step(7400, values())!.error).toBe(0)
  })

  it('detects a slow predictable drift but does not alert on an excursion that returns quickly', () => {
    const core = registered('constant_velocity')
    for (let t = 8100; t <= 9100; t += 100) expect(core.step(t, values(.2))!.ruleState).toBe('deviation_pending')
    expect(core.step(9200, values())).toMatchObject({ ruleState: 'near_reference', returnedExcursions: 1 })
    let result = core.step(9300, values())!
    for (let t = 9400; t <= 39300; t += 100) result = core.step(t, values((t - 9300) / 150000))!
    expect(result.ruleState).toBe('persistent_deviation_candidate')
    expect(result.error!).toBeLessThan(.001)
    expect(result.deviation).toBeCloseTo(.2)
  })

  it('separates rule short-return counts from an unpredictable predictor excursion and measures recovery', () => {
    const core = registered('hold_last')
    for (let t = 8100; t <= 11300; t += 100) core.step(t, values(t % 200 === 0 ? .2 : .4))
    const returning = core.step(11400, values())!
    expect(returning).toMatchObject({ ruleState: 'recovery_pending', ruleReturnedExcursions: 0, returnedExcursions: 1, ruleRecoveryMs: 0 })
    expect(core.step(11500, values())).toMatchObject({ ruleRecoveryMs: 100 })
    expect(core.step(11600, null)).toMatchObject({ ruleState: 'unmeasurable', ruleDurationMs: 0, ruleRecoveryMs: 0, ruleReturnedExcursions: 0 })
  })

  it('uses the snapshotted learned center and preserves actual geometric distance', () => {
    const profile = fitNormalPostureProfile(Array.from({ length: 301 }, (_, i) => ({ timeMs: i * 100, values: values() })), {
      poseModelId: 'mediapipe-pose-full-f16-v1/tasks-vision-1.0.1',
      id: 'synthetic-profile', participantCode: 'synthetic-person', sessionCode: 'synthetic-session', purpose: 'personal_calibration',
      createdAt: '2026-10-14T00:00:00.000Z',
    })
    const core = new LiveForecastExperiment(null, 'hold_last', { mode: 'observed', normalProfile: profile, poseModelId: 'mediapipe-pose-full-f16-v1/tasks-vision-1.0.1' })
    profile.tolerance.fill(2) // Changes outside the run cannot change its locked policy.
    core.register()
    for (let t = 0; t <= 8000; t += 100) core.step(t, values())
    expect(core.step(8100, values())).toMatchObject({ normalScore: 0, normalProfileId: 'synthetic-profile', ruleState: 'near_reference' })
    // Move the face only: the fitted feature ratio exceeds 1 despite aggregate geometry below 12%.
    const changed = values().map((v, i) => i < 27 && i % 3 === 0 ? .15 : v)
    let result = core.step(8200, changed)!
    for (let t = 8300; t <= 11200; t += 100) result = core.step(t, changed)!
    expect(result).toMatchObject({ ruleState: 'persistent_deviation_candidate', normalProfileId: 'synthetic-profile' })
    expect(result.normalScore).toBeCloseTo(1.25)
    expect(result.deviation).toBeCloseTo(.05)
  })

  it('rejects applying a training-only profile as personal calibration', () => {
    const profile = fitNormalPostureProfile(Array.from({ length: 301 }, (_, i) => ({ timeMs: i * 100, values: values() })), {
      id: 'synthetic-training', participantCode: 'synthetic-person', sessionCode: 'synthetic-session', purpose: 'training_normal',
      createdAt: '2026-10-14T00:00:00.000Z',
    })
    expect(() => new LiveForecastExperiment(null, 'hold_last', { mode: 'observed', normalProfile: profile })).toThrow('학습 자료용 프로필')
  })

  it('rejects a full shifted registration and accepts a later normal retry without recentering', () => {
    const poseModelId = 'mediapipe-pose-full-f16-v1/tasks-vision-1.0.1'
    const profile = fitNormalPostureProfile(Array.from({ length: 301 }, (_, i) => ({ timeMs: i * 100, values: values() })), {
      id: 'synthetic-fixed-center', participantCode: 'synthetic-person', sessionCode: 'synthetic-session',
      purpose: 'personal_calibration', poseModelId, createdAt: '2026-10-14T00:00:00.000Z',
    })
    const core = new LiveForecastExperiment(null, 'hold_last', { mode: 'observed', normalProfile: profile, poseModelId })
    core.register()
    for (let t = 0; t <= 8000; t += 100) core.step(t, values(.4))
    expect(core.ready).toBe(false)
    expect(core.referenceValues).toBeNull()
    expect(core.referenceValidation).toMatchObject({ status: 'rejected', reason: 'outside_normal_range' })
    expect(core.step(8100, values(.4))).toMatchObject({ state: 'needs_reference', deviation: null })
    core.register()
    for (let t = 8200; t <= 16200; t += 100) core.step(t, values())
    expect(core.ready).toBe(true)
    expect(core.referenceValidation).toMatchObject({ status: 'accepted', score: 0 })
    expect(core.step(16300, values(.4))).toMatchObject({ ruleState: 'deviation_pending' })
    expect(core.step(16400, values(), 'mediapipe-pose-heavy-f16-v1/tasks-vision-1.0.1')).toMatchObject({ state: 'unmeasurable' })
    expect(core.referenceValidation).toMatchObject({ status: 'incompatible' })
  })

  it('treats the learned normal boundary as inclusive, while ordinary 12% rules keep their original boundary', () => {
    expect(new ForecastPolicy().step(0, .12, 0, .02, true, true)).toBe('near_reference')
    expect(new ForecastPolicy().step(0, .12, 0, .02, true)).toBe('deviation_pending')
  })
})
