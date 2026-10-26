import type { LiveState, Machine, Rules } from '../../lib/engine'
import type { ServerCheckpoint, SessionView } from '../session/server/contracts'

/** Age and occupation are optional (sign-up consent C3). */
export type Profile = { name: string; age?: number; occupation?: string }
/** Sign-up result kept on this device until the account server exists. No password is stored. */
export type LocalAccount = {
  email: string
  consents: { version: string; agreed: Record<string, boolean>; at: string }
}
export type Mode = 'camera' | 'demo'
export type DailyMeasurement = {
  date: string
  from: number
  to: number
  total: number
  valid: number
  good: number
  eventIds: number[]
  eventAlerts: Record<string, number>
  alerts: number
}
export type RecordItem = {
  id: string
  startedAt: string
  endedAt: string
  mode: 'camera' | 'demo'
  valid: number
  good: number
  total: number
  events: LiveState['events']
  rules?: Rules
  days?: DailyMeasurement[]
  /** Read-only date projection; never persisted as a replacement for the original server record. */
  dayPartition?: { date: string; sourceId: string; alerts: number; eventCount: number }
  server?: {
    baselineId: string
    modelVersion: string
    confirmed: boolean
    view: SessionView | null
  }
}
export type Draft = {
  id: string
  startedAt: string
  savedAt?: string
  mode: 'camera' | 'demo'
  rules: Rules
  machine: Machine
  days?: DailyMeasurement[]
  server?: ServerCheckpoint
}
export const KEYS = {
  profile: 'posegood.v2.profile',
  records: 'posegood.v2.records',
  draft: 'posegood.v2.draft',
  settings: 'posegood.v2.settings',
  demo: 'posegood.v2.demo',
  account: 'posegood.v2.account',
}
