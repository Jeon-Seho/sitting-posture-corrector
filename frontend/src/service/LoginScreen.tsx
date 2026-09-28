import type { Profile } from '../lib/serviceStore'
import { ProfileFields } from './ProfileFields'

export function LoginScreen({ hasProfile, form, onForm, onSubmit, error }: {
  hasProfile: boolean
  form: Profile
  onForm: (next: Profile) => void
  onSubmit: () => void
  error: string
}) {
  return (
    <div className="service-login">
      <div className="service-login-card">
        <div className="brand-name">POSEGOOD / V2</div>
        <h1>내 자세를 알아가는 시간</h1>
        <p>계정 서버 연결 전 미리보기입니다. 프로필과 측정 요약은 이 브라우저에만 저장합니다.</p>
        <form onSubmit={e => { e.preventDefault(); onSubmit() }}>
          <ProfileFields value={form} onChange={onForm} />
          <p className="fine">시작하면 카메라 준비를 요청합니다. 허용하지 않아도 홈과 시연을 이용할 수 있습니다.</p>
          <button className="btn btn-primary btn-lg" type="submit">{hasProfile ? '내 프로필로 시작' : '프로필 만들고 시작'}</button>
        </form>
        {error && <p role="alert">{error}</p>}
        <a href="?research=1">기존 연구·라벨 수집 화면</a>
      </div>
    </div>
  )
}
