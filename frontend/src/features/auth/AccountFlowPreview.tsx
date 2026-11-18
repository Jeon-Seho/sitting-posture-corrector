import { useMemo, useState } from 'react'
import { MailAccessPage } from './MailAccessPage'
import { SocialAccountLinkPage, type SocialLinkClient } from './SocialAccountLinkPage'
import { MailApiError, accountMailApi } from './mailApi'

/** 실제 계정 화면 재사용. 모든 응답은 명시적인 합성 값이며 네트워크를 호출하지 않는다. */
export function AccountFlowPreview({ onClose }: { onClose: () => void }) {
  const [flow, setFlow] = useState<'reset' | 'verify' | 'social'>('reset')
  const [expired, setExpired] = useState(false)
  const [result, setResult] = useState('')
  const api = useMemo(() => ({
    enabledFor: () => true,
    request: async () => {},
    validate: async (token: string) => { if (expired || token !== 'synthetic-link-code') throw new MailApiError('INVALID_TOKEN', '링크가 만료됐어요. 새 메일을 요청해 주세요.') },
    verify: async (code: string) => { if (expired || code !== '123456') throw new MailApiError('INVALID_TOKEN', '인증 코드를 확인해 주세요.') },
    reset: async (_token: string, password: string) => { if (password === 'synthetic-old-password') throw new MailApiError('PASSWORD_REUSED', '기존 비밀번호와 다른 새 비밀번호를 입력해 주세요.') },
  }), [expired])
  const social = useMemo(() => ({
    linkDraft: async () => ({ provider: 'discord', email: 'synthetic@example.test', verified: false }),
    verifyLink: async () => {},
    confirmLink: async () => ({ user_id: 'synthetic', email: 'synthetic@example.test', profile: { name: '합성 사용자', age: null, occupation: null } }),
    cancelLink: async () => {},
  }) satisfies SocialLinkClient, [])
  return <>
    <p className="fine">합성 화면 점검 · 실제 메일 발송/계정 연결 없음. 가입 코드 123456, 찾기 코드 synthetic-link-code, 이전 비밀번호 synthetic-old-password.</p>
    <div className="dev-tool-actions">{(['reset', 'verify', 'social'] as const).map(id => <button className="chip" key={id} aria-pressed={flow === id} onClick={() => { setFlow(id); setResult('') }}>{id === 'reset' ? '비밀번호 찾기' : id === 'verify' ? '이메일 인증' : 'Discord 연결'}</button>)}
      <label><input type="checkbox" checked={expired} onChange={e => setExpired(e.target.checked)} />만료 응답</label>
    </div>
    {result ? <p role="status">{result}</p> : flow === 'social' ? <SocialAccountLinkPage social={social} onComplete={() => setResult('합성 연결·로그인 완료')} onCancel={onClose} onFindPassword={() => setFlow('reset')} /> : <MailAccessPage key={flow} purpose={flow} initialEmail="synthetic@example.test" api={api} onBack={onClose} onVerified={flow === 'verify' ? () => setResult('합성 인증 완료') : undefined} />}
  </>
}

export function AccountMailStatus() {
  return <p className="fine">빌드 설정 · 비밀번호 찾기 {accountMailApi.enabledFor('reset') ? '켜짐' : '꺼짐'} · 이메일 인증 {accountMailApi.enabledFor('verify') ? '켜짐' : '꺼짐'}</p>
}
