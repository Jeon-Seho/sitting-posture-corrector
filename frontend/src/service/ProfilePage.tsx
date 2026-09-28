import { useState } from 'react'
import { Card } from '../components/ui'
import type { Profile } from '../lib/serviceStore'
import { ProfileFields } from './ProfileFields'

export function ProfilePage({ form, onForm, onSave, onCancel, onHome, onWithdraw }: {
  form: Profile
  onForm: (next: Profile) => void
  onSave: () => void
  onCancel: () => void
  onHome: () => void
  onWithdraw: () => void
}) {
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">프로필 설정</h1>
        <button className="btn" onClick={onHome}>홈으로</button>
      </div>
      <div className="grid g2">
        <Card title="기본 정보">
          <form onSubmit={e => { e.preventDefault(); onSave() }}>
            <ProfileFields value={form} onChange={onForm} />
            <div className="row">
              <button className="btn btn-primary">변경 저장</button>
              <button className="btn" type="button" onClick={onCancel}>취소</button>
            </div>
          </form>
        </Card>
        <Card title="비밀번호 변경">
          <p>이 미리보기는 실제 인증을 사용하지 않습니다. 비밀번호 변경은 인증 API 연결 후 제공됩니다.</p>
          <button className="btn" disabled>인증 서버 연결 필요</button>
        </Card>
      </div>
      <WithdrawCard onWithdraw={onWithdraw} />
    </>
  )
}

/** 탈퇴 안내 → 선택적 학습 사용 동의 → 별도 최종 확인(EXIT-01). 동의 여부가 탈퇴 자체를 막지 않는다. */
function WithdrawCard({ onWithdraw }: { onWithdraw: () => void }) {
  const [open, setOpen] = useState(false)
  const [consent, setConsent] = useState(false)
  return (
    <Card title="회원 탈퇴">
      <p>현재는 서버 계정이 없습니다. 아래 동작은 이 브라우저에 저장한 프로필·설정·측정 요약을 지웁니다. 연구 화면에서 내려받은 CSV는 삭제하지 않습니다.</p>
      <button className="btn btn-danger" onClick={() => setOpen(true)}>탈퇴 흐름 확인</button>
      {open && (
        <div>
          <label>
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
            학습용 자료 사용에 동의합니다 (선택)
          </label>
          <p>
            {consent
              ? '학습용 보관 서버가 아직 연결되지 않아 동의 내용은 전달·보관되지 않습니다. 이 미리보기에서는 동의 여부와 관계없이 이 브라우저의 사용자 자료를 모두 삭제합니다.'
              : '학습용 보관 없이 이 브라우저의 사용자 자료를 삭제합니다. 이 화면은 스켈레톤을 영구 저장하지 않습니다.'}
          </p>
          <div className="row">
            <button className="btn" onClick={() => { setOpen(false); setConsent(false) }}>취소</button>
            <button className="btn btn-danger" onClick={onWithdraw}>로컬 자료 삭제 확정</button>
          </div>
        </div>
      )}
    </Card>
  )
}
