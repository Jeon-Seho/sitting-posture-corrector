import { describe, it, expect } from 'vitest'
import { postureScore } from './postureScore'
import { cloudTargets, POSE_EDGES, validEdges, visiblePoint } from './poseVisual'
import type { Landmark } from '../../../model/prototype/pose'
const points = (): Landmark[] =>
  Array.from({ length: 33 }, (_, i) => ({
    x: 0.2 + i * 0.01,
    y: 0.3 + i * 0.01,
    z: 0,
    visibility: 0.95,
  }))

describe('intuitive display score', () => {
  it('maps reference to 100 and maximum deviation to 0, keeping unknown unavailable', () => {
    expect(postureScore(0)).toBe(100)
    expect(postureScore(1)).toBe(0)
    expect(postureScore(0.7)).toBe(30)
    expect(postureScore(null)).toBeNull()
    expect(postureScore(NaN)).toBeNull()
    expect(postureScore(-1)).toBe(100)
    expect(postureScore(2)).toBe(0)
  })
})
describe('real joints and decorative particles', () => {
  it('includes only face and shoulder connections using the original model indices', () => {
    expect(POSE_EDGES).toContainEqual([1, 2])
    expect(POSE_EDGES).toContainEqual([9, 10])
    expect(POSE_EDGES).toContainEqual([11, 12])
    expect(POSE_EDGES.every((edge) => edge.every((i) => i >= 0 && i < 13))).toBe(true)
  })
  it('hides occluded, invalid and offscreen joints and avoids bridging them', () => {
    const p = points()
    p[11].visibility = 0.1
    p[9].x = NaN
    p[12].y = 1.5
    expect(visiblePoint(p[11])).toBe(false)
    expect(visiblePoint(p[9])).toBe(false)
    expect(
      validEdges(p).some((edge) => edge.includes(11) || edge.includes(9) || edge.includes(12)),
    ).toBe(false)
    expect(cloudTargets([])).toEqual([])
  })
  it('bounds visual work, is deterministic and does not mutate measurements', () => {
    const p = points(),
      before = JSON.stringify(p),
      a = cloudTargets(p)
    expect(a.length).toBeLessThanOrEqual(80)
    expect(a.length).toBeGreaterThan(33)
    expect(cloudTargets(p)).toEqual(a)
    expect(cloudTargets(p.slice(0, 13))).toEqual(a)
    expect(JSON.stringify(p)).toBe(before)
    expect(
      a.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)),
    ).toBe(true)
  })
})
