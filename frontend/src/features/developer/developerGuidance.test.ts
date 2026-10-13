import { describe, expect, it } from 'vitest'
import { DeveloperGuide, GUIDANCE_SETTINGS, framingCue, geometryDelta, guideFrame, syntheticGuideFrame } from '../../../../model/prototype/developerGuidance'
import { LiveForecastExperiment, liveForecastPoints, pointDistance } from '../../../../model/prototype/forecast'
import { syntheticForecastValues } from './session'

const sample = (t = 0) => syntheticGuideFrame(t)!
describe('experimental framing guidance using explicitly synthetic image geometry', () => {
  it('separates missing, off-center, distant and close views without diagnosing posture', () => {
    expect(framingCue(null)).toBe('missing')
    const good = sample()
    expect(framingCue(good)).toBe('ready')
    expect(framingCue({ ...good, points: good.points.map(p => ({ ...p, x: p.x + .2 })) })).toBe('center')
    expect(framingCue({ ...good, points: good.points.map(p => ({ ...p, x: .5 + (p.x - .5) * .5 })) })).toBe('far')
    expect(framingCue({ ...good, points: good.points.map(p => ({ ...p, x: .5 + (p.x - .5) * 2 })) })).toBe('close')
    expect(guideFrame(good.points.map(p => ({ ...p, visibility: .1 })), 1280, 720, 0)).toBeNull()
    expect(guideFrame(good.points, 0, 720, 0)).toBeNull()
  })

  it('requires all three intro steps followed by continuous stable framing, not just elapsed wall time', () => {
    const guide = new DeveloperGuide(0)
    expect(guide.observe(0, sample()).introStep).toBe(0)
    expect(guide.observe(1200, sample()).introStep).toBe(1)
    expect(guide.observe(2400, sample()).introStep).toBe(2)
    expect(guide.observe(3600, sample()).step).toBe('framing')
    for (let t = 3700; t < 4500; t += 100) expect(guide.observe(t, sample()).ready).toBe(false)
    expect(guide.observe(4500, sample()).ready).toBe(true)
    const interrupted = new DeveloperGuide(0)
    interrupted.observe(3600, sample()); interrupted.observe(4400, sample())
    expect(interrupted.observe(5000, sample()).holdProgress).toBe(0)
    expect(GUIDANCE_SETTINGS.stable_ms).toBe(900)
  })

  it('pauses brief missing observations and restarts after sustained movement', () => {
    const guide = new DeveloperGuide(0)
    for (let t = 3600; t <= 4000; t += 100) guide.observe(t, sample())
    const progress = guide.current.holdProgress
    expect(guide.observe(4100, null)).toMatchObject({ ready: false, live: null, holdProgress: progress })
    expect(guide.observe(4200, sample()).holdProgress).toBe(progress)
    expect(guide.observe(4300, sample()).holdProgress).toBeGreaterThan(progress)
    const moved = { ...sample(), points: sample().points.map(p => ({ ...p, x: p.x + .1 })) }
    for (let t = 4400; t <= 4800; t += 100) expect(guide.observe(t, moved).ready).toBe(false)
    expect(guide.current.holdProgress).toBe(0)
    for (let t = 4900; t <= 5800; t += 100) guide.observe(t, moved)
    expect(guide.current.ready).toBe(true)
    guide.startReference()
    expect(guide.observe(5900, sample()).ready).toBe(false)
  })

  it('accepts natural whole-frame sway and isolated landmark jitter at modest frame rates', () => {
    const guide = new DeveloperGuide(0)
    for (let t = 3600; t <= 4500; t += 300) {
      const noisy = sample()
      noisy.points = noisy.points.map((p, i) => ({ ...p, x: p.x + .03 * Math.sin(t / 150) + (i === 3 ? .08 : 0) }))
      guide.observe(t, noisy)
    }
    expect(guide.current.ready).toBe(true)
    guide.startReference()
    const breathing = sample()
    breathing.points = breathing.points.map(p => ({ ...p, x: p.x + .025 }))
    expect(guide.observe(4600, breathing).ready).toBe(true)
  })

  it('never completes during loss or off-center framing and discards progress after sustained loss', () => {
    for (const unavailable of [null, { ...sample(), points: sample().points.map(p => ({ ...p, x: p.x + .2 })) }]) {
      const guide = new DeveloperGuide(0)
      for (let t = 3600; t <= 4200; t += 100) guide.observe(t, sample())
      for (let t = 4300; t <= 4800; t += 100) expect(guide.observe(t, unavailable).ready).toBe(false)
      expect(guide.current.holdProgress).toBe(0)
      expect(guide.observe(4900, sample()).holdProgress).toBe(0)
    }
  })

  it('resets on prolonged observation gaps and rejects source-size changes during reference capture', () => {
    const guide = new DeveloperGuide(0)
    for (let t = 3600; t <= 4100; t += 100) guide.observe(t, sample())
    expect(guide.observe(4700, sample()).holdProgress).toBe(0)
    for (let t = 4800; t <= 5600; t += 100) guide.observe(t, sample())
    guide.startReference()
    expect(guide.observe(5700, { ...sample(), width: 640, height: 480 }).ready).toBe(false)
    expect(guide.observe(5800, null).ready).toBe(false)
  })

  it('averages only captured reference frames and clears current geometry when unavailable', () => {
    const guide = new DeveloperGuide(0)
    for (let t = 3600; t <= 5100; t += 100) guide.observe(t, sample())
    guide.startReference()
    guide.captureReference(sample())
    const second = { ...sample(), points: sample().points.map(p => ({ ...p, x: p.x + .01 })) }
    guide.observe(5200, second); guide.captureReference(second)
    expect(guide.completeReference().reference!.points[0].x).toBeCloseTo(.505)
    const moved = { ...sample(), points: sample().points.map(p => ({ ...p, x: p.x + .2 })) }
    expect(guide.observe(5300, moved)).toMatchObject({ step: 'tracking', ready: true, cue: 'ready' })
    expect(guide.current.lateralPercent).toBeCloseTo(19.5)
    expect(guide.observe(5400, null)).toMatchObject({ live: null, lateralPercent: null, shoulderDegrees: null })
    expect(guide.current.reference).not.toBeNull()
  })

  it('expresses geometry in original image axes and applies no medical interpretation or hidden mirroring', () => {
    const reference = sample(), live = sample()
    live.points[0].x += .05
    live.points[0].y += .15
    live.points[12].y += .05
    expect(geometryDelta(live, reference).lateralPercent).toBeCloseTo(5)
    expect(geometryDelta(live, reference).verticalPercent).toBeCloseTo(15)
    expect(geometryDelta(live, reference).shoulderDegrees).toBeGreaterThan(0)
  })

  it('keeps screen translation separate from relative posture and detects a head change relative to the shoulders', () => {
    const reference = sample(), shifted = sample()
    shifted.points = shifted.points.map(p => ({ ...p, y: p.y + .15 }))
    const world = reference.points.map(p => ({ ...p, z: 0 }))
    const translated = world.map(p => ({ ...p, x: p.x * 1.2 + .7, y: p.y * 1.2 + .4, z: .1 }))
    const baseline = liveForecastPoints(reference.points.map(p => ({ ...p, z: 0 })), world)!
    const moved = liveForecastPoints(shifted.points.map(p => ({ ...p, z: 0 })), translated)!
    expect(geometryDelta(shifted, reference).verticalPercent).toBeCloseTo(15)
    expect(pointDistance(baseline, moved)).toBeCloseTo(0)
    const engine = new LiveForecastExperiment(null, 'hold_last'); engine.register()
    for (let t = 0; t <= 8000; t += 100) engine.step(t, baseline)
    expect(engine.step(8100, moved)).toMatchObject({ state: 'near_reference', ruleState: 'near_reference' })
    const headChanged = translated.map((p, i) => ({ ...p, y: p.y + (i < 11 ? .18 : 0) }))
    const relativeChange = liveForecastPoints(shifted.points.map(p => ({ ...p, z: 0 })), headChanged)!
    expect(engine.step(8200, relativeChange)).toMatchObject({ ruleState: 'deviation_pending' })
  })

  it('uses exactly the synthetic displayed image geometry for the synthetic forecast input', () => {
    for (const time of [0, 8000, 13500, 20000, 30000, 35000]) {
      const frame = syntheticGuideFrame(time)
      if (!frame) { expect(syntheticForecastValues(time)).toBeNull(); continue }
      const image = frame.points.map(point => ({ ...point, z: 0 }))
      const world = image.map(point => ({ ...point, y: point.y * frame.height / frame.width }))
      expect(syntheticForecastValues(time)).toEqual(liveForecastPoints(image, world))
    }
  })
})
