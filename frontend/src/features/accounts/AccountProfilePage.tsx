import { useEffect, useRef, useState } from 'react'
import { InlineForm, ValidatedInput } from '../../components/InlineForm'
import { Card } from '../../components/ui'
import { ProfileFields } from '../profile/ProfileFields'
import { ConfirmDialog } from '../dialog/ConfirmDialog'
import type { Profile } from '../storage/types'
import { accountClient, accountError } from './client'
import { ACCOUNT_NAME_MAX } from './contracts'
import { validProfile } from '../storage/validation'
import { validPassword, PASSWORD_GUIDANCE } from './password'

type Props = {
  userId: string
  email: string
  profile: Profile
  canWrite: boolean
  measuring: boolean
  hasPendingResult: boolean
  onSave: (profile: Profile) => Promise<unknown>
  onSettings: () => void
  onDeleted: () => void
  onPasswordChanged: () => void
}

export function AccountProfilePage(props: Props) {
  const {
    userId,
    email,
    profile,
    canWrite,
    measuring,
    hasPendingResult,
    onSave,
    onSettings,
    onDeleted,
    onPasswordChanged,
  } = props
  const [name, setName] = useState(profile.name)
  const [age, setAge] = useState(profile.age)
  const [occupation, setOccupation] = useState(profile.occupation)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const processing = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    setName(profile.name)
    setAge(profile.age)
    setOccupation(profile.occupation)
  }, [profile.name, profile.age, profile.occupation])

  async function run(action: () => Promise<unknown>, success: string) {
    if (!canWrite || processing.current) return
    processing.current = true
    setBusy(true)
    setMessage('')
    try {
      await action()
      if (alive.current) setMessage(success)
    } catch (error) {
      if (alive.current) setMessage(accountError(error))
    } finally {
      processing.current = false
      if (alive.current) setBusy(false)
    }
  }

  return (
    <div className="profile-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">프로필 설정</h1>
          <p className="page-desc">{email} · 내 계정 정보</p>
        </div>
        <button className="btn" onClick={onSettings}>
          설정으로
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      <div className="grid g2">
        <Card title="기본 정보">
          <InlineForm
            className="profile-form"
            onSubmit={(event) => {
              event.preventDefault()
              const next = { name: name.trim(), age, occupation: occupation.trim() }
              if (!validProfile(next)) {
                setMessage('이름·나이·직업을 확인해 주세요.')
                return
              }
              void run(() => onSave(next), '프로필을 저장했습니다.')
            }}
          >
            <ProfileFields
              form={{ name, age, occupation, setName, setAge, setOccupation }}
              canWrite={canWrite && !busy}
              nameMax={ACCOUNT_NAME_MAX}
            />
            <button className="btn btn-primary" disabled={!canWrite || busy}>
              변경 저장
            </button>
          </InlineForm>
        </Card>
        <Card title="비밀번호 변경">
          <InlineForm
            className="profile-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (!validPassword(currentPassword) || !validPassword(newPassword, true)) {
                setMessage(PASSWORD_GUIDANCE)
                return
              }
              void run(async () => {
                accountClient.assertIdentity(userId)
                await accountClient.password(currentPassword, newPassword)
                onPasswordChanged()
              }, '비밀번호를 변경했습니다.')
            }}
          >
            <label className="field">
              현재 비밀번호
              <ValidatedInput name="currentPassword" validationLabel="현재 비밀번호"
                className="input"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
                maxLength={72}
                disabled={busy}
              />
            </label>
            <label className="field">
              새 비밀번호
              <ValidatedInput name="newPassword" validationLabel="새 비밀번호"
                className="input"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                minLength={12}
                maxLength={72}
                disabled={busy}
              />
            </label>
            <button className="btn" disabled={!canWrite || busy}>
              비밀번호 변경
            </button>
          </InlineForm>
        </Card>
      </div>
      <Card title="회원 탈퇴">
        <p className="profile-text">
          계정과 저장된 설정·측정 기록을 삭제합니다. 직접 내려받은 파일은 삭제하지 않습니다. 진행
          중인 측정과 결과 저장을 마친 뒤 탈퇴해 주세요.
        </p>
        <button
          className="btn btn-danger"
          disabled={!canWrite || busy || measuring || hasPendingResult}
          onClick={() => {
            setDeletePassword('')
            setDeleting(true)
          }}
        >
          계정 삭제
        </button>
      </Card>
      {deleting && (
        <ConfirmDialog
          title="계정과 기록을 삭제할까요?"
          confirmLabel="계정과 기록 삭제"
          disabled={!validPassword(deletePassword) || !canWrite || measuring || hasPendingResult}
          formatError={accountError}
          onCancel={() => {
            setDeleting(false)
            setDeletePassword('')
          }}
          onConfirm={async () => {
            accountClient.assertIdentity(userId)
            await accountClient.deleteAccount(deletePassword)
            onDeleted()
          }}
        >
          <p>삭제한 계정과 측정 기록은 되돌릴 수 없습니다. 비밀번호를 입력하고 확인해 주세요.</p>
          <label className="field">
            비밀번호 확인
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={deletePassword}
              onChange={(event) => setDeletePassword(event.target.value)}
              maxLength={72}
            />
          </label>
        </ConfirmDialog>
      )}
    </div>
  )
}
