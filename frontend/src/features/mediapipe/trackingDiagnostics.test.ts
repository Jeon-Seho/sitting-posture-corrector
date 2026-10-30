import { afterEach, expect, it, vi } from 'vitest'
import { beginTrackingDiagnostics, readTrackingDiagnostics, resetTrackingDiagnostics } from './trackingDiagnostics'

afterEach(() => vi.restoreAllMocks())

it('keeps only a bounded window and computes timing percentiles without exposing samples', () => {
  const collector = beginTrackingDiagnostics('GPU', 'legacy')
  for (let value = 1; value <= 400; value++) {
    collector.record('inferenceWallMs', value)
    collector.frame()
  }
  collector.record('inferenceWallMs', NaN)
  collector.record('inferenceWallMs', -1)
  collector.record('inferenceWallMs', Infinity)
  const result = readTrackingDiagnostics()!
  expect(result.frames).toBe(400)
  expect(result.timing.inferenceWallMs).toEqual({ count: 300, mean: 250.5, p50: 250, p95: 385, max: 400 })
  expect(result.timing.consumerMs).toEqual({ count: 0, mean: 0, p50: 0, p95: 0, max: 0 })
  expect(Object.keys(result)).toEqual(['active', 'delegate', 'pacing', 'frames', 'elapsedMs', 'sampleLimit', 'timing'])
  result.timing.inferenceWallMs.mean = 0
  expect(readTrackingDiagnostics()!.timing.inferenceWallMs.mean).toBe(250.5)
})

it('resets the active collector and freezes stopped timing', () => {
  let time = 10
  vi.spyOn(performance, 'now').mockImplementation(() => time)
  const collector = beginTrackingDiagnostics('CPU', 'legacy')
  collector.record('consumerMs', 5)
  collector.frame()
  time = 100
  resetTrackingDiagnostics()
  expect(readTrackingDiagnostics()).toMatchObject({ active: true, frames: 0, elapsedMs: 0, delegate: 'CPU' })
  collector.record('consumerMs', 7)
  collector.frame()
  time = 150
  collector.stop()
  time = 300
  collector.frame()
  collector.record('consumerMs', 100)
  expect(readTrackingDiagnostics()).toMatchObject({ active: false, frames: 1, elapsedMs: 50, timing: { consumerMs: { count: 1, mean: 7 } } })
})

it('separates successive tracker lifetimes without old loop writes corrupting the current result', () => {
  const old = beginTrackingDiagnostics('CPU', 'legacy')
  old.record('drawMs', 100)
  const next = beginTrackingDiagnostics('GPU', 'responsive')
  next.record('drawMs', 3)
  old.record('drawMs', 200)
  old.stop()
  expect(readTrackingDiagnostics()).toMatchObject({ active: true, delegate: 'GPU', pacing: 'responsive', timing: { drawMs: { mean: 3, count: 1 } } })
})
