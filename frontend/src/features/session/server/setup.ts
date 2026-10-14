import type { CalibrationSummary } from '../../../../../model/prototype/calibration'
import type { ServerSetup } from './contracts'
import { validSetup } from './validation'

const DEFAULT_DEVICE_KEY = 'default-camera'
const DEFAULT_DEVICE_LABEL = '카메라'

type Input = {
  baselineId: string
  summary: CalibrationSummary | null
  deviceId: string
  deviceLabel?: string
  frameWidth: number
  frameHeight: number
}

/**
 * Session prerequisites for the server DB (schema V2.1): the calibration's mean landmark
 * coordinates; the camera and frame size are sent but not stored. Returns null when the
 * calibration lacks what the server stores.
 */
export function serverSetup(input: Input): ServerSetup | null {
  const { summary } = input
  if (!summary?.landmarks) return null
  const key = /^[!-~]{1,128}$/.test(input.deviceId) ? input.deviceId : DEFAULT_DEVICE_KEY
  const label = input.deviceLabel?.trim().slice(0, 100) || DEFAULT_DEVICE_LABEL
  const round = (n: number) => Number(n.toFixed(5))
  const landmarks = Object.fromEntries(
    Object.entries(summary.landmarks).map(([name, p]) => [name, { x: round(p.x), y: round(p.y) }]),
  ) as ServerSetup['baseline']['landmarks']
  const setup: ServerSetup = {
    device: { key, label },
    frame: { width: input.frameWidth, height: input.frameHeight },
    baseline: {
      baseline_id: input.baselineId,
      calibration_ms: Math.min(999_900, Math.max(100, Math.round(summary.durationMs))),
      sample_count: summary.sampleCount,
      landmarks,
    },
  }
  return validSetup(setup, input.baselineId) ? setup : null
}
