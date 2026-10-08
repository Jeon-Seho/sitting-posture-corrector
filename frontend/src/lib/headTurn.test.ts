import { describe, expect, it } from 'vitest'
import {
  features,
  headTurned,
  referenceScore,
  type Landmark,
} from '../../../model/prototype/pose'

/** Synthetic face and shoulders only; x grows toward the user's left in the camera image. */
function pose({ nose = 0.5, ears = 0.5 }: { nose?: number; ears?: number }): Landmark[] {
  const points: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }))
  points[0] = { x: nose, y: 0.4, z: 0, visibility: 0.9 }
  points[7] = { x: ears + 0.08, y: 0.38, z: 0, visibility: 0.9 }
  points[8] = { x: ears - 0.08, y: 0.38, z: 0, visibility: 0.9 }
  points[11] = { x: 0.7, y: 0.8, z: 0, visibility: 0.9 }
  points[12] = { x: 0.3, y: 0.8, z: 0, visibility: 0.9 }
  return points
}
const read = (p: Landmark[]) => features(p, 640, 480)!

describe('head turn and head-centre lean (synthetic landmarks)', () => {
  it('measures sideways lean from the ear midpoint, not the nose', () => {
    const turned = read(pose({ nose: 0.58 }))
    expect(turned.offset).toBeCloseTo(0)
    expect(turned.turn).toBeCloseTo((0.08 * 640) / 256)
    const leaned = read(pose({ nose: 0.58, ears: 0.58 }))
    expect(leaned.offset).toBeCloseTo((0.08 * 640) / 256)
    expect(leaned.turn).toBeCloseTo(0)
  })

  it('leaves a turned head unjudged but still judges a lean of the whole head', () => {
    const baseline = read(pose({}))
    const turned = read(pose({ nose: 0.58 }))
    expect(headTurned(turned, baseline)).toBe(true)
    expect(referenceScore(turned, baseline)).toMatchObject({ score: null, headTurn: true })
    const leaned = read(pose({ nose: 0.58, ears: 0.58 }))
    expect(headTurned(leaned, baseline)).toBe(false)
    expect(referenceScore(leaned, baseline)).toMatchObject({ tilt: true, side: 'left', headTurn: false })
  })

  it('reads a baseline saved without turn as facing forward', () => {
    const { turn: _, ...old } = read(pose({}))
    expect(headTurned(read(pose({ nose: 0.58 })), old)).toBe(true)
    expect(headTurned(read(pose({})), old)).toBe(false)
  })

  it('still judges a slight turn', () => {
    const baseline = read(pose({}))
    const slight = read(pose({ nose: 0.54 }))
    expect(headTurned(slight, baseline)).toBe(false)
    expect(referenceScore(slight, baseline).score).not.toBeNull()
  })

  it('falls back to the nose when the ears are missing', () => {
    const points = pose({ nose: 0.58 })
    delete (points as unknown[])[7]
    const reading = read(points)
    expect(reading.offset).toBeCloseTo((0.08 * 640) / 256)
    expect(reading.turn).toBe(0)
  })
})
