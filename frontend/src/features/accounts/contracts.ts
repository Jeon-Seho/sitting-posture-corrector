import type { Rules } from '../../lib/engine'
import type { Profile, RecordItem } from '../storage/types'

export type AccountUser = { user_id: string; email: string; profile: Profile }
export type AccountPreferences = { show_demo: boolean; alerts_on: boolean }
export type AccountWorkspace = {
  schema_version: '1.0'
  profile: Profile
  rules: Rules
  preferences: AccountPreferences
  records: RecordItem[]
}
export type WorkspaceUpdate = Pick<AccountWorkspace, 'profile' | 'rules' | 'preferences'>
export type Registration = {
  email: string
  password: string
  profile: Profile
  consent_version: 'service-v1'
}
