import { useState } from 'react'

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')

  return (
    <div className="center-page">
      <form
        className="auth-card"
        onSubmit={(e) => {
          e.preventDefault()
          onLogin()
        }}
      >
        <div className="brand" style={{ padding: 0, marginBottom: 18 }}>
          <span className="brand-mark">P</span>
          <div>
            <div className="brand-name">PoseGood</div>
            <div className="brand-sub">자세 붕괴 주기 분석 · 교정 보조</div>
          </div>
        </div>

        <h2 style={{ fontSize: 17, marginBottom: 4 }}>로그인</h2>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 18 }}>
          측정 기록은 계정별로 분리되어 저장됩니다.
        </p>

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

        <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }}>
          로그인
        </button>

        <p className="muted" style={{ fontSize: 11.5, marginTop: 14, textAlign: 'center' }}>
          UI 시연용 화면입니다. 인증은 동작하지 않으며 아무 값이나 입력해도 들어갑니다.
        </p>
      </form>
    </div>
  )
}
