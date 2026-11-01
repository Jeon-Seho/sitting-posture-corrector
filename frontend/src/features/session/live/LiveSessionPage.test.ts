import { describe, expect, it } from 'vitest'
import type { LiveState } from './LiveSession'
import type { LiveObservation } from './messages'
import { headline, statusTone } from './LiveSessionPage'

/** Synthetic states only: what the measuring screen shows for each server status (fe-3sec 3장 3번). */
const state = (observation: LiveObservation | null, alerting = false) =>
  ({ placeable: true, alerting, observation, sending: 'running' }) as LiveState
const observation = (posture: LiveObservation['posture'], valid = true): LiveObservation => ({
  schema_version: '4.0', valid, posture, collapse_probability: posture === 'bad' ? 0.82 : 0.1, invalid_reason: valid ? null : 'unmeasurable',
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
})
