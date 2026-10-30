import { afterEach, expect, it, vi } from 'vitest'
import { archiveError, baselineRecord, listBaselines, saveBaseline, subscribeArchive } from './baselineArchive'

afterEach(() => vi.unstubAllGlobals())

it('keeps assumed baseline data downloadable and reports unavailable persistent storage', async () => {
  vi.stubGlobal('indexedDB', undefined)
  const feature = { headGap: 0.5, offset: 0, tilt: 0, quality: 0.95 }
  const record = baselineRecord('synthetic-baseline-only', feature,
    { durationMs: 3000, sampleCount: 15, spread: { headGap: 0, offset: 0, tilt: 0 }, placement: null }, [])
  const changed = vi.fn()
  const unsubscribe = subscribeArchive(changed)
  await saveBaseline(record)
  expect(archiveError()).toContain('저장')
  expect(changed).toHaveBeenCalledTimes(2)
  expect(await listBaselines()).toContainEqual(record)
  expect(record).toMatchObject({ label: 'baseline_posture', normal_assumed: true,
    ground_truth_verified: false, participant_code: null })
  feature.offset = 100
  expect(record.baseline.offset).toBe(0)
  unsubscribe()
})
