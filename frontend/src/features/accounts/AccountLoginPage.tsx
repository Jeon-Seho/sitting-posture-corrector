import { useRef, useState } from 'react'
import { FieldWarning, ValidatedInput } from '../../components/InlineForm'
import { LoginPage } from '../../pages/LoginPage'
import { ProfileFields } from '../profile/ProfileFields'
import { ACCOUNT_NAME_MAX, registrationConsents, type Registration } from './contracts'
import { validPassword, PASSWORD_GUIDANCE } from './password'
import { validProfile } from '../storage/validation'

type Props = {
  busy: boolean
  message: string
  onAuthenticate: (email: string, password: string, registration?: Registration, cancelWithdrawal?: boolean) => Promise<void>
}

export function AccountLoginPage({ busy, message, onAuthenticate }: Props) {
  const [registering, setRegistering] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [age, setAge] = useState<number | null>(null)
  const [occupation, setOccupation] = useState('')
  const [consent, setConsent] = useState(false)
  const [optionalProfile, setOptionalProfile] = useState(false)
  const [cancelWithdrawal, setCancelWithdrawal] = useState(false)
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
    const profile = { name: name.trim(), age: optionalProfile ? age : null, occupation: optionalProfile ? occupation.trim() || null : null }
    if (registering && (!validProfile(profile) || (profile.age !== null && profile.age < 14))) {
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
              profile,
              consents: registrationConsents(optionalProfile),
            }
          : undefined,
        !registering && cancelWithdrawal,
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
        <ValidatedInput name="email" validationLabel="이메일"
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
        <ValidatedInput name="password" validationLabel="비밀번호"
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
      {!registering && <label className="row">
        <input type="checkbox" checked={cancelWithdrawal} disabled={busy}
          onChange={event => setCancelWithdrawal(event.target.checked)} />
        30일 이내 탈퇴 요청을 철회하고 로그인
      </label>}
      {registering && (
        <>
          <ProfileFields
            form={{ name, age, occupation, setName, setAge, setOccupation }}
            canWrite={!busy}
            nameMax={ACCOUNT_NAME_MAX}
            optional optionalEnabled={optionalProfile}
          />
          <label className="row">
            <input type="checkbox" name="optionalProfile" checked={optionalProfile} disabled={busy}
              onChange={event => setOptionalProfile(event.target.checked)} />
            나이·직업의 선택 입력과 보관에 동의합니다. 동의하지 않아도 가입할 수 있습니다.
          </label>
          <label className="row">
            <ValidatedInput name="consent" validationLabel="동의"
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              required
              disabled={busy}
            />
            아래 필수 사항에 모두 동의하며 만 14세 이상임을 확인합니다.
          </label>
          <FieldWarning name="consent" />
          <p className="fine">
            서비스 이용약관, 이메일·이름·비밀번호 해시의 계정 관리, 카메라 관절 좌표의 서버 전송·자세 판정,
            측정 기록·설정 보관에 동의합니다. 영상은 전송하지 않습니다. 연구·학습용 활용 동의는 포함하지 않습니다.
            탈퇴를 요청하면 계정 사용을 중지하고 30일 뒤 자료를 삭제하며, 그 전에 철회할 수 있습니다.
          </p>
        </>
      )}
    </LoginPage>
  )
}
