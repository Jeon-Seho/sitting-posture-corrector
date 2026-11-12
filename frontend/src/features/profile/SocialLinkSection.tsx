import { useEffect, useState } from 'react'
import { accountErrorMessage, AccountError, type SocialClient, type SocialStatus } from '../auth/accountClient'

/**
 * Profile settings → Discord link (BE /auth/social). Linking leaves the app for Discord and comes
 * back with `#social-result?status=linked`; the app shows the result after signing in again.
 * An account without a password cannot unlink its only sign-in method (409 LAST_LOGIN_METHOD).
 */
export function SocialLinkSection({ social, disabled }: { social: SocialClient; disabled: boolean }) {
  const [status, setStatus] = useState<SocialStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    let live = true
    social.status().then(value => { if (live) setStatus(value) }).catch((caughtError) => {
      console.error('[features/profile/SocialLinkSection.tsx:SocialLinkSection] Operation failed', caughtError)
      if (live) setMessage('로그인 수단을 불러오지 못했어요. 다시 열어 주세요.')
    })
    return () => { live = false }
  }, [social])
  const discord = status?.providers.find(p => p.provider === 'discord')
  if (status && !discord?.available) return null

  async function link() {
    setBusy(true); setMessage('')
    try {
      window.location.assign(await social.startLink())
    } catch (caughtError) {
      console.error('[features/profile/SocialLinkSection.tsx:link] Operation failed', caughtError)
      setMessage(caughtError instanceof AccountError && caughtError.code === 'SOCIAL_ALREADY_LINKED'
        ? '이미 Discord가 연결돼 있어요.' : accountErrorMessage(caughtError, 'login'))
      setBusy(false)
    }
  }

  async function unlink() {
    setBusy(true); setMessage('')
    try {
      await social.unlink()
      setStatus(await social.status())
      setMessage('Discord 연결을 해제했어요.')
    } catch (caughtError) {
      console.error('[features/profile/SocialLinkSection.tsx:unlink] Operation failed', caughtError)
      setMessage(caughtError instanceof AccountError && caughtError.code === 'LAST_LOGIN_METHOD'
        ? '비밀번호가 없어 Discord가 유일한 로그인 수단이에요. 로그인 화면의 비밀번호 재설정으로 비밀번호를 먼저 정해 주세요.'
        : accountErrorMessage(caughtError, 'login'))
    } finally {
      setBusy(false)
    }
  }

  const off = disabled || busy || !status
  return <section className="social-links" aria-labelledby="social-links-title">
    <h2 id="social-links-title">로그인 수단</h2>
    {message && <p role="status">{message}</p>}
    <div className="social-link-row">
      <div>
        <strong>Discord</strong>
        <p className="fine">{!status ? '확인하는 중…' : discord?.linked ? '연결됨 · Discord로 로그인할 수 있어요' : '연결 안 됨'}</p>
      </div>
      {discord?.linked
        ? <button type="button" className="btn btn-quiet" disabled={off} onClick={() => void unlink()}>연결 해제</button>
        : <button type="button" className="btn btn-social btn-discord" disabled={off} onClick={() => void link()}>Discord 연결</button>}
    </div>
    {status && !status.password_set && <p className="fine">
      이 계정은 비밀번호 없이 Discord로 가입했어요. 비밀번호 변경·탈퇴에는 비밀번호가 필요하니, 로그인 화면의 비밀번호 재설정 메일로 먼저 정해 주세요.
    </p>}
  </section>
}
