import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES } from '../data/posture'
import { closeOpenEvent, newMachine, sampleAt, snapshot, step, type Machine, type Sample } from './engine'
import { features, classify, average, type Landmark } from '../../../model/prototype/pose'
import { referenceScore } from '../../../model/prototype/pose'

const reading = (prob: number, unknown = false): Sample => ({ ...sampleAt(0), state: unknown ? 'unknown' : prob >= 0.7 ? 'collapse' : 'good', prob, collapse: 'forwardHead', confidence: unknown ? 0 : 0.95 })
function run(m: Machine, seconds: number, s: Sample, phase: 'running' | 'paused' = 'running', alerts = true) {
  for (let i = 0; i < Math.round(seconds * 10); i++) step(m, 0.1, phase, DEFAULT_RULES, s, alerts)
}
describe('shared demo and camera event policy', () => {
  it('requires 3 seconds and 60 seconds between actual alerts', () => {
    const m = newMachine(); run(m, 2.9, reading(0.9)); expect(m.events).toHaveLength(0)
    run(m, 0.1, reading(0.9)); expect(m.events).toHaveLength(1); expect(m.alertTick).toBe(1)
    run(m, 59.9, reading(0.9)); expect(m.alertTick).toBe(1)
    run(m, 0.2, reading(0.9)); expect(m.alertTick).toBe(2)
  })
  it('preserves the existing 2-second recovery hysteresis', () => {
    const m = newMachine(); run(m, 4, reading(0.9)); run(m, 1.9, reading(0.1))
    expect(m.active).not.toBeNull(); run(m, 0.1, reading(0.1))
    expect(m.active).toBeNull(); expect(m.events[0].recovered).toBe(true); expect(m.events[0].recoverySec).toBeCloseTo(3)
  })
  it('closes an event on tracking loss, excludes missing time, and breaks interval groups', () => {
    const m = newMachine(); run(m, 4, reading(0.9)); const valid = m.total
    run(m, 10, reading(0, true)); expect(m.events[0].endReason).toBe('unknown'); expect(m.events[0].durationSec).toBeCloseTo(4)
    expect(m.events[0].recoverySec).toBeNull(); expect(snapshot(m, reading(0, true), DEFAULT_RULES).validSeconds).toBeCloseTo(valid)
    run(m, 2, reading(0.9)); expect(m.events).toHaveLength(1)
    run(m, 1, reading(0.9)); expect(m.events).toHaveLength(2); expect(m.events[0].blockId).not.toBe(m.events[1].blockId)
  })
  it('interrupts on pause, excludes breaks, and closes on session end', () => {
    const m = newMachine(); run(m, 4, reading(0.9)); run(m, 20, reading(0.9), 'paused')
    expect(m.events[0].endReason).toBe('paused'); expect(m.events[0].durationSec).toBeCloseTo(4); expect(m.hold).toBe(0)
    expect(snapshot(m, reading(0.9), DEFAULT_RULES).validSeconds).toBeCloseTo(4)
    run(m, 3, reading(0.9)); closeOpenEvent(m); expect(m.events[0].endedBySession).toBe(true)
    const total = m.total; step(m, 5, 'ended', DEFAULT_RULES, reading(0.9)); expect(m.total).toBe(total)
  })
  it('records muted events without counting imaginary notifications', () => {
    const m = newMachine(); run(m, 4, reading(0.9), 'running', false)
    expect(m.events[0].alerts).toBe(0); expect(m.events[0].firstAlertAt).toBeNull(); expect(m.alertTick).toBe(0)
    run(m, 1, reading(0.9)); expect(m.events[0].alerts).toBe(1)
    run(m, 2, reading(0.1)); expect(m.events[0].recoverySec).toBeCloseTo(2.9)
  })
  it('resets an interrupted candidate and uses the configured threshold for statistics', () => {
    const m = newMachine(); run(m, 2, reading(0.9)); run(m, 1, reading(0, true)); run(m, 2, reading(0.9))
    expect(m.events).toHaveLength(0)
    const before = m.good
    const s = step(m, 1, 'running', { ...DEFAULT_RULES, threshold: 0.95 }, reading(0.9))
    expect(s.state).toBe('good'); expect(m.good).toBeCloseTo(before + 1)
  })
  it('rejects invalid durations and advances the original scenario', () => {
    const m = newMachine(); step(m, -1, 'running', DEFAULT_RULES); step(m, NaN, 'running', DEFAULT_RULES)
    expect(m.total).toBe(0); step(m, 1, 'running', DEFAULT_RULES); expect(m.loop).toBe(1)
  })
})
describe('webcam reference adapter', () => {
  const points = (): Landmark[] => Array.from({ length: 33 }, (_, i) => ({ x: i === 11 ? 0.3 : i === 12 ? 0.7 : 0.5, y: i === 0 ? 0.25 : 0.5, z: 0, visibility: 0.95 }))
  it('requires a visible face and both shoulders', () => {
    expect(features([], 640, 480)).toBeNull(); const p = points(); p[11].visibility = 0.2; expect(features(p, 640, 480)).toBeNull()
  })
  it('normalizes translation and reports dimensionless reference changes', () => {
    const p = points(), f = features(p, 640, 480)!
    expect(referenceScore(f, average([f, f])).score).toBe(0)
    expect(classify(null, f).status).toBe('unmeasurable')
    const shifted = p.map(v => ({ ...v, x: v.x + 0.03, y: v.y + 0.03 }))
    expect(referenceScore(features(shifted, 640, 480)!, f).score).toBeCloseTo(0)
    p[0].y += 0.2; expect(referenceScore(features(p, 640, 480)!, f).score).toBeGreaterThan(0.7)
  })
})
