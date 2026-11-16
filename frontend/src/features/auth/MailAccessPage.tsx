import { useEffect, useRef, useState } from 'react'
import { LoginPage } from '../../pages/LoginPage'
import { ValidatedInput } from '../../components/InlineForm'
import { accountMailApi, mailRoute, newPasswordValid, type MailPurpose } from './mailApi'

export function MailAccessPage({ purpose: initialPurpose = 'reset', initialEmail = '', onBack, onVerified,
  api = accountMailApi }: {
  purpose?: MailPurpose; initialEmail?: string; onBack: () => void; onVerified?: () => void
  api?: typeof accountMailApi
}) {
  const [landing] = useState(() => mailRoute(window.location.hash))
  const purpose = landing?.purpose ?? initialPurpose
  const [token, setToken] = useState(landing?.token ?? '')
  const [stage, setStage] = useState<'request' | 'code' | 'password' | 'done'>(landing?.token ? 'code' : 'request')
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(!!landing?.token && purpose === 'reset')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => {
    if (landing) window.history.replaceState(null, '', window.location.pathname + window.location.search)
    if (landing?.token && landing.purpose === 'reset') {
      const controller = new AbortController(); pending.current = controller
      void api.validate(landing.token, controller.signal).then(() => {
        if (!controller.signal.aborted) setStage('password')
      }).catch(e => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '링크를 확인하지 못했어요.')
      }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    }
    return () => { pending.current?.abort() }
  }, [landing, api])
  useEffect(() => {
    if (!cooldown) return
    const id = window.setTimeout(() => setCooldown(v => Math.max(0, v - 1)), 1000)
    return () => window.clearTimeout(id)
  }, [cooldown])

  async function submit() {
    if (busy) return
    if (stage === 'done') { if (purpose === 'verify' && onVerified) onVerified(); else onBack(); return }
    setError(''); setMessage('')
    if (stage === 'code' && !token.trim()) { setError('메일의 인증 코드를 입력해 주세요.'); return }
    if (stage === 'password') {
      if (!newPasswordValid(password)) { setError('새 비밀번호는 12자 이상, UTF-8 기준 72바이트 이하로 입력해 주세요.'); return }
      if (password !== again) { setError('새 비밀번호가 서로 달라요.'); return }
    }
    const controller = new AbortController(); pending.current = controller; setBusy(true)
    try {
      if (stage === 'request') {
        await api.request(purpose, email, controller.signal)
        if (controller.signal.aborted) return
        setCooldown(60); setStage('code'); setToken('')
        setMessage(purpose === 'reset' ? '가입된 이메일이라면 비밀번호 찾기 안내를 보내드려요. 메일의 링크를 열어 주세요.' : '인증 메일을 요청했어요. 이 화면에 6자리 코드를 입력해 주세요.')
      } else if (stage === 'code' && purpose === 'reset') {
        await api.validate(token.trim(), controller.signal)
        if (!controller.signal.aborted) setStage('password')
      } else {
        if (purpose === 'reset') await api.reset(token.trim(), password, controller.signal)
        else await api.verify(token.trim(), controller.signal)
        if (controller.signal.aborted) return
        setToken(''); setPassword(''); setAgain(''); setStage('done')
        setMessage(purpose === 'reset' ? '비밀번호를 재설정했어요. 모든 기기에서 로그아웃됐으니 새 비밀번호로 로그인해 주세요.' : '이메일 인증이 완료됐어요. 회원가입을 계속해 주세요.')
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '요청을 완료하지 못했어요.')
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }

  function requestAgain() {
    setStage('request'); setToken(''); setPassword(''); setAgain(''); setError(''); setMessage('')
  }

  return <LoginPage title={purpose === 'verify' ? '회원가입 · 이메일 인증' : stage === 'password' ? '비밀번호 재설정' : '비밀번호 찾기'}
    lead={purpose === 'reset' ? stage === 'password' ? '기존 비밀번호와 다른 새 비밀번호를 두 번 입력해 주세요.' : '가입한 이메일로 받은 링크로 본인을 확인해요.' : '서버에서 보낸 6자리 코드로 이메일을 확인해요.'}
    submitLabel={stage === 'done' ? purpose === 'verify' && onVerified ? '회원가입 계속하기' : '로그인으로 돌아가기' : busy ? '처리 중…' : stage === 'password' ? '새 비밀번호 저장' : stage === 'code' ? purpose === 'reset' ? '링크·코드 확인' : '인증 코드 확인' : cooldown ? `${cooldown}초 후 다시 요청` : purpose === 'reset' ? '비밀번호 찾기 메일 받기' : '인증 코드 받기'}
    submitDisabled={busy || (stage === 'request' && cooldown > 0)} onSubmit={() => void submit()}
    footer={<>
      {!api.enabledFor(purpose) && <p className="fine mail-pending" role="status">메일 서비스 연결을 준비 중이에요. 잠시 후 다시 시도해 주세요.</p>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
      {stage === 'request' && purpose === 'reset' && <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setStage('code')}>이미 받은 링크·인증 코드 입력</button>}
      {stage !== 'request' && stage !== 'done' && <button type="button" className="btn btn-quiet" disabled={busy} onClick={requestAgain}>메일 다시 요청하기</button>}
      {stage !== 'done' && <button type="button" className="btn btn-quiet" disabled={busy} onClick={onBack}>돌아가기</button>}
    </>}>
    {stage === 'request' && <label className="field">이메일<ValidatedInput className="input" name="email" validationLabel="이메일" type="email" required maxLength={254} value={email} disabled={busy} readOnly={purpose === 'verify' && !!onVerified} autoComplete="email" onChange={e => setEmail(e.target.value)} /></label>}
    {stage === 'code' && <label className="field">{purpose === 'verify' ? '6자리 인증 코드' : '메일 링크의 인증 코드'}<ValidatedInput className="input" name="mail-token" validationLabel="인증 코드" required maxLength={purpose === 'verify' ? 6 : 128} pattern={purpose === 'verify' ? '[0-9]{6}' : undefined} inputMode={purpose === 'verify' ? 'numeric' : 'text'} autoComplete="one-time-code" spellCheck={false} value={token} disabled={busy} onChange={e => setToken(e.target.value)} /></label>}
    {stage === 'password' && <>
      <label className="field">새 비밀번호<ValidatedInput className="input" name="new-password" validationLabel="새 비밀번호" type="password" required minLength={12} maxLength={72} autoComplete="new-password" value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></label>
      <p className="fine">12자 이상, UTF-8 기준 72바이트 이하로 입력해 주세요.</p>
      <label className="field">새 비밀번호 확인<ValidatedInput className="input" name="password-again" validationLabel="비밀번호 확인" type="password" required minLength={12} maxLength={72} autoComplete="new-password" value={again} disabled={busy} onChange={e => setAgain(e.target.value)} /></label>
    </>}
  </LoginPage>
}
