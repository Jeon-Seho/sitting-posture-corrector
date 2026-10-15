import { describe, expect, it } from 'vitest'
import { fitNormalPostureProfile, scoreNormalPosture, type NormalPostureProfile } from '../../../../model/prototype/normalPosture'
import { validateNormalReference } from '../../../../model/prototype/referenceValidation'

// Entirely synthetic normalized coordinates and anonymous codes. No camera data.
const poseModelId = 'synthetic-full-v1/tasks-1.0.1'
const values = () => Array.from({ length: 13 }, (_, index) =>
  index < 9 ? [0, -.8, -.1] : index < 11 ? [index === 9 ? -.3 : .3, -.75, 0] : [index === 11 ? -.5 : .5, 0, 0]).flat()
const profile = (purpose: 'personal_calibration' | 'training_normal' = 'personal_calibration') => fitNormalPostureProfile(
  Array.from({ length: 301 }, (_, i) => ({ timeMs: i * 100, values: values() })),
  { id: 'synthetic-profile', participantCode: 'synthetic-person', sessionCode: 'synthetic-session',
    purpose, poseModelId, createdAt: '2026-10-14T00:00:00Z' },
)
const shiftGroup = (input: number[], group: 'face' | 'ears', axis: number, delta: number) => input.map((value, index) => {
  const point = Math.floor(index / 3)
  const included = group === 'face' ? point < 9 : point >= 9 && point < 11
  return included && index % 3 === axis ? value + delta : value
})

describe('normal-reference validation with synthetic personal data', () => {
  it('accepts the learned pose and small movement with the same actual extractor', () => {
    const p = profile()
    expect(validateNormalReference(p, { values: values(), poseModelId })).toMatchObject({
      status: 'accepted', reason: 'within_normal_range', score: 0, strongestFeature: null, profileId: p.id,
    })
    const candidate = shiftGroup(values(), 'face', 0, .04)
    const result = validateNormalReference(p, { values: candidate, poseModelId })
    expect(result.status).toBe('accepted')
    expect(result.score).toBeCloseTo(1 / 3)
    expect(result.strongestFeature).toMatchObject({ index: 0, group: 'face', axis: 'x' })
  })

  it('rejects a substantially different reference and identifies the displaced feature', () => {
    const candidate = shiftGroup(values(), 'face', 1, .3)
    const result = validateNormalReference(profile(), { values: candidate, poseModelId })
    expect(result).toMatchObject({ status: 'rejected', reason: 'outside_normal_range',
      strongestFeature: { index: 1, group: 'face', axis: 'y' } })
    expect(result.score).toBeCloseTo(2.5)
    expect(result.strongestFeature?.delta).toBeCloseTo(.3)
    expect(result.strongestFeature?.ratio).toBeCloseTo(2.5)
  })

  it('uses the existing tolerance boundary inclusively without another threshold', () => {
    const p = profile(), atBoundary = values()
    atBoundary[35] = -.05; atBoundary[38] = .05
    const accepted = validateNormalReference(p, { values: atBoundary, poseModelId })
    expect(accepted).toMatchObject({ status: 'accepted', score: 1,
      strongestFeature: { index: 8, group: 'shoulders', axis: 'z', delta: .1, ratio: 1 } })
    atBoundary[38] += .001
    expect(validateNormalReference(p, { values: atBoundary, poseModelId }).status).toBe('rejected')
  })

  it('maps the second centroid to ears in liveForecastPoints order', () => {
    const candidate = shiftGroup(values(), 'ears', 2, -.24)
    const result = validateNormalReference(profile(), { values: candidate, poseModelId })
    expect(result).toMatchObject({ status: 'rejected', score: 2,
      strongestFeature: { index: 5, group: 'ears', axis: 'z', delta: -.24, ratio: 2 } })
  })

  it('does not recenter the learned range to a rejected registration during later scoring', () => {
    const p = profile(), shifted = shiftGroup(values(), 'face', 1, .3)
    const snapshot = structuredClone(p)
    expect(validateNormalReference(p, { values: shifted, poseModelId }).status).toBe('rejected')
    // Even replacing the stored 39D display reference cannot move the learned center.
    expect(scoreNormalPosture({ ...p, baseline: shifted }, shifted)?.score).toBeCloseTo(2.5)
    expect(scoreNormalPosture(p, values())?.score).toBe(0)
    expect(p).toEqual(snapshot)
    expect(shifted).toEqual(shiftGroup(values(), 'face', 1, .3))
  })

  it.each([
    { learnedId: poseModelId, actualId: undefined },
    { learnedId: undefined, actualId: poseModelId },
    { learnedId: undefined, actualId: undefined },
  ])('keeps missing extractor provenance unknown (%j)', ({ learnedId, actualId }) => {
    const p = profile()
    p.provenance.poseModelId = learnedId
    expect(validateNormalReference(p, { values: values(), poseModelId: actualId })).toMatchObject({
      status: 'incompatible', reason: 'pose_model_unknown', score: null, strongestFeature: null,
    })
  })

  it('refuses a different extractor even when its numeric coordinates match exactly', () => {
    expect(validateNormalReference(profile(), { values: values(), poseModelId: 'synthetic-heavy-v1/tasks-1.0.1' })).toMatchObject({
      status: 'incompatible', reason: 'pose_model_mismatch', score: null, strongestFeature: null,
    })
  })

  it('does not use training profiles as a personal registration gate', () => {
    expect(validateNormalReference(profile('training_normal'), { values: values(), poseModelId })).toMatchObject({
      status: 'incompatible', reason: 'profile_not_personal', score: null,
    })
  })

  it.each([null, [], Array(39).fill(NaN), Array(39).fill(Infinity), Array(38).fill(0)])(
    'never accepts a missing or invalid candidate as normal (%j)', candidate => {
      expect(validateNormalReference(profile(), { values: candidate, poseModelId })).toMatchObject({
        status: 'insufficient', reason: 'candidate_invalid', score: null, strongestFeature: null,
      })
    },
  )

  it('returns insufficient for a missing or corrupt learned profile', () => {
    expect(validateNormalReference(null, { values: values(), poseModelId })).toMatchObject({
      status: 'insufficient', reason: 'profile_missing', score: null, profileId: null,
    })
    const p = profile()
    for (const corrupt of [{ ...p, center: [NaN] }, { ...p, tolerance: Array(9).fill(0) }, {}]) {
      expect(validateNormalReference(corrupt as NormalPostureProfile, { values: values(), poseModelId })).toMatchObject({
        status: 'insufficient', reason: 'profile_invalid', score: null, strongestFeature: null,
      })
    }
    expect(scoreNormalPosture({ ...p, center: [NaN] }, values())).toBeNull()
  })
})
