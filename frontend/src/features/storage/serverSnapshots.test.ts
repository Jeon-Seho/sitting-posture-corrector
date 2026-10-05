import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES } from '../../data/posture'
import { projectMachine } from '../session/server/projection'
import {
  BASELINE_ID,
  SESSION_ID,
  checkpoint,
  frameRequest,
  view,
} from '../session/server/testFixtures'
import type { SessionView } from '../session/server/contracts'
import { validDraft, validRecord } from './validation'
import { serverRecordEvents } from './serverSnapshots'
import type { Draft, RecordItem } from './types'

/** Hand-written synthetic decisions, never captured camera or participant data. */
function activeView(): SessionView {
  const initial = view()
  return {
    ...initial,
    last_sequence: 2,
    summary: {
      ...initial.summary,
      total_ms: 3000,
      valid_ms: 3000,
      deviation_ms: 3000,
      collapse_count: 1,
      alert_count: 1,
      keep_rate: 0,
      events_per_hour: 1200,
    },
    events: [
      {
        schema_version: '1.0',
        session_id: SESSION_ID,
        event_id: 1,
        kind: 'collapse_confirmed',
        timestamp_ms: 3000,
        onset_ms: 0,
        onset_valid_ms: 0,
        deviation_type: 'left_lean',
        reason: null,
      },
    ],
  }
}

function endedView(): SessionView {
  const initial = activeView()
  return {
    ...initial,
    ended: true,
    last_sequence: 4,
    summary: {
      ...initial.summary,
      total_ms: 6000,
      valid_ms: 5000,
      deviation_ms: 5000,
      missing_ms: 1000,
      events_per_hour: 720,
    },
    events: [
      ...initial.events,
      {
        ...initial.events[0],
        event_id: 2,
        kind: 'interrupted',
        timestamp_ms: 5000,
        reason: 'missing',
      },
      {
        ...initial.events[0],
        event_id: 3,
        kind: 'session_ended',
        timestamp_ms: 6000,
        onset_ms: 6000,
        onset_valid_ms: 5000,
        deviation_type: 'none',
        reason: 'ended',
      },
    ],
  }
}

function record(snapshot: SessionView | null, confirmed: boolean): RecordItem {
  return {
    id: SESSION_ID,
    startedAt: new Date(0).toISOString(),
    endedAt: new Date(6000).toISOString(),
    mode: 'camera',
    rules: DEFAULT_RULES,
    total: (snapshot?.summary.total_ms ?? 0) / 1000,
    valid: (snapshot?.summary.valid_ms ?? 0) / 1000,
    good: (snapshot?.summary.normal_ms ?? 0) / 1000,
    events: serverRecordEvents(snapshot, confirmed),
    server: {
      baselineId: BASELINE_ID,
      modelVersion: 'reference-feature-rule-v1',
      confirmed,
      view: snapshot,
    },
  }
}

describe('acknowledged server storage (synthetic only)', () => {
  const draft = (): Draft => ({
    id: SESSION_ID,
    startedAt: new Date(0).toISOString(),
    mode: 'camera',
    rules: DEFAULT_RULES,
    machine: projectMachine(view()),
    server: checkpoint(),
  })

  it('keeps pending request bytes and requires the display snapshot to agree with the server', () => {
    const body = frameRequest()
    const saved = {
      ...draft(),
      server: checkpoint({
        elapsedMs: 100,
        nextSequence: 1,
        pending: { kind: 'features' as const, body },
      }),
    }
    expect(validDraft(saved)).toBe(true)
    expect(saved.server.pending?.body).toEqual(body)
    expect(
      validDraft({
        ...saved,
        machine: { ...saved.machine, total: 1, good: 1 },
      }),
    ).toBe(false)
    expect(validDraft({ ...saved, mode: 'demo' })).toBe(false)
  })

  it('rejects unknown raw data and a pending request from another baseline', () => {
    const saved = draft()
    expect(
      validDraft({
        ...saved,
        server: { ...saved.server, video: 'forbidden synthetic field' },
      }),
    ).toBe(false)
    expect(
      validDraft({
        ...saved,
        server: checkpoint({
          elapsedMs: 100,
          nextSequence: 1,
          pending: {
            kind: 'features',
            body: { ...frameRequest(), baseline_id: SESSION_ID },
          },
        }),
      }),
    ).toBe(false)
  })

  it('accepts canonical UUIDs independently of version and variant', () => {
    const canonical = '11111111-1111-1111-1111-111111111111'
    expect(validDraft({ ...draft(), server: checkpoint({ baselineId: canonical }) })).toBe(true)
  })

  it('retains left/right and interruption reasons in the authoritative final snapshot', () => {
    const saved = record(endedView(), true)
    expect(validRecord(saved)).toBe(true)
    expect(saved.server?.view?.events[0].deviation_type).toBe('left_lean')
    expect(saved.server?.view?.events[1].reason).toBe('missing')
    expect(saved.server?.view?.summary.missing_ms).toBe(1000)
    expect(validRecord({ ...saved, total: 7 })).toBe(false)
    expect(validRecord({ ...saved, events: [] })).toBe(false)
  })

  it('archives an open row locally without creating a remote ended decision', () => {
    const snapshot = activeView()
    const saved = record(snapshot, false)
    expect(validRecord(saved)).toBe(true)
    expect(saved.events[0]).toMatchObject({
      endAt: 3,
      endReason: 'unknown',
      endedBySession: false,
    })
    expect(saved.server?.view?.ended).toBe(false)
    expect(saved.server?.view?.events).toHaveLength(1)
    expect(snapshot.events).toHaveLength(1)
    expect(validRecord({ ...saved, server: { ...saved.server!, confirmed: true } })).toBe(false)
  })

  it('allows a zero-time unconfirmed archive before creation and rejects an invented completion', () => {
    expect(validRecord(record(null, false))).toBe(true)
    expect(validRecord(record(null, true))).toBe(false)
  })
})
