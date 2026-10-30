/** Display geometry only: normalized world coordinates are NOT camera image coordinates. */
import { FORECAST_OBSERVATION_MAX_GAP_MS, type ForecastDisplay } from './forecast'

export type ForecastPlane = 'front' | 'side'
export const FORECAST_DISPLAY_POINT_NAMES = [
  '코', '오른눈 바깥', '오른눈 중앙', '오른눈 안쪽', '왼눈 안쪽', '왼눈 중앙', '왼눈 바깥',
  '입 오른쪽', '입 왼쪽', '왼귀', '오른귀', '왼어깨', '오른어깨',
] as const
// The sequence order is LIVE_FORECAST_ORDER, not MediaPipe's original order.
export const FORECAST_DISPLAY_EDGES: readonly (readonly [number, number])[] = [
  [0, 4], [4, 5], [5, 6], [6, 9], [0, 3], [3, 2], [2, 1], [1, 10], [8, 7], [11, 12],
]
export interface ForecastDisplayPoint { x: number; y: number }
export interface ForecastProjection {
  current: ForecastDisplayPoint[]
  predicted: ForecastDisplayPoint[]
  /** Percentage of one normalized shoulder width, mirrored horizontally once. */
  faceDelta: { horizontal: number; vertical: number; towardCamera: number }
  origin: ForecastDisplayPoint
  pixelsPerShoulder: number
}

export function freshForecastDisplay(value: ForecastDisplay | null | undefined, observedAtMs: number): value is ForecastDisplay {
  return !!value && Number.isFinite(observedAtMs) && Number.isFinite(value.inputAtMs) &&
    Number.isFinite(value.targetAtMs) && value.inputAtMs >= 0 &&
    value.inputAtMs <= observedAtMs && value.targetAtMs > observedAtMs &&
    Math.abs(value.targetAtMs - value.inputAtMs - 300) < 1e-5 &&
    observedAtMs - value.inputAtMs <= FORECAST_OBSERVATION_MAX_GAP_MS &&
    [value.inputValues, value.values].every(points => Array.isArray(points) && points.length === 39 && points.every(Number.isFinite))
}

/** Both poses share one transform. The model's displacement is never amplified. */
export function projectForecastDisplay(value: ForecastDisplay, plane: ForecastPlane,
  width = 360, height = 148): ForecastProjection | null {
  if (!freshForecastDisplay(value, value.inputAtMs) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 32 || height <= 32) return null
  const coordinates = (values: number[]) => Array.from({ length: 13 }, (_, point) => ({
    x: -values[point * 3 + (plane === 'front' ? 0 : 2)], y: values[point * 3 + 1],
  }))
  const current = coordinates(value.inputValues), predicted = coordinates(value.values)
  const points = [...current, ...predicted]
  // A stable minimum frame prevents tiny changes from filling the plot.
  const minX = Math.min(-.8, ...points.map(point => point.x)), maxX = Math.max(.8, ...points.map(point => point.x))
  const minY = Math.min(-1.3, ...points.map(point => point.y)), maxY = Math.max(.25, ...points.map(point => point.y))
  const scale = Math.min((width - 32) / (maxX - minX), (height - 24) / (maxY - minY))
  const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2
  const project = (point: ForecastDisplayPoint) => ({ x: width / 2 + (point.x - centerX) * scale, y: height / 2 + (point.y - centerY) * scale })
  const faceDelta = [0, 1, 2].map(axis => Array.from({ length: 9 }, (_, point) =>
    value.values[point * 3 + axis] - value.inputValues[point * 3 + axis]).reduce((sum, delta) => sum + delta, 0) / 9 * 100)
  return { current: current.map(project), predicted: predicted.map(project), origin: project({ x: 0, y: 0 }),
    pixelsPerShoulder: scale, faceDelta: { horizontal: -faceDelta[0], vertical: faceDelta[1], towardCamera: -faceDelta[2] } }
}
