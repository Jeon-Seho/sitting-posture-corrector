import { describe, expect, it } from 'vitest'
import { baselineFeatures, validBaseline } from './baseline'
import { SYNTHETIC_LANDMARKS } from '../testing/syntheticLandmarks'

describe('stored mean-coordinate baseline', () => {
  it('uses the same persisted geometry on fresh adoption and reload', () => {
    const value = { schema_version: '2.0', baseline_id: '22222222-2222-3222-8222-222222222222',
      registered_at: '2026-10-13T00:00:00Z', landmarks: SYNTHETIC_LANDMARKS }
    expect(validBaseline(value)).toBe(true)
    const original = baselineFeatures(value.landmarks, 640, 480)
    const restored = baselineFeatures(JSON.parse(JSON.stringify(value)).landmarks, 1280, 960)
    expect(restored).toEqual(original)
    expect(original?.quality).toBe(1)
  })
  it('rejects unusable or corrupt stored geometry', () => {
    const bad = { ...SYNTHETIC_LANDMARKS, right_shoulder: SYNTHETIC_LANDMARKS.left_shoulder }
    expect(baselineFeatures(bad, 640, 480)).toBeNull()
    expect(validBaseline({ landmarks: bad })).toBe(false)
    expect(baselineFeatures(SYNTHETIC_LANDMARKS, 0, 480)).toBeNull()
  })
})
