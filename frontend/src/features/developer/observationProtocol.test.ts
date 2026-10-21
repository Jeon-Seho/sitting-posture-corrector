import { describe, expect, it } from 'vitest'
import { ObservationProtocol, OBSERVATION_STEPS } from './observationProtocol'

describe('requested observation guidance clock, independent of measured posture', () => {
  it('guides all four actions for three rounds in 36 full phases and exactly 144 nominal seconds', () => {
    const protocol = new ObservationProtocol()
    protocol.start(0, 'synthetic-clock')
    const boundaries: number[] = [], completed = []
    for (let now = 100; now <= 144000; now += 100) {
      const before = protocol.snapshot(now), result = protocol.advance(now)
      if (result === 'phase' || result === 'completed') { boundaries.push(now); completed.push(before) }
    }
    expect(boundaries.slice(0, 6)).toEqual([2000, 7000, 12000, 14000, 19000, 24000])
    expect(completed).toHaveLength(36)
    expect(completed.map(s => s.step)).toEqual(OBSERVATION_STEPS)
    expect(completed.every(s => s.elapsedMs === s.step!.durationMs)).toBe(true)
    expect(completed.filter(s => s.step!.phase === 'hold').map(s => [s.step!.round, s.step!.action])).toEqual([1, 2, 3].flatMap(round => ['head','bow','body','shoulders'].map(action => [round, action])))
    expect(protocol.snapshot(144000).status).toBe('completed')
    expect(protocol.advance(200000)).toBe('none')
  })
  it('freezes a paused hold and restarts that phase with a separate attempt on explicit resume', () => {
    const protocol = new ObservationProtocol(); protocol.start(0, 'synthetic-pause')
    for (let now = 100; now <= 3500; now += 100) protocol.advance(now)
    expect(protocol.pause('hidden')).toBe(true)
    expect(protocol.snapshot(60000)).toMatchObject({ status: 'paused', elapsedMs: 1500, remainingMs: 3500, attempt: 1, step: { phase: 'hold' } })
    expect(protocol.advance(60000)).toBe('none'); expect(protocol.start(60000, 'replace')).toBe(false)
    expect(protocol.resume(60000)).toBe(true)
    expect(protocol.snapshot(60000)).toMatchObject({ elapsedMs: 0, remainingMs: 5000, attempt: 2 })
    for (let now = 60100; now < 65000; now += 100) expect(protocol.advance(now)).toBe('none')
    expect(protocol.advance(65000)).toBe('phase')
    expect(protocol.snapshot(65000)).toMatchObject({ step: { phase: 'return' }, attempt: 1 })
  })
  it.each([5001, -1, NaN, Infinity])('pauses on a stalled or invalid monotonic clock (%s) without skipping steps', now => {
    const protocol = new ObservationProtocol(); protocol.start(0, 'synthetic-gap')
    expect(protocol.advance(now)).toBe('paused')
    expect(protocol.snapshot(60000)).toMatchObject({ status: 'paused', stepIndex: 0, elapsedMs: 0, pauseReason: 'clock_gap' })
  })
  it('gives the next instruction its full duration after a small scheduling delay', () => {
    const protocol = new ObservationProtocol(); protocol.start(0, 'synthetic-delay')
    for (let now = 500; now <= 1500; now += 500) protocol.advance(now)
    protocol.advance(1990); expect(protocol.advance(2150)).toBe('phase')
    expect(protocol.snapshot(2150)).toMatchObject({ remainingMs: 5000, step: { phase: 'hold' } })
  })
  it('cancels without reporting completion and never resumes or advances a cancelled trial', () => {
    const protocol = new ObservationProtocol(); protocol.start(0, 'synthetic-cancel')
    protocol.advance(100); expect(protocol.cancel(150)).toBe(true)
    expect(protocol.snapshot(60000)).toMatchObject({ status: 'cancelled', stepIndex: 0 })
    expect(protocol.resume(60000)).toBe(false); expect(protocol.advance(60000)).toBe('none')
  })
})
