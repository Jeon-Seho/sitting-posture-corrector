/** Explicit synthetic fixtures: these contain no captured landmarks or participant information. */
import { vi } from 'vitest'
import { DEFAULT_RULES } from '../../../data/posture'
import type { Observation } from '../../../hooks/useCamera'
import type { ServerReply, SessionClient } from './client'
import {
  policyFor,
  type FrameRequest,
  type ServerCheckpoint,
  type ServerObservation,
  type ServerPendingRequest,
  type ServerSessionDescriptor,
  type SessionView,
} from './contracts'

export const SESSION_ID = '11111111-1111-4111-8111-111111111111'
export const BASELINE_ID = '22222222-2222-4222-8222-222222222222'
export const BASELINE = { headGap: 0.7, offset: 0, tilt: 0, quality: 0.9 }
export const descriptor = (): ServerSessionDescriptor => ({
  id: SESSION_ID,
  startedAt: new Date(0).toISOString(),
  rules: { ...DEFAULT_RULES },
  server: {
    baselineId: BASELINE_ID,
    baseline: { ...BASELINE },
    deviceId: 'synthetic-device',
    frameWidth: 640,
    frameHeight: 480,
  },
})

export function view(overrides: Partial<SessionView> = {}): SessionView {
  return {
    schema_version: '1.0',
    session_id: SESSION_ID,
    policy: policyFor(DEFAULT_RULES),
    timer_policy: 'legacy-interrupt-v1',
    ended: false,
    last_sequence: -1,
    summary: {
      total_ms: 0,
      valid_ms: 0,
      normal_ms: 0,
      deviation_ms: 0,
      rest_ms: 0,
      away_ms: 0,
      unknown_ms: 0,
      missing_ms: 0,
      collapse_count: 0,
      alert_count: 0,
      interval_count: 0,
      keep_rate: null,
      events_per_hour: null,
      mean_interval_ms: null,
      mean_recovery_ms: null,
    },
    events: [],
    ...overrides,
  }
}

export function frameRequest(sequence = 0, start = 0, end = 100): FrameRequest {
  return {
    schema_version: '2.0',
    feature_version: 'shoulder-relative-deltas-v1',
    baseline_id: BASELINE_ID,
    sequence,
    start_ms: start,
    end_ms: end,
    phase: 'running',
    measurement_quality: 'good',
    features: {
      head_gap_delta: 0,
      lateral_offset_delta: 0,
      shoulder_tilt_delta: 0,
      current_quality: 0.9,
      baseline_quality: 0.9,
    },
  }
}

export function observation(request: FrameRequest): ServerObservation {
  return {
    schema_version: '2.0',
    sequence: request.sequence,
    start_ms: request.start_ms,
    end_ms: request.end_ms,
    phase: request.phase,
    valid:
      request.phase === 'running' &&
      request.measurement_quality === 'good' &&
      request.features !== null,
    collapse_probability: 0,
    deviation_type: 'none',
    model_version: 'reference-feature-rule-v1',
  }
}

export function cameraFrame(
  timeMs: number,
  features: Observation['features'] = BASELINE,
): Observation {
  return {
    timeMs,
    videoTimeMs: timeMs,
    features,
    landmarks: [],
    worldLandmarks: [],
    inferenceMs: 5,
    delegate: 'CPU',
    width: 640,
    height: 480,
  }
}

export function checkpoint(overrides: Partial<ServerCheckpoint> = {}): ServerCheckpoint {
  return {
    schemaVersion: '1.0',
    baselineId: BASELINE_ID,
    baseline: { ...BASELINE },
    deviceId: 'synthetic-device',
    frameWidth: 640,
    frameHeight: 480,
    savedAt: new Date(0).toISOString(),
    elapsedMs: 0,
    view: view(),
    nextSequence: 0,
    lastNotificationId: 0,
    modelVersion: null,
    pending: null,
    ...overrides,
  }
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

export async function flush() {
  for (let i = 0; i < 16; i++) await Promise.resolve()
}

/** A transport double accumulates durations only. Production CEP tests own temporal decisions. */
export function syntheticClient(initial = view()) {
  let current = structuredClone(initial)
  function respond(request: ServerPendingRequest): ServerReply {
    if (request.kind === 'create') return { view: structuredClone(current) }
    const s = { ...current.summary }
    if (request.kind === 'features') {
      const o = observation(request.body)
      s.missing_ms += Math.max(0, o.start_ms - s.total_ms)
      const duration = o.end_ms - o.start_ms
      s.total_ms = o.end_ms
      if (o.valid) {
        s.valid_ms += duration
        s.normal_ms += duration
      } else if (o.phase === 'rest') s.rest_ms += duration
      else if (o.phase === 'away') s.away_ms += duration
      else s.unknown_ms += duration
      s.keep_rate = s.valid_ms ? s.normal_ms / s.valid_ms : null
      s.events_per_hour = s.valid_ms ? 0 : null
      current = { ...current, last_sequence: o.sequence, summary: s }
      return { view: structuredClone(current), observation: o }
    }
    s.missing_ms += request.body.end_ms - s.total_ms
    s.total_ms = request.body.end_ms
    current = {
      ...current,
      ended: true,
      summary: s,
      events: [
        ...current.events,
        {
          schema_version: '1.0',
          session_id: SESSION_ID,
          event_id: (current.events.at(-1)?.event_id ?? 0) + 1,
          kind: 'session_ended',
          timestamp_ms: s.total_ms,
          onset_ms: s.total_ms,
          onset_valid_ms: s.valid_ms,
          deviation_type: 'none',
          reason: 'ended',
        },
      ],
    }
    return { view: structuredClone(current) }
  }
  const client: SessionClient & {
    send: ReturnType<
      typeof vi.fn<(request: ServerPendingRequest, signal: AbortSignal) => Promise<ServerReply>>
    >
    get: ReturnType<typeof vi.fn<SessionClient['get']>>
  } = {
    send: vi.fn(async (request) => respond(request)),
    get: vi.fn(async () => structuredClone(current)),
  }
  return { client, respond, current: () => structuredClone(current) }
}
