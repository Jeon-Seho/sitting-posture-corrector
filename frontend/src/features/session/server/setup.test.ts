import { describe, expect, it } from 'vitest'
import { serverSetup } from './setup'
import { validSetup } from './validation'
import { SYNTHETIC_LANDMARKS } from './testFixtures'

const BASELINE_ID = '22222222-2222-4222-8222-222222222222'
// Explicitly synthetic calibration means; no frames or per-frame samples.
const input = () => ({
  baselineId: BASELINE_ID,
  summary: {
    durationMs: 5012.4,
    sampleCount: 21,
    spread: { headGap: 0.012, offset: 0.004, tilt: 0.003 },
    landmarks: {
      ...SYNTHETIC_LANDMARKS,
      nose: { x: 0.5012345678, y: 0.4 },
    },
  },
  deviceId: 'synthetic-device',
  deviceLabel: '  Synthetic camera  ',
  frameWidth: 640,
  frameHeight: 480,
})

describe('server session setup (DB schema V2.1 baseline)', () => {
  it('sends the mean landmark coordinates at the stored precision', () => {
    const setup = serverSetup(input())!
    expect(setup).toEqual({
      device: { key: 'synthetic-device', label: 'Synthetic camera' },
      frame: { width: 640, height: 480 },
      baseline: {
        baseline_id: BASELINE_ID,
        calibration_ms: 5012,
        sample_count: 21,
        landmarks: { ...SYNTHETIC_LANDMARKS, nose: { x: 0.50123, y: 0.4 } },
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
      serverSetup({ ...input(), summary: { ...input().summary, landmarks: null } }),
    ).toBeNull()
    expect(serverSetup({ ...input(), frameWidth: 0 })).toBeNull()
  })

  it('rejects coordinates off the frame or a missing landmark', () => {
    const setup = serverSetup(input())!
    const off = structuredClone(setup)
    off.baseline.landmarks.left_ear.x = 1.2
    expect(validSetup(off, BASELINE_ID)).toBe(false)
    const missing = structuredClone(setup) as unknown as {
      baseline: { landmarks: Record<string, unknown> }
    }
    delete missing.baseline.landmarks.mouth_left
    expect(validSetup(missing, BASELINE_ID)).toBe(false)
  })
})
