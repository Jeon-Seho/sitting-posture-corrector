import { describe, expect, it } from 'vitest'
import { ObservationProtocol, observationSteps } from './observationProtocol'

const THREE = { rounds: 3, shuffle: false, cycle: 'stretch' } as const
const STEPS = observationSteps(THREE)

describe('requested observation guidance clock, independent of measured posture', () => {
  it('waits immediately on every manual move, retains timed holds and rejects repeated next', () => {
    const protocol = new ObservationProtocol(); protocol.start(0, 'synthetic-manual', 'manual', THREE)
    let now = 0
    for (const [index, step] of STEPS.entries()) {
      if (protocol.snapshot(now).status === 'note') { expect(protocol.next(now + 1)).toBe('none'); expect(protocol.finishNote(now)).toBe(true) }
      if (step.phase === 'move') {
        expect(protocol.snapshot(now)).toMatchObject({ status: 'waiting', stepIndex: index, remainingMs: 0, step: { durationMs: 0 } })
        expect(protocol.next(now)).toBe('none')
      } else {
        expect(protocol.next(now)).toBe('none')
        for (let elapsed = 100; elapsed < step.durationMs; elapsed += 100) {
          now += 100; expect(protocol.advance(now)).toBe('none'); expect(protocol.next(now)).toBe('none')
        }
        now += 100; expect(protocol.advance(now)).toBe('waiting')
      }
      expect(protocol.snapshot(now)).toMatchObject({ status: 'waiting', mode: 'manual', stepIndex: index, remainingMs: 0 })
      now += 30000
      expect(protocol.advance(now)).toBe('none')
      expect(protocol.start(now, 'replace')).toBe(false)
      expect(protocol.snapshot(now).stepIndex).toBe(index)
      expect(protocol.next(now)).toBe(index === STEPS.length - 1 ? 'completed' : 'phase')
      expect(protocol.next(now)).toBe('none')
      if (index < STEPS.length - 1) expect(protocol.snapshot(now).remainingMs).toBe(STEPS[index + 1].phase === 'move' ? 0 : STEPS[index + 1].durationMs)
    }
    expect(protocol.snapshot(now).status).toBe('completed')
  })
  it('guides deviation then stretch for three rounds in 18 full phases and exactly 81 nominal seconds', () => {
    const protocol = new ObservationProtocol()
    protocol.start(0, 'synthetic-clock', 'auto', THREE)
    const boundaries: number[] = [], completed = []
    for (let now = 100; now <= 81000; now += 100) {
      const before = protocol.snapshot(now), result = protocol.advance(now)
      if (result === 'phase' || result === 'completed') { boundaries.push(now); completed.push(before) }
      if (protocol.snapshot(now).status === 'note') protocol.finishNote(now)
    }
    expect(boundaries.slice(0, 6)).toEqual([2000, 7000, 12000, 14000, 22000, 27000])
    expect(completed).toHaveLength(18)
    expect(completed.map(s => s.step)).toEqual(STEPS)
    expect(completed.every(s => s.elapsedMs === s.step!.durationMs && s.stepCount === 18)).toBe(true)
    expect(completed.filter(s => s.step!.phase === 'hold').map(s => [s.step!.round, s.step!.action, s.step!.durationMs])).toEqual([1, 2, 3].flatMap(round => [[round, 'deviation', 5000], [round, 'stretch', 8000]]))
    expect(protocol.snapshot(81000).status).toBe('completed')
    expect(protocol.advance(200000)).toBe('none')
  })
  it('defaults to repeating deviation and offers a separate stretch cycle', () => {
    expect(observationSteps().filter(s => s.phase === 'hold').map(s => s.action)).toEqual(['deviation', 'deviation'])
    expect(observationSteps({ rounds: 1, shuffle: false, cycle: 'stretch' }).map(s => [s.action, s.phase])).toEqual([
      ['deviation', 'move'], ['deviation', 'hold'], ['deviation', 'return'],
      ['stretch', 'move'], ['stretch', 'hold'], ['stretch', 'return'],
    ])
    const protocol = new ObservationProtocol()
    expect(protocol.snapshot(0)).toMatchObject({ stepCount: 6, plan: { rounds: 1, cycle: 'repeat' }, next: { action: 'deviation', phase: 'move' } })
    expect(protocol.start(0, 'synthetic-bad-plan', 'auto', { rounds: 6 as 1, shuffle: false })).toBe(false)
  })
  it.each(['auto', 'manual'] as const)('waits before every stretch until a note is submitted in %s mode', mode => {
    const protocol = new ObservationProtocol()
    protocol.start(0, 'synthetic-note', mode, { rounds: 2, shuffle: false, cycle: 'stretch' })
    let now = 0, prompts = 0
    while (protocol.snapshot(now).status !== 'completed' && now < 200000) {
      const state = protocol.snapshot(now)
      if (state.status === 'note') {
        prompts++; const before = state.stepIndex
        now += 10000
        expect(protocol.advance(now)).toBe('none')
        expect(protocol.next(now)).toBe('none')
        expect(protocol.snapshot(now)).toMatchObject({ status: 'note', stepIndex: before, elapsedMs: 0 })
        expect(protocol.finishNote(now)).toBe(true)
      } else if (state.status === 'waiting') { now += 100; protocol.next(now) }
      else { now += 100; protocol.advance(now) }
    }
    expect(prompts).toBe(2); expect(protocol.snapshot(now).status).toBe('completed')
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
