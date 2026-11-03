import { describe, expect, it } from 'vitest'
import type { LiveState } from './LiveSession'
import type { LiveObservation } from './messages'
import { awaitingFirstResult, headline, holdProgress, nudgeKind, nudgeText, recoveryProgress, ringColor, statusTone } from './LiveSessionPage'

/** Synthetic states only: what the measuring screen shows for each server status (observation 4.0). */
const state = (observation: LiveObservation | null, alerting = false) =>
  ({ placeable: true, alerting, observation, sending: 'running' }) as LiveState
const observation = (posture: LiveObservation['posture'], valid = true, hold_ms = 0, recovery_ms = 0): LiveObservation => ({
  schema_version: '4.0', sequence: 0, valid, posture, collapse_probability: valid ? (posture === 'bad' ? 0.82 : 0.1) : null,
  hold_ms, recovery_ms, invalid_reason: valid ? null : 'unmeasurable',
})

describe('measuring screen status (synthetic only)', () => {
  it('goes good → caution (server posture bad, not yet confirmed) → confirmed collapse', () => {
    const good = state(observation('good'))
    const bad = state(observation('bad'))
    const confirmed = state(observation('bad'), true)
    expect([headline(good, 'running'), statusTone(good)]).toEqual(['바른 자세예요', 'good'])
    expect([headline(bad, 'running'), statusTone(bad)]).toEqual(['자세가 흐트러지고 있어요', 'caution'])
    expect([headline(confirmed, 'running'), statusTone(confirmed)]).toEqual(['자세가 흐트러졌어요', 'collapse'])
  })

  it('shows no caution without posture (3.0 server) or when nothing can be judged', () => {
    const v3 = state({ valid: true, collapse_probability: 0.82, invalid_reason: null })
    expect([headline(v3, 'running'), statusTone(v3)]).toEqual(['바른 자세예요', 'good'])
    const invalid = state(observation(null, false))
    expect(headline(invalid, 'running')).toBe('자세를 확인할 수 없어요')
    expect(statusTone(null)).toBe('unknown')
  })

  it('asks for an upright pose until the first server result, not 「cannot judge」', () => {
    const waiting = state(null)
    expect([headline(waiting, 'running'), awaitingFirstResult(waiting)]).toEqual(['자세를 똑바로 해주세요', true])
    const outOfView = { ...waiting, placeable: false } as LiveState
    expect([headline(outOfView, 'running'), awaitingFirstResult(outOfView)]).toEqual(['자세를 확인할 수 없어요', false])
    expect(awaitingFirstResult(state(observation('good')))).toBe(false)
  })

  it('puts caution in the same box as 「cannot judge」 and the confirmed alert', () => {
    expect(nudgeKind(state(observation('good')), true)).toBeNull()
    expect(nudgeKind(state(observation('bad')), true)).toBe('caution')
    expect(nudgeKind(state(observation('bad'), true), true)).toBe('alert')
    expect(nudgeKind(state(observation(null, false)), false)).toBe('unknown')
    expect(nudgeKind(state(null), false)).toBeNull()
  })

  it('colours the score ring by the score it draws: never green when bad, never red when recovering', () => {
    expect(ringColor(state(observation('good')))).toBeUndefined()
    expect(ringColor(state(observation('bad')))).toBe('var(--warn-fill)')
    expect(ringColor(state(observation('bad'), true))).toBe('var(--alert)')
    expect(ringColor(state(observation('good'), true))).toBeUndefined()
    expect(ringColor(null)).toBeUndefined()
  })

  it('fills the caution gauge with the server bad time, not an app timer (ADR 0029)', () => {
    expect(holdProgress(state(observation('bad', true, 0)), 3)).toBe(0)
    expect(holdProgress(state(observation('bad', true, 1500)), 3)).toBe(0.5)
    expect(holdProgress(state(observation('bad', true, 4500)), 3)).toBe(1)
    expect(holdProgress(state(observation(null, false)), 3)).toBe(0)
    const v3 = { ...observation('bad'), hold_ms: undefined }
    expect(holdProgress(state(v3), 3)).toBeNull()
    expect(holdProgress(null, 3)).toBeNull()
  })

  it('shows the recovery box and fills it with the server good time while the alert is open', () => {
    expect(nudgeKind(state(observation('good'), true), true)).toBe('recovering')
    expect(nudgeKind(state(observation('bad'), true), true)).toBe('alert')
    expect(nudgeText('recovering', null, { holdSeconds: 3, recoverSeconds: 3 })).toEqual({
      title: '좋아요, 그대로 있어 주세요', desc: '바르게 앉으면 3초 뒤에 알림이 사라져요.',
    })
    expect(recoveryProgress(state(observation('good', true, 0, 1500), true), 3)).toBe(0.5)
    expect(recoveryProgress(state(observation('good', true, 0, 0), true), 3)).toBe(0)
    expect(recoveryProgress(state({ ...observation('good'), recovery_ms: undefined }), 3)).toBeNull()
  })
})
