import type { CalibrationSummary } from '../../../../../model/prototype/calibration'
import type { Features } from '../../../../../model/prototype/pose'
import type { ServerSetup } from './contracts'
import { validSetup } from './validation'

const DEFAULT_DEVICE_KEY = 'default-camera'
const DEFAULT_DEVICE_LABEL = '카메라'

type Input = {
  baselineId: string
  baseline: Features
  summary: CalibrationSummary | null
  deviceId: string
  deviceLabel?: string
  frameWidth: number
  frameHeight: number
}

/**
 * Session prerequisites for the server DB (schema V1.1): the camera, the frame size and the
 * calibration aggregates. Returns null when the calibration lacks what the server stores.
 */
export function serverSetup(input: Input): ServerSetup | null {
  const { summary, baseline } = input
  if (!summary?.placement) return null
  const key = /^[!-~]{1,128}$/.test(input.deviceId) ? input.deviceId : DEFAULT_DEVICE_KEY
  const label = input.deviceLabel?.trim().slice(0, 100) || DEFAULT_DEVICE_LABEL
  const round = (n: number) => Number(n.toFixed(6))
  const setup: ServerSetup = {
    device: { key, label },
    frame: { width: input.frameWidth, height: input.frameHeight },
    baseline: {
      baseline_id: input.baselineId,
      calibration_ms: Math.min(999_900, Math.max(100, Math.round(summary.durationMs))),
      sample_count: summary.sampleCount,
      target_center_x: round(summary.placement.x),
      target_center_y: round(summary.placement.y),
      target_area_ratio: round(summary.placement.area),
      head_gap: { mean: round(baseline.headGap), std: round(summary.spread.headGap) },
      lateral_offset: { mean: round(baseline.offset), std: round(summary.spread.offset) },
      shoulder_tilt: { mean: round(baseline.tilt), std: round(summary.spread.tilt) },
    },
  }
  return validSetup(setup, input.baselineId) ? setup : null
}
