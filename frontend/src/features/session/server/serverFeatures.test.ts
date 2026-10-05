import { describe, expect, it } from 'vitest'
import fixture from '../../../../../contracts/examples/v2/reference-feature-cases.json'
import { featureDeltas } from '../../../../../model/prototype/serverFeatures'
import { referenceScore, type Features } from '../../../../../model/prototype/pose'

describe('shared synthetic reference-feature fixtures across browser and FastAPI', () => {
  it.each(fixture.cases)(
    '$name transports identical deltas and preserves the existing reference score',
    (example) => {
      const current = example.current as Features | null
      const baseline = example.baseline as Features | null
      expect(featureDeltas(current, baseline)).toEqual(example.expected_features)
      if (example.expected_observation.valid && current && baseline) {
        expect(referenceScore(current, baseline).score).toBeCloseTo(
          example.expected_observation.collapse_probability,
          12,
        )
      }
    },
  )

  it('does not clamp overflow/nonfinite inputs or manufacture an absent baseline', () => {
    const good = { headGap: 0.7, offset: 0, tilt: 0, quality: 0.9 }
    expect(featureDeltas(good, null)).toBeNull()
    expect(featureDeltas({ ...good, headGap: NaN }, good)).toBeNull()
    expect(
      featureDeltas(
        { ...good, headGap: Number.MAX_VALUE },
        { ...good, headGap: -Number.MAX_VALUE },
      ),
    ).toBeNull()
  })
})
