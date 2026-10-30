import { describe, expect, it } from 'vitest'
import { compareFaceToPose, FaceTrialAccumulator } from './comparison'
import { syntheticFace, syntheticObservation } from './syntheticFixture.test-helper'

describe('synthetic matched face/Pose comparisons, not accuracy', () => {
  it('measures signed image pixels independently of left/right point order', () => {
    const pose = syntheticObservation().landmarks.map(p => ({ ...p, visibility: 1 }))
    const snapshot = structuredClone(pose)
    const face = syntheticFace(1000, .01)
    face.points.reverse()
    expect(compareFaceToPose(face, pose, 1000, 640, 480)).toEqual({ meanPixels: expect.closeTo(4.8, 6), verticalPixels: expect.closeTo(-4.8, 6) })
    expect(pose).toEqual(snapshot)
  })
  it('does not pair another video frame or changed image crop', () => {
    const pose = syntheticObservation().landmarks.map(p => ({ ...p, visibility: 1 }))
    expect(compareFaceToPose(syntheticFace(), pose, 1002, 640, 480)).toBeNull()
    expect(compareFaceToPose(syntheticFace(), pose, 1000, 320, 240)).toBeNull()
  })
  it('rejects missing anchors, poor Pose visibility and invalid face points', () => {
    const pose = syntheticObservation().landmarks.map(p => ({ ...p, visibility: 1 }))
    pose[2].visibility = .1
    expect(compareFaceToPose(syntheticFace(), pose, 1000, 640, 480)).toBeNull()
    pose[2].visibility = 1
    const face = syntheticFace(); face.points[0].x = NaN
    expect(compareFaceToPose(face, pose, 1000, 640, 480)).toBeNull()
    face.points = []
    expect(compareFaceToPose(face, pose, 1000, 640, 480)).toBeNull()
  })
  it('counts unsuccessful requests and leaves missing/empty comparisons unknown', () => {
    const trial = new FaceTrialAccumulator(1, true, 0)
    expect(trial.finish(1000)).toMatchObject({ meanDifferencePixels: null, meanInferenceMs: null })
    trial.add(null, null, 5, 10, 'CPU')
    trial.add(syntheticFace(), null, 7, 20, 'CPU')
    trial.add(syntheticFace(), { meanPixels: 4, verticalPixels: -2 }, 9, 30, 'CPU')
    expect(trial.finish(10000)).toMatchObject({ attempted: 3, detected: 2, paired: 1, meanDifferencePixels: 4, meanVerticalPixels: -2, meanInferenceMs: 7, meanRoundTripMs: 20, delegate: 'CPU' })
  })
})
