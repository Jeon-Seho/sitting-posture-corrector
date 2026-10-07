import type { LiveState, Machine, Rules } from '../../lib/engine'
import type { EvaluationCounts } from '../session/engine/types'
import type { ServerCheckpoint, SessionView } from '../session/server/contracts'

export type Profile = { name: string; age: number; occupation: string }
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
  evaluationCounts?: EvaluationCounts
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
  server?: ServerCheckpoint
}
export const KEYS = {
  profile: 'posegood.v2.profile',
  records: 'posegood.v2.records',
  draft: 'posegood.v2.draft',
  settings: 'posegood.v2.settings',
  demo: 'posegood.v2.demo',
}
