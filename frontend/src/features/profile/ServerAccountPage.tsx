import { useEffect, useState } from 'react'
import { apiRequest, type ApiErrorKind } from '../platform/api'
import { fromApiProfile, toApiProfile, type ApiProfile } from '../auth/accountClient'
import { validServerPassword } from '../auth/password'
import { validProfileInput } from '../storage/validation'
import { sameSnapshot } from '../storage/serverSnapshots'
import type { Profile } from '../storage/types'
import type { Rules } from '../../lib/engine'

type Workspace = { profile: ApiProfile; rules: Rules; preferences: { alerts_on: boolean }; consents: { optional_profile: boolean } }
const messages = Object.fromEntries(['signed_out', 'invalid', 'conflict', 'not_found', 'busy', 'limit', 'server', 'network'].map(k => [k, '변경하지 못했어요. 입력과 서버 연결을 확인해 주세요.'])) as Record<ApiErrorKind, string>
const request = (path: string, method: 'GET' | 'PUT' | 'DELETE' = 'GET', body?: unknown) => apiRequest(path, { method, body }, messages, { retries: 0 })
const editable = (w: Workspace) => ({ profile: w.profile, rules: w.rules, preferences: w.preferences })

/** Mutations always go to the JWT account; a local copy is never presented as a server change. */
export function ServerAccountPage({ blocked, onProfile, onSignedOut, onBusy }: {
  blocked: boolean; onProfile: (profile: Profile) => void; onSignedOut: (message: string) => void; onBusy: (busy: boolean) => void
}) {
  const [base, setBase] = useState<Workspace | null>(null)
  const [name, setName] = useState('')
  const [age, setAge] = useState('')
  const [occupation, setOccupation] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    let live = true
    request('/v2/workspace').then(value => {
      const w = value as Workspace
      if (!live) return
      if (!w?.profile || !w.rules || !w.preferences || !w.consents) throw Error('설정 응답을 확인하지 못했어요.')
      setBase(w); setName(w.profile.name); setAge(w.profile.age === null ? '' : String(w.profile.age)); setOccupation(w.profile.occupation ?? '')
    }).catch(() => { if (live) setMessage('서버 설정을 불러오지 못했어요. 다시 열어 주세요.') })
    return () => { live = false }
  }, [])
  const disabled = blocked || busy || !base
  async function run(action: () => Promise<void>) {
    if (disabled) return
    setBusy(true); onBusy(true); setMessage('')
    try { await action() } catch (error) { setMessage(error instanceof Error ? error.message : '변경하지 못했어요.') }
    finally { setBusy(false); onBusy(false); setCurrentPassword(''); setNewPassword('') }
  }
  async function save() {
    if (!base) return
    const next: Profile = { name: name.trim(), ...(base.consents.optional_profile ? { ...(age ? { age: Number(age) } : {}), ...(occupation.trim() ? { occupation: occupation.trim() } : {}) } : {}) }
    if (!validProfileInput(next)) throw Error('이름·나이·직업을 확인해 주세요.')
    const latest = await request('/v2/workspace') as Workspace
    if (!sameSnapshot(editable(base), editable(latest))) throw Error('다른 화면에서 설정이 바뀌었어요. 이 화면을 다시 열고 확인해 주세요.')
    const saved = await request('/v2/workspace', 'PUT', { ...editable(latest), profile: toApiProfile(next) }) as Workspace
    setBase(saved); onProfile(fromApiProfile(saved.profile)); setMessage('서버에 저장했어요.')
  }
  return <div className="profile-page">
    <h1 className="page-title">프로필 설정</h1>
    {blocked && <p role="status">측정을 종료하고 결과 저장을 확인한 뒤 계정을 변경해 주세요.</p>}
    {message && <p role="status">{message}</p>}
    <form className="profile-form" onSubmit={e => { e.preventDefault(); void run(save) }}>
      <label className="field">이름<input className="input" name="serverName" value={name} onChange={e => setName(e.target.value)} required maxLength={30} /></label>
      {base?.consents.optional_profile && <>
        <label className="field">나이 (선택)<input className="input" type="number" min={14} max={120} value={age} onChange={e => setAge(e.target.value)} /></label>
        <label className="field">직업 (선택)<input className="input" maxLength={80} value={occupation} onChange={e => setOccupation(e.target.value)} /></label>
      </>}
      <button className="btn" disabled={disabled}>프로필 서버 저장</button>
    </form>
    <h2>비밀번호 변경 · 회원 탈퇴</h2>
    <label className="field">현재 비밀번호<input className="input" type="password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></label>
    <label className="field">새 비밀번호<input className="input" type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label>
    <button className="btn" disabled={disabled || !currentPassword || !validServerPassword(newPassword)} onClick={() => void run(async () => {
      await request('/v2/auth/password', 'PUT', { current_password: currentPassword, new_password: newPassword })
      onSignedOut('비밀번호를 변경했어요. 새 비밀번호로 로그인해 주세요.')
    })}>비밀번호 변경</button>
    <p>탈퇴는 되돌릴 수 없으며 서버 정책에 따라 30일 뒤 계정과 기록이 삭제됩니다.</p>
    <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />탈퇴와 기록 삭제에 동의합니다</label>
    <button className="btn btn-danger" disabled={disabled || !currentPassword || !confirmed} onClick={() => void run(async () => {
      await request('/v2/auth/account', 'DELETE', { password: currentPassword })
      onSignedOut('서버에 탈퇴를 접수했어요.')
    })}>서버 계정 탈퇴</button>
  </div>
}
