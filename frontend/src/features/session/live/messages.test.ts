import { describe, expect, it } from 'vitest'
import { parseServerMessage } from './messages'

/** The BE 4.0 contract examples (develop `e01ba49` + `61365a4` recovery_ms, plan 0084 27~29). */
const JUDGED = {
  schema_version: '4.0', sequence: 42, valid: true, posture: 'bad', collapse_probability: 0.82, hold_ms: 1500, recovery_ms: 0, invalid_reason: null,
}
const NOT_JUDGED = {
  schema_version: '4.0', sequence: 43, valid: false, posture: null, collapse_probability: null, hold_ms: 0, recovery_ms: 0, invalid_reason: 'unmeasurable',
}
const read = (observation: unknown) => parseServerMessage(JSON.stringify({ type: 'observation', observation }))

describe('observation 4.0 (plan 0084)', () => {
  it('reads the 4.0 contract examples, a not-judgeable one without a score', () => {
    expect(read(JUDGED)).toEqual({ type: 'observation', observation: JUDGED })
    expect(read(NOT_JUDGED)).toEqual({ type: 'observation', observation: NOT_JUDGED })
  })

  // Transition only: the running server sends 3.0 until it is redeployed. Delete once it sends 4.0.
  it('still reads a 3.0 observation, which has the three fields the app needs', () => {
    const v3 = {
      schema_version: '3.0', sequence: 0, start_ms: 0, end_ms: 500, phase: 'running', valid: true, valid_ms: 500,
      collapse_probability: 0.82, deviation_type: 'forward_slouch', invalid_reason: null, model_version: 'm',
    }
    expect(read(v3)).toMatchObject({ observation: { valid: true, collapse_probability: 0.82, invalid_reason: null } })
    expect(read({ ...v3, valid: false, collapse_probability: 0, invalid_reason: 'unmeasurable' })).not.toBeNull()
  })

  it('drops an observation without a field the app needs or with a value it cannot use', () => {
    for (const key of ['valid', 'collapse_probability', 'invalid_reason']) {
      const observation: Record<string, unknown> = { ...JUDGED }
      delete observation[key]
      expect(read(observation)).toBeNull()
    }
    expect(read({ ...JUDGED, collapse_probability: null })).toBeNull()
    expect(read({ ...JUDGED, collapse_probability: '0.5' })).toBeNull()
    expect(read({ ...JUDGED, invalid_reason: 3 })).toBeNull()
    expect(read({ ...JUDGED, sequence: -1 })).toBeNull()
    expect(read({ ...JUDGED, sequence: 1.5 })).toBeNull()
    expect(read({ ...JUDGED, posture: 'maybe' })).toBeNull()
    expect(read({ ...JUDGED, hold_ms: -1 })).toBeNull()
    expect(read({ ...JUDGED, recovery_ms: -1 })).toBeNull()
    expect(read({ ...JUDGED, recovery_ms: '1' })).toBeNull()
  })
})
