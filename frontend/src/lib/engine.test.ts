import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES } from '../data/posture'
import {
  closeOpenEvent,
  newMachine,
  sampleAt,
  snapshot,
  step,
  type Machine,
  type Sample,
} from './engine'
import { features, classify, average, payload, type Landmark } from '../../../model/prototype/pose'
import { beginCalibration, observeCalibration } from '../../../model/prototype/calibration'
import { placement, referenceScore } from '../../../model/prototype/pose'

const reading = (prob: number, unknown = false): Sample => ({
  ...sampleAt(0),
  state: unknown ? 'unknown' : prob >= 0.7 ? 'collapse' : 'good',
  prob,
  collapse: 'forwardHead',
  confidence: unknown ? 0 : 0.95,
})
function run(
  m: Machine,
  seconds: number,
  s: Sample,
  phase: 'running' | 'paused' = 'running',
  alerts = true,
) {
  for (let i = 0; i < Math.round(seconds * 10); i++) step(m, 0.1, phase, DEFAULT_RULES, s, alerts)
}
describe('shared demo and camera event policy', () => {
  it('requires 3 seconds and 60 seconds between actual alerts', () => {
    const m = newMachine()
    run(m, 2.9, reading(0.9))
    expect(m.events).toHaveLength(0)
    run(m, 0.1, reading(0.9))
    expect(m.events).toHaveLength(1)
    expect(m.alertTick).toBe(1)
    run(m, 59.9, reading(0.9))
    expect(m.alertTick).toBe(1)
    run(m, 0.2, reading(0.9))
    expect(m.alertTick).toBe(2)
  })
  it('labels an episode with the dominant direction of its hold, not the confirming frame', () => {
    const m = newMachine()
    run(m, 2.5, { ...reading(0.9), collapse: 'forwardHead' })
    run(m, 0.5, { ...reading(0.9), collapse: 'tilt' })
    expect(m.events[0].type).toBe('forwardHead')
    expect(m.holdKinds).toBeDefined()
    run(m, 2, reading(0.1))
    expect(m.holdKinds).toBeUndefined()
    run(m, 1, { ...reading(0.9), collapse: 'forwardHead' })
    run(m, 2, { ...reading(0.9), collapse: 'tilt' })
    expect(m.events[0].type).toBe('tilt')
  })
  it('preserves the existing 2-second recovery hysteresis', () => {
    const m = newMachine()
    run(m, 4, reading(0.9))
    run(m, 1.9, reading(0.1))
    expect(m.active).not.toBeNull()
    run(m, 0.1, reading(0.1))
    expect(m.active).toBeNull()
    expect(m.events[0].recovered).toBe(true)
    expect(m.events[0].recoverySec).toBeCloseTo(3)
  })
  it('closes an event on tracking loss, excludes missing time, and breaks interval groups', () => {
    const m = newMachine()
    run(m, 4, reading(0.9))
    const valid = m.total
    run(m, 10, reading(0, true))
    expect(m.events[0].endReason).toBe('unknown')
    expect(m.events[0].durationSec).toBeCloseTo(4)
    expect(m.events[0].recoverySec).toBeNull()
    expect(snapshot(m, reading(0, true), DEFAULT_RULES).validSeconds).toBeCloseTo(valid)
    run(m, 2, reading(0.9))
    expect(m.events).toHaveLength(1)
    run(m, 1, reading(0.9))
    expect(m.events).toHaveLength(2)
    expect(m.events[0].blockId).not.toBe(m.events[1].blockId)
  })
  it('interrupts on pause, excludes breaks, and closes on session end', () => {
    const m = newMachine()
    run(m, 4, reading(0.9))
    run(m, 20, reading(0.9), 'paused')
    expect(m.events[0].endReason).toBe('paused')
    expect(m.events[0].durationSec).toBeCloseTo(4)
    expect(m.hold).toBe(0)
    expect(snapshot(m, reading(0.9), DEFAULT_RULES).validSeconds).toBeCloseTo(4)
    run(m, 3, reading(0.9))
    closeOpenEvent(m)
    expect(m.events[0].endedBySession).toBe(true)
    const total = m.total
    step(m, 5, 'ended', DEFAULT_RULES, reading(0.9))
    expect(m.total).toBe(total)
  })
  it('records muted events without counting imaginary notifications', () => {
    const m = newMachine()
    run(m, 4, reading(0.9), 'running', false)
    expect(m.events[0].alerts).toBe(0)
    expect(m.events[0].firstAlertAt).toBeNull()
    expect(m.alertTick).toBe(0)
    run(m, 1, reading(0.9))
    expect(m.events[0].alerts).toBe(1)
    run(m, 2, reading(0.1))
    expect(m.events[0].recoverySec).toBeCloseTo(2.9)
  })
  it('resets an interrupted candidate and uses the configured threshold for statistics', () => {
    const m = newMachine()
    run(m, 2, reading(0.9))
    run(m, 1, reading(0, true))
    run(m, 2, reading(0.9))
    expect(m.events).toHaveLength(0)
    const before = m.good
    const s = step(m, 1, 'running', { ...DEFAULT_RULES, threshold: 0.95 }, reading(0.9))
    expect(s.state).toBe('good')
    expect(m.good).toBeCloseTo(before + 1)
  })
  it('rejects invalid durations and advances the original scenario', () => {
    const m = newMachine()
    step(m, -1, 'running', DEFAULT_RULES)
    step(m, NaN, 'running', DEFAULT_RULES)
    expect(m.total).toBe(0)
    step(m, 1, 'running', DEFAULT_RULES)
    expect(m.loop).toBe(1)
  })
  it('treats non-finite or out-of-range measurements as unknown and excludes their time', () => {
    for (const s of [
      { ...reading(0.9), prob: NaN },
      { ...reading(0.9), prob: Infinity },
      { ...reading(0.9), confidence: NaN },
      { ...reading(0.9), prob: -1 },
    ]) {
      const m = newMachine()
      const actual = step(m, 5, 'running', DEFAULT_RULES, s)
      expect(actual.state).toBe('unknown')
      expect(m.good).toBe(0)
      expect(m.collapse).toBe(0)
      expect(m.unknown).toBe(5)
      expect(m.events).toHaveLength(0)
    }
  })
})
describe('webcam reference adapter', () => {
  const points = (): Landmark[] =>
    Array.from({ length: 33 }, (_, i) => ({
      x: i === 11 ? 0.3 : i === 12 ? 0.7 : 0.5,
      y: i === 0 ? 0.25 : 0.5,
      z: 0,
      visibility: 0.95,
    }))
  it('requires a visible face and both shoulders', () => {
    expect(features([], 640, 480)).toBeNull()
    const p = points()
    p[11].visibility = 0.2
    expect(features(p, 640, 480)).toBeNull()
  })
  it('normalizes translation and reports dimensionless reference changes', () => {
    const p = points(),
      f = features(p, 640, 480)!
    expect(referenceScore(f, average([f, f])).score).toBe(0)
    expect(classify(null, f).status).toBe('unmeasurable')
    const shifted = p.map((v) => ({ ...v, x: v.x + 0.03, y: v.y + 0.03 }))
    expect(referenceScore(features(shifted, 640, 480)!, f).score).toBeCloseTo(0)
    p[0].y += 0.2
    expect(referenceScore(features(p, 640, 480)!, f).score).toBeGreaterThan(0.7)
  })
  it('rejects invalid dimensions, feature values, visibility and output time', () => {
    expect(features(points(), NaN, 480)).toBeNull()
    expect(features(points(), 640, Infinity)).toBeNull()
    const p = points()
    p[0].visibility = 2
    expect(features(p, 640, 480)).toBeNull()
    const f = features(points(), 640, 480)!,
      invalid = { ...f, tilt: NaN }
    expect(classify(invalid, f).status).toBe('unmeasurable')
    expect(referenceScore(invalid, f).score).toBeNull()
    expect(() => average([invalid])).toThrow()
    expect(() => payload(classify(f, f), NaN, 0)).toThrow()
  })
  it('requires continuous calibration and the minimum sample count without inventing frames', () => {
    const f = features(points(), 640, 480)!
    let draft = beginCalibration()
    const first = observeCalibration(draft, f, 0, 100)
    draft = first.draft
    // Time alone cannot complete registration with too few samples.
    expect(observeCalibration(draft, f, 5000, 100).ready).toBeNull()
    expect(observeCalibration(draft, null, 100, 100).draft.samples).toHaveLength(0)
    expect(observeCalibration(draft, f, 2000, 2000).draft.samples).toHaveLength(0)
    for (let i = 1; i <= 20; i++) draft = observeCalibration(draft, f, i * 250, 250).draft
    const done = observeCalibration(draft, f, 5250, 250)
    const ready = done.ready!
    expect(ready.headGap).toBeCloseTo(f.headGap)
    expect(ready.quality).toBeCloseTo(f.quality)
    // Without placements the summary cannot describe where the body was.
    expect(done.summary).toMatchObject({ durationMs: 5250, sampleCount: 22, placement: null })
    expect(done.summary!.spread.headGap).toBeCloseTo(0)
  })
  it('summarizes calibration spread and mean placement for the server baseline', () => {
    const f = features(points(), 640, 480)!
    const p = placement(points())!
    let draft = beginCalibration()
    let result = observeCalibration(draft, { ...f, headGap: f.headGap - 0.1 }, 0, 0, p)
    for (let i = 1; i <= 20; i++) {
      draft = result.draft
      const headGap = f.headGap + (i % 2 ? 0.1 : -0.1)
      result = observeCalibration(draft, { ...f, headGap }, i * 250, 250, p)
    }
    expect(result.summary!.sampleCount).toBe(21)
    expect(result.summary!.durationMs).toBe(5000)
    expect(result.summary!.spread.headGap).toBeGreaterThan(0.09)
    expect(result.summary!.spread.offset).toBeCloseTo(0)
    for (const key of ['x', 'y', 'area'] as const)
      expect(result.summary!.placement![key]).toBeCloseTo(p[key])
    expect(p.x).toBeGreaterThanOrEqual(0)
    expect(p.area).toBeLessThanOrEqual(1)
  })
})
