import type { Rules } from '../../lib/engine'
import type { Profile, RecordItem } from '../storage/types'

/** `user_id` is the decimal `user_account_id` of DB schema V1.1. */
export type AccountUser = { user_id: string; email: string; profile: Profile }
/** `alerts_on` is the 「자세 알림」 switch (`user_account.alert_enabled`, DB V2.2); demo display stays per device. */
export type AccountPreferences = { alerts_on: boolean }
/** `user_account.display_name` is VARCHAR(30). */
export const ACCOUNT_NAME_MAX = 30
export const validAccountId = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value)
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
