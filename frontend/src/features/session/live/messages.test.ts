import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseServerMessage } from './messages'

/** The BE contract examples (`contracts/realtime/examples-v2`), read as the server sends them. */
const example = (name: string) =>
  readFileSync(new URL(`../../../../../contracts/realtime/examples-v2/${name}`, import.meta.url), 'utf8')

describe('observation (plan 0084, fe-3sec)', () => {
  it('reads the 4.0 contract examples', () => {
    expect(parseServerMessage(example('ws-observation.json'))).toEqual({
      type: 'observation',
      observation: { schema_version: '4.0', valid: true, posture: 'bad', collapse_probability: 0.82, invalid_reason: null },
    })
    expect(parseServerMessage(example('ws-observation-unmeasurable.json'))).toMatchObject({
      observation: { valid: false, posture: null, collapse_probability: 0, invalid_reason: 'unmeasurable' },
    })
  })

  // Transition only: the running server sends 3.0 until it is redeployed. Delete once it sends 4.0 (fe-3sec 8장).
  it('still reads a 3.0 observation, which has the same three fields the app uses', () => {
    const v3 = {
      schema_version: '3.0', sequence: 0, start_ms: 0, end_ms: 500, phase: 'running', valid: true, valid_ms: 500,
      collapse_probability: 0.82, deviation_type: 'forward_slouch', invalid_reason: null, model_version: 'm',
    }
    expect(parseServerMessage(JSON.stringify({ type: 'observation', observation: v3 }))).toMatchObject({
      observation: { valid: true, collapse_probability: 0.82, invalid_reason: null },
    })
  })

  it('drops an observation without a field the app uses', () => {
    const base = { valid: true, collapse_probability: 0.5, invalid_reason: null }
    for (const key of Object.keys(base)) {
      const observation: Record<string, unknown> = { ...base }
      delete observation[key]
      expect(parseServerMessage(JSON.stringify({ type: 'observation', observation }))).toBeNull()
    }
    expect(parseServerMessage(JSON.stringify({ type: 'observation', observation: { ...base, collapse_probability: '0.5' } }))).toBeNull()
    expect(parseServerMessage(JSON.stringify({ type: 'observation', observation: { ...base, invalid_reason: 3 } }))).toBeNull()
  })
})
