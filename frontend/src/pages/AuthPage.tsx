import { useState } from 'react'
import { ChatCircle } from '@phosphor-icons/react'
import { LoginPage } from './LoginPage'
import type { Profile } from '../lib/serviceStore'

export function AuthPage({ onLogin, onSignup }: {
  onLogin: () => void
  onSignup: (profile: Profile) => void
}) {
  const [signup, setSignup] = useState(false)
  const [message, setMessage] = useState('')
  function switchMode() { setSignup(!signup); setMessage('') }
  return <LoginPage key={String(signup)} title={signup ? '회원가입' : '로그인'}
    lead={signup ? '나에게 맞는 자세 관리를 시작해 보세요.' : '오늘도 바른 자세로 시작해 보세요.'}
    submitLabel={signup ? '가입하고 시작하기' : '로그인'}
    onSubmit={form => {
      if (!signup) { onLogin(); return }
      const values = new FormData(form)
      if (values.get('password') !== values.get('passwordConfirm')) {
        setMessage('비밀번호가 일치하지 않습니다.'); return
      }
      onSignup({ name: String(values.get('name')).trim(), age: Number(values.get('age')), occupation: String(values.get('occupation')).trim() })
    }}
    footer={<>
      {!signup && <div className="social-logins" aria-label="소셜 로그인">
        <button type="button" className="social-login social-kakao" onClick={() => setMessage('카카오 로그인은 연결 준비 중입니다. 위의 아이디와 비밀번호로 미리보기를 이용해 주세요.')}><ChatCircle size={20} weight="fill" aria-hidden="true"/><span>카카오로 쉬운시작</span></button>
        <button type="button" className="social-login social-facebook" onClick={() => setMessage('페이스북 로그인은 연결 준비 중입니다. 위의 아이디와 비밀번호로 미리보기를 이용해 주세요.')}><b aria-hidden="true">f</b><span>페이스북으로 쉬운시작</span></button>
        <button type="button" className="social-login social-naver" onClick={() => setMessage('네이버 로그인은 연결 준비 중입니다. 위의 아이디와 비밀번호로 미리보기를 이용해 주세요.')}><b aria-hidden="true">N</b><span>네이버로 쉬운시작</span></button>
      </div>}
      <button type="button" className="auth-text-link" onClick={switchMode}>{signup ? '로그인으로 돌아가기' : '회원가입'}</button>
      {message && <p className="fine" role="status">{message}</p>}
    </>}>
    <label className="field">아이디<input className="input" name="username" autoComplete="username" placeholder="아이디를 입력해 주세요" required maxLength={80}/></label>
    <label className="field">비밀번호<input className="input" name="password" type="password" autoComplete={signup ? 'new-password' : 'current-password'} placeholder="비밀번호를 입력해 주세요" required/></label>
    {signup && <>
      <label className="field">비밀번호 확인<input className="input" name="passwordConfirm" type="password" autoComplete="new-password" placeholder="비밀번호를 다시 입력해 주세요" required/></label>
      <label className="field">이름<input className="input" name="name" autoComplete="name" required pattern=".*\S.*" maxLength={50}/></label>
      <label className="field">나이<input className="input" name="age" type="number" min={1} max={120} required/></label>
      <label className="field">직업<input className="input" name="occupation" required pattern=".*\S.*" maxLength={80}/></label>
    </>}
  </LoginPage>
}
