import type { Rules } from '../../lib/engine'
import type { Profile, RecordItem } from '../storage/types'

/** `user_id` is the decimal `user_account_id` of DB schema V1.1. */
export type AccountUser = { user_id: string; email: string; profile: Profile }
/** `alerts_on` is the 「자세 알림」 switch (`user_account.sound_alert_enabled`, DB V2.3); demo display stays per device. */
export type AccountPreferences = { alerts_on: boolean }
/** `user_account.display_name` is VARCHAR(30). */
export const ACCOUNT_NAME_MAX = 30
export const validAccountId = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value)
export type AccountWorkspace = {
  schema_version: '2.0'
  profile: Profile
  rules: Rules
  preferences: AccountPreferences
  consents: { optional_profile: boolean }
  records: RecordItem[]
}
export type WorkspaceUpdate = Pick<AccountWorkspace, 'profile' | 'rules' | 'preferences'>
export type Registration = {
  email: string
  password: string
  profile: Profile
  consents: Consent[]
}

export const CONSENT_VERSION = 'service-v2'
export const REQUIRED_CONSENTS = ['TERMS', 'ACCOUNT_INFO', 'POSE_COORDINATES', 'MEASUREMENT_RECORD', 'AGE_14_OVER'] as const
export type Consent = { type: typeof REQUIRED_CONSENTS[number] | 'OPTIONAL_PROFILE'; document_version: typeof CONSENT_VERSION }
export const registrationConsents = (optional: boolean): Consent[] =>
  [...REQUIRED_CONSENTS, ...(optional ? ['OPTIONAL_PROFILE' as const] : [])]
    .map(type => ({ type, document_version: CONSENT_VERSION }))
