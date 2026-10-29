import type { Landmark } from '../../../../model/prototype/pose'
import { ARM_LANDMARK_END, SHOULDER_UP_LANDMARK_COUNT } from './config'

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

/** /dev replay only: original indices 13..22 (elbows, wrists, hands). Never joins the common observation. */
export function armLandmarks(result: PoseResult) {
  const copy = (points: Landmark[]) =>
    points.slice(SHOULDER_UP_LANDMARK_COUNT, ARM_LANDMARK_END).map(point => ({ ...point }))
  return {
    armLandmarks: copy(result.landmarks[0] ?? []),
    armWorldLandmarks: copy(result.worldLandmarks[0] ?? []),
  }
}
