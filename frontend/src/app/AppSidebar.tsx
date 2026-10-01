import { SignOut } from '@phosphor-icons/react'
import { NAVIGATION, SUB_TABS, type Page } from './navigation'

type Props = {
  page: Page
  measuring: boolean
  hasSession: boolean
  go: (page: Page) => void
  openCollection: () => void
  onLogout: () => void
  accountMode?: boolean
}

export function AppSidebar({
  page,
  measuring,
  hasSession,
  go,
  openCollection,
  onLogout,
  accountMode = false,
}: Props) {
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
        {NAVIGATION.filter(
          (item) =>
            !SUB_TABS[item.page] ||
            SUB_TABS[item.page]!.includes(page) ||
            (item.page === 'session' && measuring),
        ).map(({ page: id, label, icon: NavIcon }) => (
          <button
            className={SUB_TABS[id] ? 'nav-item nav-sub' : 'nav-item'}
            key={id}
            aria-current={page === id}
            onClick={() =>
              id === 'collection'
                ? openCollection()
                : go(id === 'session' && !hasSession ? 'setup' : id)
            }
          >
            <NavIcon
              size={SUB_TABS[id] ? 16 : 20}
              weight={page === id ? 'fill' : 'bold'}
              className="icon"
            />
            {label}
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <span>개인 기준 규칙 v0.1 · LSTM 미연결</span>
        <span>
          {accountMode ? '내 계정에 저장 · 서버 판정' : '로컬 저장 · 서버 판정 선택 가능'}
        </span>
        <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={onLogout}>
          <SignOut size={16} weight="bold" className="icon" />
          로그아웃
        </button>
      </div>
    </aside>
  )
}
