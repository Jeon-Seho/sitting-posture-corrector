import { describe, expect, it } from 'vitest'
import type { Landmark } from '../../../../model/prototype/pose'
import { readShoulders } from './shoulderCheck'

// Synthetic upper body: nose, ears and shoulders in normalized image coordinates.
function body(shoulderVisibility = 0.95): Landmark[] {
  const points: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.1 }))
  points[0] = { x: 0.5, y: 0.35, z: 0, visibility: 0.95 }
  points[7] = { x: 0.46, y: 0.33, z: 0, visibility: 0.9 }
  points[8] = { x: 0.54, y: 0.33, z: 0, visibility: 0.9 }
  points[11] = { x: 0.38, y: 0.6, z: 0, visibility: shoulderVisibility }
  points[12] = { x: 0.62, y: 0.6, z: 0, visibility: shoulderVisibility }
  return points
}

describe('shoulder check (no grace, 2026-10-22)', () => {
  it('reads a frame with both shoulders', () => {
    const r = readShoulders(body(), 640, 480)
    expect(r).toEqual({ measurable: true, shoulders: 'seen' })
  })

  it('marks a frame without shoulders missing at once', () => {
    const r = readShoulders(body(0.2), 640, 480)
    expect(r).toEqual({ measurable: false, shoulders: 'missing' })
  })

  it('has nothing to say without a person', () => {
    expect(readShoulders([], 640, 480)).toEqual({ measurable: false, shoulders: undefined })
  })
})
