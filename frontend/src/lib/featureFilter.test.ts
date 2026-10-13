import { describe, expect, it } from 'vitest'
import { createFeatureFilter } from './skeleton'

describe('judging value smoothing (local mode)', () => {
  it('steadies tracker noise in the judged features but follows a real change', () => {
    const f = createFeatureFilter<{ headGap: number; offset: number; tilt: number; quality: number }>()
    let out = { headGap: 0, offset: 0, tilt: 0, quality: 0 }
    for (let i = 0; i < 60; i++)
      out = f.next({ headGap: 0.9 + (i % 2 ? 0.03 : -0.03), offset: 0, tilt: 0, quality: 0.9 }, 33)
    expect(Math.abs(out.headGap - 0.9)).toBeLessThan(0.012)
    expect(out.quality).toBe(0.9) // quality is passed through unchanged
    for (let i = 0; i < 20; i++) out = f.next({ headGap: 0.6, offset: 0, tilt: 0, quality: 0.9 }, 33)
    expect(out.headGap).toBeLessThan(0.63)
  })
})
