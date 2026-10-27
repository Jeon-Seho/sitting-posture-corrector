/**
 * The API requires 12+ characters, but the minimum is on hold while the sign-up flow is still being
 * tried out (user, 2026-10-13): only non-empty is checked. BCrypt rejects values over its byte limit.
 */
export function validPassword(password: string) {
  return password.length >= 1 && new TextEncoder().encode(password).length <= 72
}
export const PASSWORD_GUIDANCE =
  '비밀번호를 입력해 주세요. 너무 길면 한글·이모지를 줄이거나 영문·숫자로 짧게 작성해 주세요.'

/** Account server rule (contracts/accounts.v2.md, D-66): 12+ characters, at most 72 UTF-8 bytes. */
export function validServerPassword(password: string) {
  return password.length >= 12 && new TextEncoder().encode(password).length <= 72
}
export const SERVER_PASSWORD_GUIDANCE =
  '비밀번호는 12자 이상으로 입력해 주세요. 너무 길면 한글·이모지를 줄이거나 영문·숫자로 짧게 작성해 주세요.'
