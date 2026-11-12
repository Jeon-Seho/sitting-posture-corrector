import { desktopBridge } from '../desktop/bridge'

/**
 * Discord sign-in (BE /auth/social/*). The server sends the browser back to the app with only a
 * result in the URL fragment — never a token: `#social-result?status=<status>` or `#social-signup`
 * (the pending sign-up is an HttpOnly cookie). A sign-in sets the refresh cookie, which the app's
 * usual start (A8 → A4) picks up.
 *
 * Off unless `VITE_DISCORD_LOGIN_ENABLED=true` at build time, and off in the desktop app: its
 * `app://` page cannot receive the browser redirect yet (follow-up: system browser + deep link).
 */
export type SocialRoute = { kind: 'result'; status: string } | { kind: 'signup' }

export function discordLoginEnabled(flag: unknown = import.meta.env.VITE_DISCORD_LOGIN_ENABLED) {
  return flag === 'true' && !desktopBridge()
}

export function socialRoute(hash: string): SocialRoute | null {
  const [path, query = ''] = hash.replace(/^#/, '').split('?')
  if (path === 'social-signup') return { kind: 'signup' }
  if (path !== 'social-result') return null
  const status = new URLSearchParams(query).get('status') ?? ''
  return { kind: 'result', status: /^[a-z-]{1,32}$/.test(status) ? status : 'failed' }
}

/** What the app says after coming back from Discord; null when there is nothing to say. */
export function socialResultMessage(status: string): string | null {
  switch (status) {
    case 'signed-in':
      return null
    case 'linked':
      return 'Discord 계정을 연결했어요. 다음부터 Discord로 로그인할 수 있어요.'
    case 'link-required':
      return '이 Discord의 이메일로 가입한 계정이 이미 있어요. 이메일과 비밀번호로 로그인한 뒤 프로필 설정에서 Discord를 연결해 주세요.'
    case 'email-required':
      return 'Discord 계정에 확인된 이메일이 없어 가입할 수 없어요. Discord에서 이메일을 인증한 뒤 다시 시도해 주세요.'
    case 'in-use':
      return '이 Discord 계정은 이미 다른 바른자세 계정에 연결돼 있어요.'
    case 'closed':
      return '탈퇴한 계정입니다. 되돌릴 수 없고 탈퇴 30일 뒤 삭제됩니다.'
    case 'cancelled':
      return 'Discord 로그인을 취소했어요.'
    case 'expired':
      return 'Discord 로그인 시간이 지났어요. 다시 시도해 주세요.'
    default:
      return 'Discord 로그인을 완료하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
  }
}

/** Removes the result from the address bar so a reload or a copied URL does not repeat it. */
export function clearSocialRoute() {
  window.history?.replaceState(null, '', window.location.pathname + window.location.search)
}
