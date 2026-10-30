import { describe, expect, it } from 'vitest'
import type { ForecastDisplay } from '../../../../model/prototype/forecast'
import { FORECAST_DISPLAY_EDGES, FORECAST_DISPLAY_POINT_NAMES, freshForecastDisplay,
  projectForecastDisplay } from '../../../../model/prototype/forecastDisplay'

const explicitSynthetic = (): ForecastDisplay => {
  const inputValues = Array.from({ length: 13 }, (_, index) => [index / 20 - .3, index < 11 ? -.7 : 0, -.1]).flat()
  return { predictor: 'lstm', modelId: 'explicit-synthetic-display', inputAtMs: 3000, targetAtMs: 3300,
    inputValues, values: inputValues.map((value, index) => value + (index % 3 === 0 ? .2 : index % 3 === 2 ? -.3 : .1)) }
}
describe('actual forecast display in a normalized model coordinate plane', () => {
  it('represents all 13 semantically ordered points and does not use MediaPipe indices for eye edges', () => {
    const plot = projectForecastDisplay(explicitSynthetic(), 'front')!
    expect(plot.current).toHaveLength(13); expect(plot.predicted).toHaveLength(13)
    expect(FORECAST_DISPLAY_POINT_NAMES).toHaveLength(13)
    expect(FORECAST_DISPLAY_EDGES).toContainEqual([0, 4])
    expect(FORECAST_DISPLAY_EDGES).toContainEqual([6, 9])
    expect(FORECAST_DISPLAY_EDGES).toContainEqual([11, 12])
  })
  it('uses the same scale for both poses, mirrors front x once and preserves actual displacement', () => {
    const sample = explicitSynthetic(), before = structuredClone(sample)
    const plot = projectForecastDisplay(sample, 'front')!
    expect(plot.predicted[0].x - plot.current[0].x).toBeCloseTo(-.2 * plot.pixelsPerShoulder)
    expect(plot.predicted[0].y - plot.current[0].y).toBeCloseTo(.1 * plot.pixelsPerShoulder)
    expect(plot.faceDelta.horizontal).toBeCloseTo(-20)
    expect(plot.faceDelta.vertical).toBeCloseTo(10)
    expect(plot.faceDelta.towardCamera).toBeCloseTo(30)
    expect(sample).toEqual(before)
    const side = projectForecastDisplay(sample, 'side')!
    expect(side.predicted[0].x - side.current[0].x).toBeCloseTo(.3 * side.pixelsPerShoulder)
  })
  it('rejects stale targets, future inputs and invalid or incomplete coordinate outputs', () => {
    const sample = explicitSynthetic()
    expect(freshForecastDisplay(sample, 3200)).toBe(true)
    expect(freshForecastDisplay(sample, 3251)).toBe(false)
    expect(freshForecastDisplay(sample, 3300)).toBe(false)
    expect(freshForecastDisplay(sample, 2999)).toBe(false)
    expect(freshForecastDisplay({ ...sample, targetAtMs: 3500 }, 3100)).toBe(false)
    expect(projectForecastDisplay({ ...sample, values: Array(39).fill(NaN) }, 'front')).toBeNull()
    expect(projectForecastDisplay({ ...sample, inputValues: sample.inputValues.slice(0, 36) }, 'front')).toBeNull()
  })
})
