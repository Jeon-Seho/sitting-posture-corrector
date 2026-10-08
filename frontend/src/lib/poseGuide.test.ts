import { describe, expect, it } from 'vitest'
import type { Landmark } from '../../../model/prototype/pose'
import { defaultGuide, fittedGuide, smoothPoints } from './poseGuide'

// Explicitly synthetic landmarks: nose (0) and shoulders (11, 12) only.
function person(cx: number, cy: number, span: number): Landmark[] {
  const points: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }))
  points[0] = { x: cx, y: cy, z: 0, visibility: 0.99 }
  points[11] = { x: cx + span / 2, y: cy + 0.2, z: 0, visibility: 0.99 }
  points[12] = { x: cx - span / 2, y: cy + 0.2, z: 0, visibility: 0.99 }
  return points
}

describe('pose guide follows the person instead of a fixed outline', () => {
  it('keeps the original default placement until a face and both shoulders are visible', () => {
    const guide = defaultGuide()
    expect(guide).toMatchObject({ width: 800, height: 600, fitted: false })
    expect(guide.head).toEqual({ cx: 400, cy: 230, rx: 105, ry: 125 })
    expect(fittedGuide([], 640, 480)).toBeNull()
    const hidden = person(0.5, 0.4, 0.4)
    hidden[11] = { ...hidden[11], visibility: 0.2 }
    expect(fittedGuide(hidden, 640, 480)).toBeNull()
  })

  it('scales with shoulder width, so near and far seating both fit', () => {
    const near = fittedGuide(person(0.5, 0.35, 0.6), 640, 480)!
    const far = fittedGuide(person(0.5, 0.35, 0.25), 640, 480)!
    expect(near.fitted && far.fitted).toBe(true)
    expect(near.head.rx).toBeCloseTo(far.head.rx * (0.6 / 0.25), 5)
    expect(near.head.cx).toBeCloseTo(320)
    expect(near.width).toBe(640)
    expect(near.shoulders).toMatch(/^M[\d.-]+ [\d.-]+ C/)
  })

  it('follows an off-center person and ignores a too-small detection', () => {
    const left = fittedGuide(person(0.3, 0.4, 0.3), 640, 480)!
    expect(left.head.cx).toBeCloseTo(0.3 * 640)
    expect(fittedGuide(person(0.5, 0.4, 0.02), 640, 480)).toBeNull()
  })

  it('smooths small movement and snaps on a large jump', () => {
    const a = person(0.5, 0.4, 0.3),
      b = person(0.52, 0.4, 0.3)
    const smoothed = smoothPoints(a, b)
    expect(smoothed[0].x).toBeGreaterThan(0.5)
    expect(smoothed[0].x).toBeLessThan(0.52)
    const jumped = person(0.85, 0.4, 0.3)
    expect(smoothPoints(a, jumped)[0].x).toBe(0.85)
    expect(smoothPoints(null, b)).toBe(b)
  })
})
