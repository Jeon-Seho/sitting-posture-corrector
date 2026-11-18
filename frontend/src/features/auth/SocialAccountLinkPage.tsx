import { useEffect, useRef, useState } from 'react'
import { LoginPage } from '../../pages/LoginPage'
import { ValidatedInput } from '../../components/InlineForm'
import { AccountError, type AccountView, type SocialClient, type SocialLinkDraft } from './accountClient'

export type SocialLinkClient = Pick<SocialClient, 'linkDraft' | 'verifyLink' | 'confirmLink' | 'cancelLink'>

/** OAuth 이메일 충돌 → 기존 계정 인증 → 명시적 연결 승인 → 로그인. */
export function SocialAccountLinkPage({ social, onComplete, onCancel, onFindPassword }: {
  social: SocialLinkClient; onComplete: (view: AccountView) => void; onCancel: () => void; onFindPassword: () => void
}) {
  const [draft, setDraft] = useState<SocialLinkDraft | null>(null)
  const [stage, setStage] = useState<'collision' | 'verify' | 'confirm'>('collision')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    void social.linkDraft?.().then(value => {
      if (!mounted.current) return
      setDraft(value); if (value.verified) setStage('confirm')
    }).catch(() => { if (mounted.current) setError('계정 연결 확인 시간이 지났어요. Discord로 다시 시작해 주세요.') })
    return () => { mounted.current = false }
  }, [social])

  async function submit() {
    if (busy || !draft) return
    if (stage === 'collision') { setStage('verify'); return }
    if (stage === 'verify' && !password) { setError('기존 계정의 비밀번호를 입력해 주세요.'); return }
    setBusy(true); setError('')
    try {
      if (stage === 'verify') {
        if (!social.verifyLink) throw new Error('unavailable')
        await social.verifyLink(password)
        if (mounted.current) { setPassword(''); setStage('confirm') }
      } else {
        if (!social.confirmLink) throw new Error('unavailable')
        const view = await social.confirmLink()
        if (mounted.current) onComplete(view)
      }
    } catch (e) {
      if (mounted.current) {
        setPassword('')
        setError(e instanceof AccountError && e.status === 400 ? '기존 계정 비밀번호가 맞지 않아요.' : e instanceof AccountError && e.status === 429 ? '확인 시도가 많아요. Discord 로그인을 다시 시작해 주세요.' : '계정 연결을 완료하지 못했어요. 다시 시작해 주세요.')
      }
    } finally { if (mounted.current) setBusy(false) }
  }

  async function cancel() {
    if (busy) return
    setBusy(true)
    try { await social.cancelLink?.(); if (mounted.current) onCancel() }
    catch { if (mounted.current) setError('취소 요청을 완료하지 못했어요. 다시 시도해 주세요.') }
    finally { if (mounted.current) setBusy(false) }
  }

  return <LoginPage title={stage === 'collision' ? '이미 가입된 계정이 있어요' : stage === 'verify' ? '기존 계정으로 본인 확인' : 'Discord 계정을 연결할까요?'}
    lead={stage === 'collision' ? 'Discord 이메일로 가입한 계정을 찾았어요. 기존 계정의 소유권을 확인하고 연결할 수 있어요.' : stage === 'verify' ? '기존 계정의 비밀번호를 확인해 주세요. 다음 화면에서 Discord 연결을 승인해요.' : '연결하면 이메일 또는 Discord로 같은 계정에 로그인할 수 있어요.'}
    submitLabel={busy ? '처리 중…' : stage === 'collision' ? '기존 계정으로 로그인' : stage === 'verify' ? '기존 계정 인증하기' : '연결 승인하고 로그인'}
    submitDisabled={busy || !draft} onSubmit={() => void submit()}
    footer={<>
      {error && <p role="alert" className="form-error">{error}</p>}
      {stage === 'verify' && <button type="button" className="btn btn-quiet" disabled={busy} onClick={onFindPassword}>비밀번호 찾기</button>}
      <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void cancel()}>취소하고 로그인으로 돌아가기</button>
    </>}>
    {draft && <p className="mail-account"><strong>{draft.email}</strong></p>}
    {stage === 'verify' && <label className="field">기존 계정 비밀번호<ValidatedInput className="input" name="link-password" validationLabel="비밀번호" type="password" required maxLength={72} autoComplete="current-password" value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></label>}
    <p className="fine">{stage === 'confirm' ? '아래 승인 버튼을 누를 때만 Discord를 연결하고 로그인해요.' : '이메일이 같아도 계정을 자동으로 연결하지 않아요.'}</p>
  </LoginPage>
}
