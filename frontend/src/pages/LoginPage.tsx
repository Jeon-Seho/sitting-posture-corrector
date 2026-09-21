import { useState } from 'react'
import { ArrowRight } from '@phosphor-icons/react'
import { Rings } from '../components/ui'

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')

  return (
    <div className="cover-page">
      <div className="cover">
        <Rings count={3} />
        <div className="cover-sheet">
          <div className="cover-meta">
            <div className="cover-dash">
              <span>자세 붕괴 주기 분석</span>
              <span>교정 보조 시스템</span>
            </div>

            <form
              className="cover-form"
              onSubmit={(e) => {
                e.preventDefault()
                onLogin()
              }}
            >
              <div>
                <h2>로그인</h2>
                <p className="lead">측정 기록은 계정별로 분리되어 저장됩니다.</p>
              </div>

              <div className="field">
                <label htmlFor="login-id">아이디</label>
                <input
                  id="login-id"
                  className="input"
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  placeholder="user@example.com"
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label htmlFor="login-pw">비밀번호</label>
                <input
                  id="login-pw"
                  className="input"
                  type="password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="off"
                />
              </div>

              <button type="submit" className="btn btn-lg" style={{ width: '100%' }}>
                로그인
                <ArrowRight size={18} weight="bold" className="icon" />
              </button>

              <p className="fine">
                UI 시연용 화면입니다. 인증은 동작하지 않으며 아무 값이나 입력해도 들어갑니다.
              </p>
            </form>
          </div>

          <h1 className="cover-title">
            POSE
            <br />
            GOOD
          </h1>
        </div>
      </div>
    </div>
  )
}
