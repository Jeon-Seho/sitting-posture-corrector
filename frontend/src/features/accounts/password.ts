/** BCrypt rejects values longer than its byte limit rather than silently truncating them. */
export function validPassword(password: string, newPassword = false) {
  return (
    password.length >= (newPassword ? 12 : 1) && new TextEncoder().encode(password).length <= 72
  )
}
export const PASSWORD_GUIDANCE =
  '비밀번호는 12자 이상으로 작성해 주세요. 너무 길면 한글·이모지를 줄이거나 영문·숫자로 짧게 작성해 주세요.'
