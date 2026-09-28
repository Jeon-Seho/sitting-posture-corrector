import { describe, it, expect } from 'vitest'
import { postureScore } from './postureScore'
import { cloudTargets, POSE_EDGES, validEdges, visiblePoint } from './poseVisual'
import { newMachine, sampleAt, step } from './engine'
import { DEFAULT_RULES } from '../data/posture'
import type { Landmark } from '../../../model/prototype/pose'
const points = (): Landmark[] => Array.from({ length: 33 }, (_,i) => ({x:.2+i*.01,y:.3+i*.01,z:0,visibility:.95}))

describe('intuitive display score', () => {
  it('maps reference to 100 and maximum deviation to 0, keeping unknown unavailable', () => {
    expect(postureScore(0)).toBe(100); expect(postureScore(1)).toBe(0)
    expect(postureScore(.7)).toBe(30); expect(postureScore(null)).toBeNull()
    expect(postureScore(NaN)).toBeNull(); expect(postureScore(-1)).toBe(100)
    expect(postureScore(2)).toBe(0)
  })
  it('retains warning behavior while reversing the displayed score', () => {
    for (const threshold of [.5,.7,.95]) for (const change of [.1,.49,.5,.69,.7,.94,.95,1]) {
      const m=newMachine()
      step(m,3,'running',{...DEFAULT_RULES,threshold},{...sampleAt(0),prob:change,state:'good'})
      expect(m.events.length === 1).toBe(postureScore(change)! <= postureScore(threshold)!)
    }
  })
})
describe('real joints and decorative particles', () => {
  it('includes eyes, mouth, hand and leg connections without inventing model indices', () => {
    expect(POSE_EDGES).toContainEqual([1,2]); expect(POSE_EDGES).toContainEqual([9,10])
    expect(POSE_EDGES).toContainEqual([15,21]); expect(POSE_EDGES).toContainEqual([28,32])
    expect(POSE_EDGES.every(edge => edge.every(i => i>=0 && i<33))).toBe(true)
  })
  it('hides occluded, invalid and offscreen joints and avoids bridging them', () => {
    const p=points(); p[11].visibility=.1; p[9].x=NaN; p[12].y=1.5
    expect(visiblePoint(p[11])).toBe(false); expect(visiblePoint(p[9])).toBe(false)
    expect(validEdges(p).some(edge=>edge.includes(11)||edge.includes(9)||edge.includes(12))).toBe(false)
    expect(cloudTargets([])).toEqual([])
  })
  it('bounds visual work, is deterministic and does not mutate measurements', () => {
    const p=points(), before=JSON.stringify(p), a=cloudTargets(p)
    expect(a.length).toBeLessThanOrEqual(445); expect(a.length).toBeGreaterThan(33)
    expect(cloudTargets(p)).toEqual(a); expect(JSON.stringify(p)).toBe(before)
    expect(a.every(v=>Number.isFinite(v.x)&&Number.isFinite(v.y)&&Number.isFinite(v.z))).toBe(true)
  })
})
