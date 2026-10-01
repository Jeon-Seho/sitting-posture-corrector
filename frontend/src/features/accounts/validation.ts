import { validProfile, validRecord, validRules } from '../storage/validation'
import { validUuid } from '../session/server/validation'
import type { AccountUser, AccountWorkspace } from './contracts'

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function validUser(value: unknown): value is AccountUser {
  return (
    object(value) &&
    validUuid(value.user_id) &&
    typeof value.email === 'string' &&
    value.email.length <= 254 &&
    value.email.includes('@') &&
    validProfile(value.profile)
  )
}

export function validWorkspace(value: unknown): value is AccountWorkspace {
  return (
    object(value) &&
    value.schema_version === '1.0' &&
    validProfile(value.profile) &&
    validRules(value.rules) &&
    object(value.preferences) &&
    typeof value.preferences.show_demo === 'boolean' &&
    typeof value.preferences.alerts_on === 'boolean' &&
    Array.isArray(value.records) &&
    value.records.every(validRecord) &&
    new Set(value.records.map((record) => record.id)).size === value.records.length
  )
}
