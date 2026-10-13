/**
 * Sign-up and settings consents (DB V2.3 `user_consent`, FE task F6). Prepared 2026-10-13:
 * the sign-up screen still sends `consent_version: "service-v1"` until BE fixes the request
 * shape. Each consent is stored as its own row with the wording version the user saw.
 */
export type ConsentType =
  | 'TERMS'
  | 'ACCOUNT_INFO'
  | 'OPTIONAL_PROFILE'
  | 'POSE_COORDINATES'
  | 'MEASUREMENT_RECORD'
  | 'AGE_14_OVER'

/** Wording version shown at sign-up; a new version asks everyone again (DB `document_version`). */
export const CONSENT_DOCUMENT_VERSION = 'terms-2026-10'

export type ConsentDefinition = {
  type: ConsentType
  /** DB codes C1–C6. */
  code: string
  label: string
  required: boolean
}

/**
 * The six items in sign-up order. Joint coordinates are required: there is no local mode,
 * so measuring is impossible without sending them (ADR 0021).
 */
export const CONSENTS: ConsentDefinition[] = [
  { type: 'AGE_14_OVER', code: 'C6', label: '만 14세 이상이에요', required: true },
  { type: 'TERMS', code: 'C1', label: '이용약관에 동의해요', required: true },
  { type: 'ACCOUNT_INFO', code: 'C2', label: '회원가입 정보(이메일·이름) 수집에 동의해요', required: true },
  { type: 'POSE_COORDINATES', code: 'C4', label: '카메라 관절 좌표 전송에 동의해요 (영상은 보내지 않아요)', required: true },
  { type: 'MEASUREMENT_RECORD', code: 'C5', label: '측정 기록 저장에 동의해요', required: true },
  { type: 'OPTIONAL_PROFILE', code: 'C3', label: '나이·직업 정보 수집에 동의해요 (선택)', required: false },
]

export type ConsentChoice = Partial<Record<ConsentType, boolean>>

/** Required items the user has not checked, in display order. */
export function missingConsents(choice: ConsentChoice): ConsentDefinition[] {
  return CONSENTS.filter((c) => c.required && !choice[c.type])
}

/**
 * Request body part for sign-up (FE proposal, field name to confirm with BE): one entry per
 * checked item. Unchecked optional items are left out; withdrawing later is a separate call.
 */
export function consentPayload(choice: ConsentChoice) {
  return CONSENTS.filter((c) => choice[c.type]).map((c) => ({
    consent_type: c.type,
    document_version: CONSENT_DOCUMENT_VERSION,
  }))
}
