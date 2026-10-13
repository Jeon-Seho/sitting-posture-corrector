import { describe, expect, it } from 'vitest'
import type { Landmark } from '../../../../model/prototype/pose'
import { recommendRate, stillNoise } from './trackingRate'
import { inferenceInterval } from '../../lib/skeleton'

function frame(shake: number): Landmark[] {
  const points: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.1 }))
  points[0] = { x: 0.5 + shake, y: 0.35, z: 0, visibility: 0.95 }
  points[11] = { x: 0.38 - shake, y: 0.6, z: 0, visibility: 0.95 }
  points[12] = { x: 0.62 + shake, y: 0.6, z: 0, visibility: 0.95 }
  return points
}

describe('tracking rate check', () => {
  it('measures shake of a still person in shoulder widths', () => {
    const steady = Array.from({ length: 20 }, () => frame(0))
    const shaky = Array.from({ length: 20 }, (_, i) => frame(i % 2 ? 0.006 : -0.006))
    expect(stillNoise(steady, 640, 480)).toBeCloseTo(0, 9)
    expect(stillNoise(shaky, 640, 480)!).toBeGreaterThan(0.02)
    expect(stillNoise(shaky.slice(0, 5), 640, 480)).toBeNull()
  })

  it('suggests the steadiest rate and prefers the faster one when nearly equal', () => {
    const r = (fps: number, noise: number | null) => ({ fps, measuredFps: fps, inferenceMs: 10, noise })
    expect(recommendRate([r(30, 0.03), r(20, 0.02), r(15, 0.021), r(10, 0.04)])).toBe(20)
    expect(recommendRate([r(30, 0.02), r(20, 0.021)])).toBe(30)
    expect(recommendRate([r(30, null)])).toBeNull()
  })

  it('caps the tracking interval without going faster than the device', () => {
    expect(inferenceInterval('GPU', 5, null)).toBeCloseTo(1000 / 30)
    expect(inferenceInterval('GPU', 5, 15)).toBeCloseTo(1000 / 15)
    expect(inferenceInterval('CPU', 5, 30)).toBe(50)
  })
})
