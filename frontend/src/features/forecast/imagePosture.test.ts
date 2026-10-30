import { describe, expect, it } from 'vitest'
import { ImagePostureAnchor, IMAGE_POSTURE_SPEC, type ImagePostureInput } from '../../../../model/prototype/imagePosture'
import { ForecastPolicy, LiveForecastExperiment, liveForecastPoints } from '../../../../model/prototype/forecast'
import { DeveloperAlertTracker } from '../developer/alerts'

// Explicit synthetic 13-point front view. Not a recording or a detector accuracy claim.
const image = (scale = 1, dx = 0, dy = 0, headOnly = false): ImagePostureInput => ({ width: 640, height: 480,
  points: Array.from({ length: 13 }, (_, i) => ({
    x: .5 + ((i === 11 ? .3 : i === 12 ? .7 : .5) - .5) * scale + (headOnly && i >= 11 ? 0 : dx),
    y: .5 + ((i < 11 ? .3 : .6) - .5) * scale + (headOnly && i >= 11 ? 0 : dy), visibility: 1,
  })) })
const fit = () => { const a = new ImagePostureAnchor(); a.beginRegistration(); for (let i = 0; i <= 80; i++) a.collect(image()); expect(a.finishRegistration()).toBe(true); return a }
const normalized = () => { const points = image().points.map(p => ({ ...p, z: .1 })); return liveForecastPoints(points, points)! }
const registered = () => { const e = new LiveForecastExperiment(null, 'hold_last', { mode: 'observed', imagePostureGuard: true }); e.register(); for (let t = 0; t <= 8000; t += 100) e.step(t, normalized(), undefined, image()); expect(e.ready).toBe(true); return e }

describe('fixed registration image posture with explicit synthetic geometry', () => {
  it('keeps small sustained translation and scale noise inside the generous range', () => {
    const a = fit()
    for (let t = 0; t <= 10000; t += 100) expect(a.measure(t, image(t % 200 ? .96 : 1.04, t % 200 ? .015 : -.015, .015))!.score!).toBeLessThan(1)
    expect(a.snapshot.translationLimit).toBe(IMAGE_POSTURE_SPEC.translationFloor)
  })
  it('does not treat isolated head motion or opposing shoulder/head motion as common translation', () => {
    const a = fit()
    expect(a.measure(0, image(1, .25, .2, true))!.translation).toBe(0)
    expect(a.snapshot.score).toBe(0)
  })
  it('detects a smaller body with the same normalized relative pose', () => {
    const a = fit(), r = a.measure(0, image(.6))!
    expect(r.shrink).toBeCloseTo(.4); expect(r.score).toBeCloseTo(.4 / IMAGE_POSTURE_SPEC.shrinkFloor); expect(r.strongest).toBe('scale')
  })
  it('detects coherent lowering using the fixed reference shoulder span', () => {
    const a = fit(), r = a.measure(0, image(1, 0, .3))!
    expect(r.score!).toBeGreaterThan(1); expect(r.strongest).toBe('position')
  })
  it('widens its floor using observed registration variation and never recenters during measurement', () => {
    const a = new ImagePostureAnchor(); a.beginRegistration()
    for (let i = 0; i <= 80; i++) a.collect(image(i % 2 ? .7 : 1.3))
    a.finishRegistration()
    expect(a.snapshot.shrinkLimit!).toBeGreaterThan(.2)
    const fixed = fit()
    for (let t = 0; t <= 10000; t += 100) fixed.measure(t, image(.6))
    expect(fixed.snapshot.score).toBeCloseTo(.4 / IMAGE_POSTURE_SPEC.shrinkFloor)
  })
  it('clears quality loss without producing zero and latches changed aspect until new registration', () => {
    const a = fit(); a.measure(0, image(.6))
    const poor = image(); poor.points = poor.points.map(p => ({ ...p, visibility: .1 }))
    expect(a.measure(100, poor)).toBeNull(); expect(a.snapshot.score).toBeNull()
    expect(a.measure(200, image())!.score).toBe(0)
    expect(a.measure(300, { ...image(), height: 640 })).toBeNull()
    expect(a.snapshot.status).toBe('needs_reference')
    expect(a.measure(400, image())).toBeNull()
    a.beginRegistration(); for (let i = 0; i <= 80; i++) a.collect(image()); a.finishRegistration()
    expect(a.measure(500, image())!.score).toBe(0)
  })
  it('requires real registration samples and refuses invalid coordinates', () => {
    const a = new ImagePostureAnchor()
    expect(a.finishRegistration()).toBe(false)
    expect(a.collect(null)).toBe(false)
    expect(a.collect({ ...image(), width: NaN })).toBe(false)
  })
})

describe('whole body complement in the actual forecast/time policy', () => {
  it('requires uninterrupted entry and restarts interrupted recovery in the developer policy', () => {
    const policy = new ForecastPolicy()
    const thresholds = { entry: .12 * .7, recovery: .12 * .7 * 2 / 3, continuousEntry: true }
    const at = (t: number, ratio: number) => policy.step(t, ratio * .12, 0, .02, true, true, thresholds)
    expect(at(0, .8)).toBe('deviation_pending')
    expect(at(2000, .8)).toBe('deviation_pending')
    expect(at(2100, .6)).toBe('near_reference')
    expect(policy.durationStart).toBeNull()
    expect(at(2200, .8)).toBe('deviation_pending')
    expect(at(5100, .8)).toBe('deviation_pending')
    expect(at(5200, .8)).toBe('persistent_deviation_candidate')
    expect(at(5300, .4)).toBe('recovery_pending')
    expect(at(8000, .55)).toBe('persistent_deviation_candidate')
    expect(policy.recoveryStart).toBeNull()
    expect(at(8100, .4)).toBe('recovery_pending')
    expect(at(11000, .4)).toBe('recovery_pending')
    expect(at(11100, .4)).toBe('near_reference')
  })
  it('uses the 0.7 entry and proportional recovery without rescaling scores or alarming for 0.6', () => {
    const e = registered(), alerts = new DeveloperAlertTracker('rule', 'synthetic')
    const at = (t: number, score: number) => e.step(t, normalized(), undefined, image(1, .4 * .18 * score))!
    for (let t = 8100; t <= 13100; t += 100) alerts.observe(at(t, .6))
    expect(alerts.count).toBe(0)
    let r = at(13200, .8)
    for (let t = 13300; t <= 17700; t += 100) { r = at(t, .8); alerts.observe(r) }
    expect(r.postureScore).toBeCloseTo(.8)
    expect(r).toMatchObject({ postureEntryRatio: .7, postureRecoveryRatio: .7 * 2 / 3, ruleState: 'persistent_deviation_candidate' })
    expect(alerts.count).toBe(1)
    expect(alerts.alerts[0].postureEntryRatio).toBe(.7)
    for (let t = 17800; t <= 19000; t += 100) r = at(t, .55)
    expect(r.ruleState).toBe('persistent_deviation_candidate')
    for (let t = 19100; t <= 24000; t += 100) r = at(t, .4)
    expect(r.ruleState).toBe('near_reference')
  })
  it('detects a synthetic 21% shoulder-width translation while retaining tolerance for 5% movement', () => {
    const e = registered(), alerts = new DeveloperAlertTracker('rule', 'synthetic')
    for (let t = 8100; t <= 13100; t += 100) alerts.observe(e.step(t, normalized(), undefined, image(1, .02))!)
    expect(alerts.count).toBe(0)
    let r = e.step(13200, normalized(), undefined, image(1, .084))!
    for (let t = 13300; t <= 17700; t += 100) { r = e.step(t, normalized(), undefined, image(1, .084))!; alerts.observe(r) }
    expect(r.deviation).toBe(0)
    expect(r.imagePosture?.translation).toBeCloseTo(.21)
    expect(r.postureScore!).toBeGreaterThan(1)
    expect(r.ruleState).toBe('persistent_deviation_candidate')
    expect(alerts.count).toBe(1)
    expect(r.imagePosture?.policy).toBe('image-posture-anchor-v2')
  })
  it('alerts on sustained shrinking even when normalized 3D geometry never changes', () => {
    const e = registered(), alerts = new DeveloperAlertTracker('rule', 'synthetic')
    let r = e.step(8100, normalized(), undefined, image(.6))!
    alerts.observe(r)
    for (let t = 8200; t <= 12500; t += 100) { r = e.step(t, normalized(), undefined, image(.6))!; alerts.observe(r) }
    expect(r).toMatchObject({ ruleState: 'persistent_deviation_candidate', deviation: 0 })
    expect(r.postureScore!).toBeGreaterThan(1)
    expect(alerts.count).toBe(1)
    expect(alerts.alerts[0]).toMatchObject({ deviation: 0, imagePosture: { strongest: 'scale' } })
    expect(alerts.alerts[0].postureScore!).toBeGreaterThan(1)
  })
  it('does not alert on small continuous movements or brief recline followed by return', () => {
    const e = registered(), alerts = new DeveloperAlertTracker('rule', 'synthetic')
    for (let t = 8100; t <= 15000; t += 100) alerts.observe(e.step(t, normalized(), undefined, image(.96, .015, .015))!)
    for (let t = 15100; t <= 16000; t += 100) alerts.observe(e.step(t, normalized(), undefined, image(.6))!)
    let r = e.step(16100, normalized(), undefined, image())!
    for (let t = 16200; t <= 18500; t += 100) { r = e.step(t, normalized(), undefined, image())!; alerts.observe(r) }
    expect(alerts.count).toBe(0); expect(r.ruleState).toBe('near_reference'); expect(r.ruleReturnedExcursions).toBe(1)
  })
  it('resets persistence on missing or invalid image observations without discarding the reference', () => {
    const e = registered()
    for (let t = 8100; t <= 10800; t += 100) e.step(t, normalized(), undefined, image(.6))
    const missing = e.step(10900, normalized(), undefined, null)!
    expect(missing).toMatchObject({ state: 'unmeasurable', postureScore: null, ruleDurationMs: 0, imagePosture: { score: null } })
    expect(e.ready).toBe(true)
    const resumed = e.step(11000, normalized(), undefined, image(.6))!
    expect(resumed).toMatchObject({ ruleState: 'deviation_pending', ruleDurationMs: 0 })
  })
  it('uses the existing recovery time and replaces the image anchor only on explicit registration', () => {
    const e = registered()
    for (let t = 8100; t <= 13000; t += 100) e.step(t, normalized(), undefined, image(.6))
    let r = e.step(13100, normalized(), undefined, image())!
    for (let t = 13200; t <= 13700; t += 100) r = e.step(t, normalized(), undefined, image())!
    expect(r.ruleState).toBe('recovery_pending')
    for (let t = 13800; t <= 17500; t += 100) r = e.step(t, normalized(), undefined, image())!
    expect(r.ruleState).toBe('near_reference')
    e.register()
    for (let t = 17600; t <= 25600; t += 100) e.step(t, normalized(), undefined, image(.6))
    expect(e.step(25700, normalized(), undefined, image(.6))!.postureScore).toBeCloseTo(0)
  })
  it('keeps legacy paths and 39D predictor inputs unchanged', () => {
    const legacy = new LiveForecastExperiment(null, 'hold_last', { mode: 'observed' }); legacy.register()
    for (let t = 0; t <= 8000; t += 100) legacy.step(t, normalized())
    expect(legacy.step(8100, normalized())).not.toHaveProperty('imagePosture')
    expect(() => new LiveForecastExperiment(null, 'hold_last', { imagePostureGuard: true })).toThrow('/dev')
  })
})
