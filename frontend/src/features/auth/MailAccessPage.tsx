import { useEffect, useRef, useState } from 'react'
import { LoginPage } from '../../pages/LoginPage'
import { ValidatedInput } from '../../components/InlineForm'
import { accountMailApi, mailRoute, newPasswordValid, type MailPurpose } from './mailApi'

export function MailAccessPage({ purpose: initialPurpose = 'reset', initialEmail = '', onBack }: {
  purpose?: MailPurpose; initialEmail?: string; onBack: () => void
}) {
  const [landing] = useState(() => mailRoute(window.location.hash))
  const purpose = landing?.purpose ?? initialPurpose
  const [token, setToken] = useState(landing?.token ?? '')
  const [confirming, setConfirming] = useState(!!landing?.token)
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => {
    // Keep bearer tokens out of history and copied URLs; never persist them in localStorage.
    if (landing) window.history.replaceState(null, '', window.location.pathname + window.location.search)
    return () => { pending.current?.abort() }
  }, [landing])
  useEffect(() => {
    if (!cooldown) return
    const id = window.setTimeout(() => setCooldown(v => Math.max(0, v - 1)), 1000)
    return () => window.clearTimeout(id)
  }, [cooldown])

  async function submit() {
    if (busy) return
    setError(''); setMessage('')
    if (confirming && !token.trim()) { setError('메일의 인증 코드를 입력해 주세요.'); return }
    if (confirming && purpose === 'reset' && !newPasswordValid(password)) {
      setError('새 비밀번호는 12자 이상, UTF-8 기준 72바이트 이하로 입력해 주세요.'); return
    }
    if (confirming && purpose === 'reset' && password !== again) { setError('새 비밀번호가 서로 달라요.'); return }
    const controller = new AbortController(); pending.current = controller; setBusy(true)
    try {
      if (!confirming) {
        await accountMailApi.request(purpose, email, controller.signal)
        if (controller.signal.aborted) return
        setCooldown(60)
        setMessage(purpose === 'reset' ? '가입된 주소라면 재설정 안내를 보내드려요. 메일함을 확인해 주세요.' : '인증 안내를 요청했어요. 메일함을 확인해 주세요.')
      } else {
        if (purpose === 'reset') await accountMailApi.reset(token.trim(), password, controller.signal)
        else await accountMailApi.verify(token.trim(), controller.signal)
        if (controller.signal.aborted) return
        setToken(''); setPassword(''); setAgain(''); setDone(true)
        setMessage(purpose === 'reset' ? '비밀번호를 재설정했어요. 새 비밀번호로 다시 로그인해 주세요.' : '이메일을 확인했어요. 가입을 진행하던 화면으로 돌아가 주세요.')
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '요청을 완료하지 못했어요.')
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }

  return <LoginPage title={purpose === 'reset' ? '비밀번호 재설정' : '이메일 인증'}
    lead={purpose === 'reset' ? '가입한 이메일로 본인 확인 후 새 비밀번호를 설정해요.' : '메일로 받은 링크나 인증 코드로 이메일을 확인해요.'}
    submitLabel={done ? '돌아가기' : busy ? '처리 중…' : confirming ? purpose === 'reset' ? '새 비밀번호 저장' : '이메일 확인' : cooldown ? `${cooldown}초 후 다시 요청` : '안내 메일 요청'}
    submitDisabled={busy || (!confirming && cooldown > 0)} onSubmit={done ? onBack : () => void submit()}
    footer={<>
      {!accountMailApi.enabled && <p className="fine mail-pending" role="status">화면 준비 단계예요. 서버 연결 전에는 메일 발송이나 비밀번호 변경이 실행되지 않아요.</p>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
      {!done && <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => { setConfirming(v => !v); setError(''); setMessage(''); setPassword(''); setAgain('') }}>
        {confirming ? '새 메일 요청하기' : '이미 받은 인증 코드 입력'}
      </button>}
      {!done && <button type="button" className="btn btn-quiet" disabled={busy} onClick={onBack}>돌아가기</button>}
    </>}>
    {!done && (!confirming ? <label className="field">이메일<ValidatedInput className="input" name="email" validationLabel="이메일" type="email" required maxLength={254} value={email} disabled={busy} autoComplete="email" onChange={e => setEmail(e.target.value)} /></label> : <>
      <label className="field">메일 인증 코드<ValidatedInput className="input" name="mail-token" validationLabel="인증 코드" required maxLength={512} autoComplete="off" spellCheck={false} value={token} disabled={busy} onChange={e => setToken(e.target.value)} /></label>
      {purpose === 'reset' && <>
        <label className="field">새 비밀번호<ValidatedInput className="input" name="new-password" validationLabel="새 비밀번호" type="password" required minLength={12} maxLength={72} autoComplete="new-password" value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></label>
        <p className="fine">12자 이상으로 입력해 주세요. 한글·이모지는 UTF-8 바이트 제한을 적용해요.</p>
        <label className="field">새 비밀번호 확인<ValidatedInput className="input" name="password-again" validationLabel="비밀번호 확인" type="password" required minLength={12} maxLength={72} autoComplete="new-password" value={again} disabled={busy} onChange={e => setAgain(e.target.value)} /></label>
      </>}
    </>)}
  </LoginPage>
}
