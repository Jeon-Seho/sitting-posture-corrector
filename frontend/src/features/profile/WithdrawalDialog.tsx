import type { ProfileForm } from './useProfileForm'
import { ConfirmDialog } from '../dialog/ConfirmDialog'

export function WithdrawalDialog({ form, disabled }: { form: ProfileForm; disabled: boolean }) {
  const { consent, setConfirmDelete, withdraw } = form
  return (
    <ConfirmDialog
      title="탈퇴하고 자료를 삭제할까요?"
      confirmLabel="확인"
      disabled={disabled}
      onCancel={() => setConfirmDelete(false)}
      onConfirm={withdraw}
    >
      <p>
        {consent
          ? '학습용 보관 서버가 아직 연결되지 않아 동의 내용은 전달·보관되지 않습니다. 이 미리보기에서는 동의 여부와 관계없이 이 브라우저의 사용자 자료를 모두 삭제합니다.'
          : '학습용 보관 없이 이 브라우저의 사용자 자료를 삭제합니다. 이 화면은 스켈레톤을 영구 저장하지 않습니다.'}
      </p>
    </ConfirmDialog>
  )
}
