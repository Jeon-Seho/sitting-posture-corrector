import type { LiveState, Rules } from '../../lib/engine'
import type { SessionView } from '../session/server/contracts'

/** Age and occupation are optional (sign-up consent C3). */
export type Profile = { name: string; age?: number; occupation?: string }
/** Sign-up result kept on this device until the account server exists. No password is stored. */
export type LocalAccount = {
  email: string
  consents: { version: string; agreed: Record<string, boolean>; at: string }
}
export type Mode = 'camera' | 'demo'
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
  server?: {
    baselineId: string
    modelVersion: string
    confirmed: boolean
    view: SessionView | null
  }
}
export const KEYS = {
  profile: 'posegood.v2.profile',
  records: 'posegood.v2.records',
  /** Unfinished measurement of the app's own judgement (removed 2026-10-21); only deleted now. */
  draft: 'posegood.v2.draft',
  settings: 'posegood.v2.settings',
  demo: 'posegood.v2.demo',
  account: 'posegood.v2.account',
}
