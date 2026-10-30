import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { measurePipeline, PIPELINE_SAMPLE_LIMIT, readPipelinePerformance, recordPipelineDuration, resetPipelinePerformance } from './pipelinePerformance'

describe('developer timing diagnostics without observation payloads', () => {
  beforeEach(resetPipelinePerformance)
  afterEach(() => vi.restoreAllMocks())

  it('reports empty samples explicitly, ignores invalid durations and keeps nearest-rank quantiles', () => {
    expect(readPipelinePerformance().engineStep).toMatchObject({ count: 0, samples: 0, p50Ms: null, p95Ms: null, maxMs: null })
    for (const duration of [Number.NaN, Infinity, -1]) recordPipelineDuration('engineStep', duration)
    for (let i = 1; i <= 100; i++) recordPipelineDuration('engineStep', i)
    expect(readPipelinePerformance().engineStep).toEqual({ count: 100, samples: 100, p50Ms: 50, p95Ms: 95, maxMs: 100, meanMs: 50.5, totalMs: 5050 })
    expect(readPipelinePerformance().cameraConsumer.count).toBe(0)
  })

  it('bounds the retained window, preserves lifetime counts and returns detached snapshots', () => {
    recordPipelineDuration('cameraConsumer', 1000)
    for (let i = 0; i < PIPELINE_SAMPLE_LIMIT; i++) recordPipelineDuration('cameraConsumer', 2)
    const snapshot = readPipelinePerformance()
    expect(snapshot.cameraConsumer).toEqual({ count: 601, samples: 600, p50Ms: 2, p95Ms: 2, maxMs: 2, meanMs: 2, totalMs: 2200 })
    snapshot.cameraConsumer.count = -1
    expect(readPipelinePerformance().cameraConsumer.count).toBe(601)
    resetPipelinePerformance()
    expect(readPipelinePerformance().cameraConsumer.count).toBe(0)
  })

  it('measures the same clock in finally, returns values and preserves thrown errors', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValueOnce(12).mockReturnValueOnce(17)
      .mockReturnValueOnce(20).mockReturnValueOnce(29)
    const value = { completed: true }
    expect(measurePipeline('publishScheduling', () => value)).toBe(value)
    const error = new Error('explicit test failure')
    expect(() => measurePipeline('publishScheduling', () => { throw error })).toThrow(error)
    expect(now).toHaveBeenCalledTimes(4)
    expect(readPipelinePerformance().publishScheduling).toEqual({ count: 2, samples: 2, p50Ms: 5, p95Ms: 9, maxMs: 9, meanMs: 7, totalMs: 14 })
  })
})
