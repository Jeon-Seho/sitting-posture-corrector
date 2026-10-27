import { describe, expect, it } from 'vitest'
import { automaticComparisonCaptures } from './observationAutoSummary'
import type { ComparisonTrace } from './observationCsv'
import type { GuideSnapshot } from './observationProtocol'
const guide = (elapsedMs: number, attempt = 1): GuideSnapshot => ({ status: 'running', mode: 'auto', runId: 'explicit-synthetic-summary', step: { round: 1, trial: 1, action: 'head', phase: 'hold', durationMs: 5000 }, stepIndex: 1, attempt, elapsedMs, remainingMs: 5000 - elapsedMs, pauseReason: null })
const value = (n: number) => ({ headGap: n, faceHeight: n, shoulderLift: n, shoulderScale: n, relativeZ: n, zMeters: n })
const sample = (elapsedMs: number, n = 1, attempt = 1): ComparisonTrace => ({ elapsedMs, observationTimeMs: elapsedMs, action: 'head', segment: attempt, event: 'observation', status: 'measured', imageValid: true, worldValid: true, values: value(n), zMeters: n, guidance: guide(elapsedMs, attempt) })
const batch = (n = 1, attempt = 1) => Array.from({ length: 50 }, (_, i) => sample(i * 100, n, attempt))
const end = (attempt = 1): ComparisonTrace => ({ ...sample(5000, 1, attempt), event: 'protocol_phase_completed', values: null })
describe('automatic completed-hold summaries with synthetic traces', () => {
  it('uses the full completed hold median, skips preparations and ignores incomplete tasks', () => {
    expect(automaticComparisonCaptures(batch())).toEqual({})
    const trace = batch(); trace[20].values = value(999)
    const prep = { ...sample(0, -999), guidance: { ...guide(0), step: { ...guide(0).step!, phase: 'move' as const } } }
    const capture = automaticComparisonCaptures([prep, ...trace, end()]).head!
    expect(capture.values.headGap).toBe(1); expect(capture.sampleCount).toBe(50)
    expect(capture.windowStartMs).toBe(0); expect(capture.windowEndMs).toBe(4900)
  })
  it('excludes paused attempts and chooses the newest completed attempt or round', () => {
    const paused = { ...sample(1000), event: 'protocol_paused' as const }
    expect(automaticComparisonCaptures([...batch(), paused, end()])).toEqual({})
    const result = automaticComparisonCaptures([...batch(1), end(), ...batch(3, 2), end(2)])
    expect(result.head?.values.headGap).toBe(3)
    expect(result.head?.guidance?.attempt).toBe(2)
  })
  it('preserves unavailable depth and rejects missing 2D, gaps or a truncated hold', () => {
    const noDepth = batch().map(row => ({ ...row, worldValid: false, values: { ...row.values!, relativeZ: null, zMeters: null } }))
    expect(automaticComparisonCaptures([...noDepth, end()]).head?.values).toMatchObject({ headGap: 1, relativeZ: null, zMeters: null })
    const invalid = batch(); invalid[20].values = null
    expect(automaticComparisonCaptures([...invalid, end()])).toEqual({})
    expect(automaticComparisonCaptures([...batch().filter((_, i) => i < 10 || i > 20), end()])).toEqual({})
    expect(automaticComparisonCaptures([...batch().slice(20), end()])).toEqual({})
  })
})
