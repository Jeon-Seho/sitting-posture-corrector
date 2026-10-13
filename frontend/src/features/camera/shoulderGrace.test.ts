import { describe, expect, it } from 'vitest'
import type { Landmark } from '../../../../model/prototype/pose'
import { judgeWithGrace } from './shoulderGrace'

// Synthetic upper body: nose, ears and shoulders in normalized image coordinates.
function body(shoulderVisibility = 0.95, noseY = 0.35): Landmark[] {
  const points: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.1 }))
  points[0] = { x: 0.5, y: noseY, z: 0, visibility: 0.95 }
  points[7] = { x: 0.46, y: 0.33, z: 0, visibility: 0.9 }
  points[8] = { x: 0.54, y: 0.33, z: 0, visibility: 0.9 }
  points[11] = { x: 0.38, y: 0.6, z: 0, visibility: shoulderVisibility }
  points[12] = { x: 0.62, y: 0.6, z: 0, visibility: shoulderVisibility }
  return points
}

describe('2 s shoulder grace', () => {
  it('judges normally with shoulders and remembers them', () => {
    const r = judgeWithGrace(body(), 640, 480, 1000, null)
    expect(r.shoulders).toBe('seen')
    expect(r.reading).not.toBeNull()
    expect(r.last?.time).toBe(1000)
  })

  it('judges the head against the last shoulders for up to 2 s, then stops', () => {
    const seen = judgeWithGrace(body(), 640, 480, 1000, null)
    const grace = judgeWithGrace(body(0.2, 0.42), 640, 480, 2900, seen.last)
    expect(grace.shoulders).toBe('grace')
    expect(grace.reading).not.toBeNull()
    // The head dropped toward the remembered shoulders: the gap shrinks.
    expect(grace.reading!.headGap).toBeLessThan(seen.reading!.headGap)
    // Grace never refreshes the remembered shoulders.
    expect(grace.last).toBe(seen.last)
    const after = judgeWithGrace(body(0.2), 640, 480, 3100, grace.last)
    expect(after.shoulders).toBe('missing')
    expect(after.reading).toBeNull()
  })

  it('has no grace without earlier shoulders and nothing to say without a person', () => {
    expect(judgeWithGrace(body(0.2), 640, 480, 1000, null).shoulders).toBe('missing')
    expect(judgeWithGrace([], 640, 480, 1000, null)).toEqual({ reading: null, shoulders: undefined, last: null })
  })
})
