import type { ReactNode } from 'react'
import { Card } from '../../components/ui'
import { WithdrawalDialog } from './WithdrawalDialog'
import type { ProfileForm } from './useProfileForm'

type Props = {
  form: ProfileForm
  profileFields: ReactNode
  canWrite: boolean
  measuring: boolean
  hasPendingResult: boolean
  onSettings: () => void
}

export function ProfilePage({
  form,
  profileFields,
  canWrite,
  measuring,
  hasPendingResult,
  onSettings,
}: Props) {
  const {
    saveProfile,
    cancelEditing,
    cancelWithdrawal,
    deleting,
    setDeleting,
    consent,
    setConsent,
    confirmDelete,
    setConfirmDelete,
  } = form
  return (
    <div className="profile-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">프로필 설정</h1>
          <p className="page-desc">이름·나이·직업은 이 브라우저에만 저장됩니다.</p>
        </div>
        <button className="btn" onClick={onSettings}>
          설정으로
        </button>
      </div>
      <div className="grid g2">
        <Card title="기본 정보">
          <form
            className="profile-form"
            onSubmit={(e) => {
              e.preventDefault()
              saveProfile()
            }}
          >
            {profileFields}
            <div className="form-actions">
              <button className="btn" type="button" onClick={cancelEditing}>
                취소
              </button>
              <button className="btn btn-primary">변경 저장</button>
            </div>
          </form>
        </Card>
        <Card title="비밀번호 변경">
          <p className="profile-text">
            이 미리보기는 실제 인증을 사용하지 않습니다. 비밀번호 변경은 인증 API 연결 후
            제공됩니다.
          </p>
          <div className="form-actions">
            <button className="btn" disabled>
              인증 서버 연결 필요
            </button>
          </div>
        </Card>
      </div>
      <Card title="회원 탈퇴">
        <p className="profile-text">
          현재는 서버 계정이 없습니다. 아래 동작은 이 브라우저에 저장한 프로필·설정·측정 요약을
          지웁니다. 자세 등록에서 내려받은 CSV 파일은 삭제하지 않습니다.
        </p>
        {!deleting && (
          <div className="form-actions">
            <button
              className="btn btn-danger"
              disabled={!canWrite || measuring || hasPendingResult}
              onClick={() => setDeleting(true)}
            >
              탈퇴하기
            </button>
          </div>
        )}
        {deleting && (
          <div className="profile-delete">
            <label className="row">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              학습용 자료 사용에 동의합니다 (선택)
            </label>
            <div className="form-actions">
              <button className="btn" onClick={cancelWithdrawal}>
                취소
              </button>
              <button
                className="btn btn-danger"
                disabled={!canWrite || measuring || hasPendingResult}
                onClick={() => setConfirmDelete(true)}
              >
                삭제하기
              </button>
            </div>
          </div>
        )}
        {confirmDelete && (
          <WithdrawalDialog form={form} disabled={!canWrite || measuring || hasPendingResult} />
        )}
      </Card>
    </div>
  )
}
