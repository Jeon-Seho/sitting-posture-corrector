import { describe, expect, it } from 'vitest'
import { comparisonDemo } from './comparisonDemo'
import { ObservationReplayArchive, parseObservationReplay } from './observationReplay'
import { observationFeatureExport } from './observationFeatureExport'

describe('explicit synthetic feature export', () => {
  it('preserves guidance, gaps and missing depth without inventing labels or values', () => {
    const archive = new ObservationReplayArchive('synthetic-feature-export', '2026-10-30T00:00:00Z')
    const context = { phase: 'registering' as const, task: 'neutral' as const, round: null, trial: null, attempt: 1, segment: 0, measurement: false }
    for (let t = 0; t <= 8000; t += 100) archive.append(comparisonDemo(t, 'neutral'), t, context)
    const frame = comparisonDemo(8100, 'deviation'); frame.worldLandmarks = []
    archive.append(frame, 8100, { ...context, phase: 'hold', task: 'deviation', round: 1, trial: 1, segment: 1, measurement: true })
    archive.mark(8200, 'hidden')
    const source = parseObservationReplay(JSON.stringify(archive.snapshot())), result = observationFeatureExport(source)
    expect(result).toMatchObject({ schema_version: 'observation-ml-candidates-v1', labelKind: 'guided_task_not_ground_truth' })
    expect(result.frames.at(-1)).toMatchObject({ phase: 'hold', task: 'deviation', measurement: true, imageValid: true, worldValid: false, features: { relativeZ: null } })
    expect(result.frames.at(-1)?.armsImage).toHaveLength(10)
    expect(result.markers).toEqual([{ elapsedMs: 8200, afterFrame: 81, reason: 'hidden' }])
    expect(JSON.stringify(result)).not.toMatch(/"image":|"world":|videoBlob|data:image/)
  })
})
