import { describe, expect, it } from 'vitest'
import { serverSetup } from './setup'
import { validSetup } from './validation'

const BASELINE_ID = '22222222-2222-4222-8222-222222222222'
// Explicitly synthetic calibration aggregates; no landmarks or frames.
const input = () => ({
  baselineId: BASELINE_ID,
  baseline: { headGap: 0.4123456789, offset: -0.02, tilt: 0.01, quality: 0.9 },
  summary: {
    durationMs: 5012.4,
    sampleCount: 21,
    spread: { headGap: 0.012, offset: 0.004, tilt: 0.003 },
    placement: { x: 0.51, y: 0.62, area: 0.048 },
  },
  deviceId: 'synthetic-device',
  deviceLabel: '  Synthetic camera  ',
  frameWidth: 640,
  frameHeight: 480,
})

describe('server session setup (DB schema V1.1 prerequisites)', () => {
  it('sends calibration aggregates, frame size and the camera identity only', () => {
    const setup = serverSetup(input())!
    expect(setup).toEqual({
      device: { key: 'synthetic-device', label: 'Synthetic camera' },
      frame: { width: 640, height: 480 },
      baseline: {
        baseline_id: BASELINE_ID,
        calibration_ms: 5012,
        sample_count: 21,
        target_center_x: 0.51,
        target_center_y: 0.62,
        target_area_ratio: 0.048,
        head_gap: { mean: 0.412346, std: 0.012 },
        lateral_offset: { mean: -0.02, std: 0.004 },
        shoulder_tilt: { mean: 0.01, std: 0.003 },
      },
    })
    expect(validSetup(setup, BASELINE_ID)).toBe(true)
    expect(validSetup(setup, '33333333-3333-4333-8333-333333333333')).toBe(false)
  })

  it('falls back for a missing camera identity and refuses incomplete calibration', () => {
    const fallback = serverSetup({ ...input(), deviceId: '', deviceLabel: undefined })!
    expect(fallback.device).toEqual({ key: 'default-camera', label: '카메라' })
    expect(serverSetup({ ...input(), summary: null })).toBeNull()
    expect(
      serverSetup({ ...input(), summary: { ...input().summary, placement: null } }),
    ).toBeNull()
    expect(serverSetup({ ...input(), frameWidth: 0 })).toBeNull()
  })
})
