export type ServicePage = 'home' | 'setup' | 'session' | 'dashboard' | 'settings' | 'profile'

const NAV: [ServicePage, string][] = [
  ['home', '홈'],
  ['setup', '측정 준비'],
  ['session', '실시간 측정'],
  ['dashboard', '대시보드'],
  ['settings', '측정 설정'],
]

export function ServiceSidebar({ page, onNavigate, measuring, onExit }: {
  page: ServicePage
  onNavigate: (page: ServicePage) => void
  /** 진행 중인 측정이 있으면 연구 화면 이동 전에 확인한다. */
  measuring: boolean
  onExit: () => void
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">PG</span>
        <div>
          <div className="brand-name">POSEGOOD</div>
          <div className="brand-sub">내 기준으로, 꾸준히</div>
        </div>
      </div>
      <nav className="nav" aria-label="주요 화면">
        {NAV.map(([id, label]) => (
          <button className="nav-item" key={id} aria-current={page === id} onClick={() => onNavigate(id)}>{label}</button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <span>로컬 미리보기 · 서버 미연결</span>
        <a className="sidebar-link" href="?research=1" onClick={e => {
          if (measuring && !confirm('연구 화면으로 이동하면 현재 측정이 중단됩니다. 중간 저장 지점에서 복구할 수 있습니다. 이동할까요?')) e.preventDefault()
        }}>연구·라벨 수집</a>
        <button className="btn" onClick={onExit}>나가기</button>
      </div>
    </aside>
  )
}
