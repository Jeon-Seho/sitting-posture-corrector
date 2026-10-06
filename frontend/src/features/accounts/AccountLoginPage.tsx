import { useRef, useState } from 'react'
import { LoginPage } from '../../pages/LoginPage'
import { ProfileFields } from '../profile/ProfileFields'
import { ACCOUNT_NAME_MAX, type Registration } from './contracts'
import { validPassword, PASSWORD_GUIDANCE } from './password'
import { validProfile } from '../storage/validation'

type Props = {
  busy: boolean
  message: string
  onAuthenticate: (email: string, password: string, registration?: Registration) => Promise<void>
}

export function AccountLoginPage({ busy, message, onAuthenticate }: Props) {
  const [registering, setRegistering] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [age, setAge] = useState(23)
  const [occupation, setOccupation] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)

  async function submit() {
    if (busy || submitting.current) return
    if (registering && !consent) {
      setError('계정과 측정 기록 보관에 동의해 주세요.')
      return
    }
    if (!validPassword(password, registering)) {
      setError(registering ? PASSWORD_GUIDANCE : '비밀번호 길이를 확인해 주세요.')
      return
    }
    if (registering && !validProfile({ name: name.trim(), age, occupation: occupation.trim() })) {
      setError('이름·나이·직업을 확인해 주세요.')
      return
    }
    submitting.current = true
    setError('')
    try {
      await onAuthenticate(
        email.trim(),
        password,
        registering
          ? {
              email: email.trim(),
              password,
              profile: { name: name.trim(), age, occupation: occupation.trim() },
              consent_version: 'service-v1',
            }
          : undefined,
      )
    } finally {
      submitting.current = false
    }
  }

  return (
    <LoginPage
      title={registering ? '계정 만들기' : '로그인'}
      lead="내 계정에 측정 기록과 설정을 보관해요."
      submitLabel={busy ? '확인 중입니다…' : registering ? '계정 만들고 시작' : '로그인'}
      onSubmit={() => void submit()}
      submitDisabled={busy}
      fine="영상은 저장하지 않아요. 카메라는 측정하기 화면에서 직접 켤 때만 사용해요."
      footer={
        <>
          {(error || message) && (
            <p role="alert" className="fine">
              {error || message}
            </p>
          )}
          <button
            type="button"
            className="btn btn-quiet"
            disabled={busy}
            onClick={() => {
              setRegistering(!registering)
              setConsent(false)
              setPassword('')
              setError('')
            }}
          >
            {registering ? '기존 계정으로 로그인' : '새 계정 만들기'}
          </button>
        </>
      }
    >
      <label className="field">
        이메일
        <input
          className="input"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          maxLength={254}
          required
          disabled={busy}
        />
      </label>
      <label className="field">
        비밀번호
        <input
          className="input"
          type="password"
          autoComplete={registering ? 'new-password' : 'current-password'}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={registering ? 12 : undefined}
          maxLength={72}
          required
          disabled={busy}
        />
      </label>
      {registering && (
        <>
          <ProfileFields
            form={{ name, age, occupation, setName, setAge, setOccupation }}
            canWrite={!busy}
            nameMax={ACCOUNT_NAME_MAX}
          />
          <label className="row">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              required
              disabled={busy}
            />
            계정과 측정 기록을 보관하는 데 동의합니다.
          </label>
          <p className="fine">
            측정 요약·사건·설정을 계정에 보관합니다. 연구나 학습용 자료 사용에는 동의하지 않습니다.
          </p>
        </>
      )}
    </LoginPage>
  )
}
