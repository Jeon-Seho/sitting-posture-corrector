import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CONSENT_DOCUMENT_VERSION,
  CONSENTS,
  consentPayload,
  consentsComplete,
  missingConsents,
} from './consents'

describe('sign-up consents (DB V2.3 user_consent)', () => {
  it('matches the six consent types the database accepts', () => {
    const schema = readFileSync(new URL('../../../../database/schema/schema_V2_3.sql', import.meta.url), 'utf8')
    const allowed = schema.match(/ck_user_consent_consent_type CHECK \(consent_type IN \(([^)]*)\)/)![1]
    const types = [...allowed.matchAll(/'([A-Z_0-9]+)'/g)].map((m) => m[1]).sort()
    expect(CONSENTS.map((c) => c.type).sort()).toEqual(types)
    // Only the optional profile can be skipped (column comment: OPTIONAL_PROFILE 외에는 필수).
    expect(CONSENTS.filter((c) => !c.required).map((c) => c.type)).toEqual(['OPTIONAL_PROFILE'])
    expect(CONSENT_DOCUMENT_VERSION.length).toBeLessThanOrEqual(20)
  })

  it('lists missing required items and sends only what was agreed', () => {
    expect(missingConsents({}).map((c) => c.id)).toEqual(['C1', 'C2', 'C4', 'C5', 'C6'])
    const required = { C1: true, C2: true, C4: true, C5: true, C6: true }
    expect(missingConsents(required)).toEqual([])
    // The optional item still needs an explicit choice before the next step.
    expect(consentsComplete(required)).toBe(false)
    expect(consentsComplete({ ...required, C3: false })).toBe(true)
    expect(consentPayload({ ...required, C3: false })).toHaveLength(5)
    expect(consentPayload({ ...required, C3: true })).toContainEqual({
      consent_type: 'OPTIONAL_PROFILE',
      document_version: CONSENT_DOCUMENT_VERSION,
    })
  })
})
