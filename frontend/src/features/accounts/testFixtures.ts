import { DEFAULT_RULES } from '../../data/posture'
import type { AccountUser, AccountWorkspace } from './contracts'
import type { RecordItem } from '../storage/types'

export const USER_A = '12345678-1234-1234-1234-123456789001'
export const USER_B = '12345678-1234-1234-1234-123456789002'
export const accountUser: AccountUser = {
  user_id: USER_A,
  email: 'synthetic@example.test',
  profile: { name: '합성 계정', age: 23, occupation: '합성 시험' },
}
export const accountWorkspace = (): AccountWorkspace => ({
  schema_version: '1.0',
  profile: { ...accountUser.profile },
  rules: { ...DEFAULT_RULES },
  preferences: { show_demo: false, alerts_on: true },
  records: [],
})
export const syntheticRecord = (): RecordItem => ({
  id: 'synthetic-account-record',
  startedAt: '2026-10-01T00:00:00.000Z',
  endedAt: '2026-10-01T00:01:00.000Z',
  mode: 'demo',
  rules: { ...DEFAULT_RULES },
  valid: 60,
  good: 60,
  total: 60,
  events: [],
})
