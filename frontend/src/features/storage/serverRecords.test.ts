import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_RULES } from '../../data/posture'
import { BASELINE_ID, SESSION_ID, view } from '../session/server/testFixtures'
import { pendingRecords, reconcileResults, rememberResult } from './serverRecords'
import type { RecordItem } from './types'

function record(total = 2, ended = false): RecordItem {
  const serverView = view({
    ended,
    last_sequence: 1,
    summary: { ...view().summary, total_ms: total * 1000, unknown_ms: total * 1000 },
    events: ended ? [{ schema_version: '1.0', session_id: SESSION_ID, event_id: 1, kind: 'session_ended', timestamp_ms: total * 1000, onset_ms: total * 1000, onset_valid_ms: 0, deviation_type: 'none', reason: 'ended' }] : [],
  })
  return { id: SESSION_ID, startedAt: '2026-10-29T00:00:00Z', endedAt: `2026-10-29T00:00:0${total}Z`, mode: 'camera', total, valid: 0, good: 0, events: [], rules: DEFAULT_RULES,
    server: { baselineId: BASELINE_ID, modelVersion: 'synthetic', confirmed: ended, view: serverView } }
}
describe('durable result handoff', () => {
  let data: Map<string, string>
  beforeEach(() => {
    data = new Map()
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v), removeItem: (k: string) => data.delete(k) })
  })
  afterEach(() => vi.unstubAllGlobals())
  it('survives a new read, isolates accounts, and removes only after matching server completion', () => {
    rememberResult('a', record())
    expect(pendingRecords('a')).toHaveLength(1)
    expect(pendingRecords('b')).toEqual([])
    expect(reconcileResults('a', [record()])).toHaveLength(1)
    expect(reconcileResults('a', [record(2, true)])).toEqual([])
    expect(data.size).toBe(0)
  })
  it('keeps newer checkpoints when the server or a late observation is older', () => {
    rememberResult('a', record(4))
    rememberResult('a', record(2))
    expect(pendingRecords('a')[0].total).toBe(4)
    expect(reconcileResults('a', [record(2, true)])).toHaveLength(1)
    expect(reconcileResults('a', [{ ...record(4, true), startedAt: '2026-10-28T00:00:00Z' }])).toHaveLength(1)
  })
  it('acknowledges persisted connection-loss endings without claiming user confirmation', () => {
    rememberResult('a', record())
    const remote = record(3, true)
    remote.server!.confirmed = false
    expect(reconcileResults('a', [remote])).toEqual([])
  })
  it('preserves damaged data and does not overwrite it', () => {
    data.set('posegood.account.v3.a.pending-results', '{broken')
    expect(() => rememberResult('a', record())).toThrow()
    expect(data.get('posegood.account.v3.a.pending-results')).toBe('{broken')
  })
})
