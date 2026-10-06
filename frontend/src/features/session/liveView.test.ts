import { describe, expect, it } from 'vitest'
import type { LiveState } from '../../lib/engine'
import { fromLocalLive, statusCopy, timelineKind } from './liveView'

// Synthetic live state only; values are not measurements.
const base = (patch: Partial<LiveState> = {}): LiveState =>
  ({
    state: 'good',
    collapse: null,
    notice: null,
    keypoints: {},
    features: { neckForward: 0, shoulderTilt: 0, trunkTilt: 0, lateralBalance: 100 },
    confidence: 1,
    collapseProb: 0.1,
    holdProgress: 0,
    recoverProgress: 0,
    alerting: false,
    nextAlertIn: null,
    totalSeconds: 100,
    pausedSeconds: 0,
    unknownSeconds: 10,
    validSeconds: 90,
    goodSeconds: 72,
    collapseSeconds: 18,
    events: [],
    alertTick: 0,
    ...patch,
  }) as LiveState

describe('screen status mirrors the planned NORMAL/SUSPECT/BAD/RECOVERING machine', () => {
  it('maps the local engine phases', () => {
    expect(fromLocalLive(base(), false).status).toBe('normal')
    expect(fromLocalLive(base({ state: 'collapse', holdProgress: 0.4 }), false).status).toBe('suspect')
    expect(fromLocalLive(base({ state: 'collapse', alerting: true }), false).status).toBe('bad')
    expect(fromLocalLive(base({ state: 'good', alerting: true, recoverProgress: 0.5 }), false).status).toBe(
      'recovering',
    )
    expect(fromLocalLive(base({ state: 'unknown' }), false).status).toBe('unmeasurable')
    expect(fromLocalLive(base({ state: 'collapse', alerting: true }), true).status).toBe('paused')
  })

  it('never shows a score or a good state for unmeasurable or paused time', () => {
    const unknown = fromLocalLive(base({ state: 'unknown', collapseProb: 0 }), false)
    expect(unknown.score).toBeNull()
    expect(timelineKind(unknown.status)).toBe('unknown')
    expect(statusCopy(unknown).tone).toBe('unknown')
    expect(fromLocalLive(base(), true).score).toBeNull()
    expect(timelineKind('analysisPaused')).toBe('unknown')
  })

  it('keeps the keep rate undefined when nothing valid was measured', () => {
    expect(fromLocalLive(base(), false).keepRate).toBeCloseTo(0.8)
    expect(fromLocalLive(base({ validSeconds: 0, goodSeconds: 0 }), false).keepRate).toBeNull()
  })
})
