// Synthetic server record values for tests only (R1 `RecordItem.server.view`).
import { DEFAULT_RULES } from '../../../data/posture'
import { policyFor, type SessionView } from './contracts'

export const SESSION_ID = '11111111-1111-4111-8111-111111111111'
export const BASELINE_ID = '22222222-2222-4222-8222-222222222222'
export const BASELINE = { headGap: 0.7, offset: 0, tilt: 0, quality: 0.9 }

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

