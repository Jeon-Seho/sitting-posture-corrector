import type { Landmark } from '../../../../model/prototype/pose'
import { SHOULDER_UP_LANDMARK_COUNT } from './config'

export type PoseResult = { landmarks: Landmark[][]; worldLandmarks: Landmark[][] }

/** Preserve original indices and poor-quality raw values; never smooth or impute. */
export function shoulderUpLandmarks(result: PoseResult) {
  const copy = (points: Landmark[]) =>
    points.slice(0, SHOULDER_UP_LANDMARK_COUNT).map(point => ({ ...point }))
  return {
    landmarks: copy(result.landmarks[0] ?? []),
    worldLandmarks: copy(result.worldLandmarks[0] ?? []),
  }
}
