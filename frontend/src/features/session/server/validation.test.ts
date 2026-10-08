import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES } from '../../../data/posture'
import { validMachine } from '../../storage/validation'
import type { DecisionEvent } from './contracts'
import { projectMachine } from './projection'
import {
  validFeatureResponse,
  validFrameRequest,
  validServerCheckpoint,
  validSessionView,
  validUuid,
} from './validation'
import {
  SESSION_ID,
  checkpoint,
  frameRequest,
  observation,
  syntheticClient,
  view,
} from './testFixtures'

function episodeView() {
  const s = view()
  s.summary = {
    ...s.summary,
    total_ms: 10500,
    valid_ms: 9500,
    normal_ms: 2000,
    deviation_ms: 7500,
    rest_ms: 1000,
    collapse_count: 2,
    alert_count: 3,
    interval_count: 1,
    keep_rate: 2000 / 9500,
    events_per_hour: (2 * 3_600_000) / 9500,
    mean_interval_ms: 6000,
    mean_recovery_ms: 3000,
  }
  s.last_sequence = 100
  s.ended = true
  const decision = (
    event_id: number,
    kind: DecisionEvent['kind'],
    timestamp_ms: number,
    onset_ms = 0,
    onset_valid_ms = onset_ms,
    reason: DecisionEvent['reason'] = null,
  ): DecisionEvent => ({
    schema_version: '1.0',
    session_id: SESSION_ID,
    event_id,
    kind,
    timestamp_ms,
    onset_ms,
    onset_valid_ms,
    deviation_type: kind === 'session_ended' ? 'none' : 'unspecified',
    reason,
  })
  s.events = [
    decision(1, 'collapse_confirmed', 3000),
    decision(2, 'reminder', 4000),
    decision(3, 'recovery_confirmed', 6000),
    decision(4, 'collapse_confirmed', 9000, 6000),
    decision(5, 'interrupted', 9500, 6000, 6000, 'rest'),
    decision(6, 'session_ended', 10500, 10500, 9500, 'ended'),
  ]
  return s
}

describe('strict server contracts and read-only compatibility projection', () => {
  it('projects decisions into episodes without counting reminder/recovery as new collapses', () => {
    const source = episodeView()
    const original = structuredClone(source)
    expect(validSessionView(source, SESSION_ID, DEFAULT_RULES)).toBe(true)
    const machine = projectMachine(source)
    expect(validMachine(machine)).toBe(true)
    expect(machine.events).toHaveLength(2)
    expect(machine.events[0]).toMatchObject({
      id: 1,
      type: 'referenceChange',
      startAt: 0,
      confirmedAt: 3,
      alerts: 2,
      recovered: true,
      recoverySec: 3,
      endAt: 6,
    })
    expect(machine.events[1]).toMatchObject({
      id: 4,
      validStartAt: 6,
      endReason: 'paused',
      recovered: false,
      alerts: 1,
    })
    expect(machine.alertTick).toBe(3)
    expect(source).toEqual(original)
  })

  it('accepts an open authoritative episode without fabricating hold/recovery progress', () => {
    const s = episodeView()
    s.ended = false
    s.events = s.events.slice(0, 4)
    s.summary.total_ms = 9500
    s.summary.rest_ms = 0
    expect(validSessionView(s)).toBe(true)
    const m = projectMachine(s)
    expect(validMachine(m)).toBe(true)
    expect(m.active?.id).toBe(4)
    expect(m.hold).toBe(0)
    expect(m.recover).toBe(0)
  })

  it('rejects inconsistent summaries, event identity, overwritten ordering and impossible episode endings', () => {
    const badTotal = episodeView()
    badTotal.summary.total_ms++
    const badIdentity = episodeView()
    badIdentity.events[0].session_id = '33333333-3333-4333-8333-333333333333'
    const badOrder = episodeView()
    badOrder.events[1].event_id = 1
    const badEpisode = episodeView()
    badEpisode.events[2].onset_ms = 10
    const badCount = episodeView()
    badCount.summary.alert_count = 5
    for (const bad of [badTotal, badIdentity, badOrder, badEpisode, badCount])
      expect(validSessionView(bad)).toBe(false)
  })

  it('accepts schema-compatible good quality with absent features while inference reports invalid', () => {
    const request = { ...frameRequest(), features: null }
    expect(validFrameRequest(request)).toBe(true)
    const reply = syntheticClient().respond({ kind: 'features', body: request })
    expect(
      validFeatureResponse(
        { schema_version: '1.0', session: reply.view, observation: reply.observation },
        request,
        SESSION_ID,
        DEFAULT_RULES,
      ),
    ).toBe(true)
  })

  it('rejects malformed or mismatched inference even with a valid session snapshot', () => {
    const request = frameRequest()
    const reply = syntheticClient().respond({ kind: 'features', body: request })
    const response = {
      schema_version: '1.0',
      session: reply.view,
      observation: observation(request),
    }
    expect(validFeatureResponse(response, request, SESSION_ID, DEFAULT_RULES)).toBe(true)
    expect(
      validFeatureResponse(
        { ...response, observation: { ...response.observation, sequence: 99 } },
        request,
        SESSION_ID,
        DEFAULT_RULES,
      ),
    ).toBe(false)
    expect(
      validFeatureResponse(
        {
          ...response,
          observation: { ...response.observation, valid: false, collapse_probability: 0.8 },
        },
        request,
        SESSION_ID,
        DEFAULT_RULES,
      ),
    ).toBe(false)
    expect(
      validFeatureResponse(
        { ...response, observation: { ...response.observation, model_version: 'different-model' } },
        request,
        SESSION_ID,
        DEFAULT_RULES,
      ),
    ).toBe(false)
  })

  it('rejects array/number enum values without coercing them into contract strings', () => {
    const request = frameRequest()
    const reply = syntheticClient().respond({ kind: 'features', body: request })
    const response = {
      schema_version: '1.0',
      session: reply.view,
      observation: observation(request),
    }
    for (const bad of [['none'], 0])
      expect(
        validFeatureResponse(
          { ...response, observation: { ...response.observation, deviation_type: bad } },
          request,
          SESSION_ID,
          DEFAULT_RULES,
        ),
      ).toBe(false)
    for (const field of ['kind', 'deviation_type', 'reason']) {
      const source = episodeView()
      const original = source.events[0][field as keyof DecisionEvent]
      for (const bad of [[original], 1]) {
        const altered = structuredClone(source)
        ;(altered.events[0] as unknown as Record<string, unknown>)[field] = bad
        expect(validSessionView(altered)).toBe(false)
      }
    }
  })

  it('whitelists checkpoint fields, rejects raw-coordinate additions and preserves baseline identity', () => {
    expect(validServerCheckpoint(checkpoint(), SESSION_ID, DEFAULT_RULES)).toBe(true)
    expect(validServerCheckpoint({ ...checkpoint(), landmarks: [] })).toBe(false)
    expect(
      validServerCheckpoint({
        ...checkpoint(),
        baseline: { ...checkpoint().baseline, quality: 0.1 },
      }),
    ).toBe(false)
    expect(
      validServerCheckpoint({
        ...checkpoint(),
        pending: { kind: 'features', body: { ...frameRequest(), baseline_id: SESSION_ID } },
        nextSequence: 1,
        elapsedMs: 100,
      }),
    ).toBe(false)
    expect(
      validServerCheckpoint(
        {
          ...checkpoint(),
          view: { ...view(), session_id: '33333333-3333-4333-8333-333333333333' },
        },
        SESSION_ID,
      ),
    ).toBe(false)
    expect(
      validServerCheckpoint(checkpoint(), SESSION_ID, { ...DEFAULT_RULES, holdSeconds: 7 }),
    ).toBe(false)
  })

  it('rejects nonfinite/unknown frame data and follows canonical UUID syntax', () => {
    expect(
      validFrameRequest({
        ...frameRequest(),
        features: { ...frameRequest().features, head_gap_delta: Infinity },
      }),
    ).toBe(false)
    expect(validFrameRequest({ ...frameRequest(), landmarks: [] })).toBe(false)
    expect(validFrameRequest({ ...frameRequest(), end_ms: 1501 })).toBe(false)
    expect(validUuid('00000000-0000-0000-0000-000000000000')).toBe(true)
    expect(validUuid('invalid')).toBe(false)
  })
})
