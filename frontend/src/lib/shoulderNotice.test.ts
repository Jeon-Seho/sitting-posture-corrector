import { describe, expect, it } from 'vitest'
import type { CameraController } from '../hooks/useCamera'
import { cameraSample, SHOULDER_GRACE_NOTICE, SHOULDER_MISSING_NOTICE } from './cameraSample'
import { statusCopy } from '../features/session/liveView'

const baseline = { headGap: 0.9, offset: 0, tilt: 0, quality: 0.95, turn: 0 }
const camera = (shoulders: 'seen' | 'grace' | 'missing') =>
  ({
    state: 'on',
    baseline,
    shoulders,
    error: '',
    current: { current: shoulders === 'missing' ? null : { ...baseline } },
    lastFrame: { current: performance.now() },
  }) as unknown as CameraController

describe('shoulder grace notices while measuring', () => {
  it('keeps judging in grace and says the head is checked for now', () => {
    const s = cameraSample(camera('grace'))
    expect(s.state).toBe('good')
    expect(s.notice).toBe(SHOULDER_GRACE_NOTICE)
    expect(cameraSample(camera('seen')).notice).toBeNull()
  })
  it('stops judging after the grace and asks for the shoulders', () => {
    const s = cameraSample(camera('missing'))
    expect(s.state).toBe('unknown')
    expect(s.notice).toBe(SHOULDER_MISSING_NOTICE)
    const copy = statusCopy({ status: 'unmeasurable', notice: s.notice } as Parameters<typeof statusCopy>[0])
    expect(copy.pill).toBe('어깨가 보이지 않아요')
  })
})
