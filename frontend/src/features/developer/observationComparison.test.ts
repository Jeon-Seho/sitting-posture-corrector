import { describe, expect, it } from 'vitest'
import { comparisonGeometry, comparisonValues, ObservationComparison } from '../../../../model/prototype/observationComparison'
import { comparisonDemo } from './comparisonDemo'

const reference = () => comparisonGeometry(comparisonDemo(0, 'neutral'))
const registered = () => {
  const engine = new ObservationComparison(); engine.beginReference()
  for (let t = 0; t <= 2000; t += 100) engine.accept(comparisonDemo(t, 'neutral'))
  return engine
}
describe('observation comparison: explicitly synthetic geometry only', () => {
  it('uses fixed reference shoulder width: common image enlargement remains visible while common world translation cancels', () => {
    const v = comparisonValues(comparisonGeometry(comparisonDemo(1, 'body')), reference())!
    expect(v.shoulderScale).toBeCloseTo(20)
    expect(v.headGap).toBeGreaterThan(0)
    expect(v.relativeZ).toBeCloseTo(0)
  })
  it('keeps independent 2D/depth transformations separate rather than assigning a posture class', () => {
    const v = comparisonValues(comparisonGeometry(comparisonDemo(1, 'head')), reference())!
    expect(v.relativeZ).toBeCloseTo(-20)
    expect(v.shoulderScale).toBeCloseTo(0)
    expect(v).not.toHaveProperty('state')
    const bow = comparisonValues(comparisonGeometry(comparisonDemo(1, 'bow')), reference())!
    expect(bow.faceHeight).toBeLessThan(0)
    const lift = comparisonValues(comparisonGeometry(comparisonDemo(1, 'shoulders')), reference())!
    expect(lift.shoulderLift).toBeGreaterThan(0)
    expect(lift.headGap).toBeLessThan(0)
  })
  it('corrects normalized image y by aspect ratio and retains relative world units', () => {
    const frame = comparisonDemo(0, 'neutral'), g = comparisonGeometry(frame)
    expect(g.image!.gap).toBeCloseTo((.7 - .35) * 480 / 640)
    const shifted = comparisonDemo(1, 'head')
    for (const p of shifted.worldLandmarks) p.z += 20
    expect(comparisonGeometry(shifted).world!.relativeZ).toBeCloseTo(-.08)
  })
  it('does not replace missing or nonfinite depth with zero, or invalidate available 2D', () => {
    const frame = comparisonDemo(0, 'neutral'); frame.worldLandmarks = []
    const g = comparisonGeometry(frame)
    expect(g.image).not.toBeNull(); expect(g.world).toBeNull()
    expect(comparisonValues(g, reference())!.relativeZ).toBeNull()
    frame.worldLandmarks = comparisonDemo(0, 'neutral').worldLandmarks
    frame.worldLandmarks[0].z = NaN
    expect(comparisonGeometry(frame).world).toBeNull()
  })
  it('rejects low visibility, missing points, degenerate spans and offscreen image points', () => {
    for (const change of ['visibility', 'missing', 'span', 'offscreen'] as const) {
      const f = comparisonDemo(0, 'neutral')
      if (change === 'visibility') f.landmarks[11].visibility = .1
      if (change === 'missing') f.landmarks = []
      if (change === 'span') f.landmarks[12] = { ...f.landmarks[11] }
      if (change === 'offscreen') f.landmarks[0].x = 1.1
      expect(comparisonGeometry(f).image).toBeNull()
    }
  })
  it('requires a continuous registration and restarts on tracking loss', () => {
    const e = new ObservationComparison(); e.beginReference()
    for (let t = 0; t <= 1000; t += 100) e.accept(comparisonDemo(t, 'neutral'))
    e.accept({ ...comparisonDemo(1100, 'neutral'), landmarks: [] })
    for (let t = 1200; t <= 3100; t += 100) e.accept(comparisonDemo(t, 'neutral'))
    expect(e.reference).toBeNull()
    e.accept(comparisonDemo(3200, 'neutral')); expect(e.reference).not.toBeNull()
    expect(e.registering).toBe(false)
  })
  it('does not manufacture a depth baseline if registration had missing depth', () => {
    const e = new ObservationComparison(); e.beginReference()
    for (let t = 0; t <= 2000; t += 100) e.accept({ ...comparisonDemo(t, 'neutral'), worldLandmarks: [] })
    expect(e.reference!.world).toBeNull()
    e.accept(comparisonDemo(2100, 'head'))
    expect(e.samples.at(-1)!.values!.relativeZ).toBeNull()
  })
  it('uses only continuous recent samples after the manual action boundary for a snapshot', () => {
    const e = registered()
    for (let t = 2100; t <= 4000; t += 100) e.accept(comparisonDemo(t, 'head'))
    expect(e.capture(3000)!.relativeZ).toBeCloseTo(-20)
    expect(e.capture(3950)).toBeNull()
    e.accept({ ...comparisonDemo(4100, 'head'), landmarks: [] })
    expect(e.capture(3000)).toBeNull()
  })
  it('breaks on gaps/reversed timestamps and invalidates a changed extraction context', () => {
    const e = registered(); e.accept(comparisonDemo(3000, 'head'))
    expect(e.samples.some(s => s.values === null)).toBe(true)
    e.accept(comparisonDemo(2900, 'head')); expect(e.current).toBeNull()
    e.accept({ ...comparisonDemo(3100, 'head'), width: 1280 })
    expect(e.reference).toBeNull(); expect(e.capture(0)).toBeNull()
  })
  it('bounds in-memory charts and replaces the reference explicitly', () => {
    const e = registered()
    for (let t = 2100; t <= 30000; t += 100) e.accept(comparisonDemo(t, 'head'))
    expect(e.samples.length).toBeLessThanOrEqual(120)
    e.beginReference(); expect(e.samples).toEqual([]); expect(e.reference).toBeNull()
  })
})
