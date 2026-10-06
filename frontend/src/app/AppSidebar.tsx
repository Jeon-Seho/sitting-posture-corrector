import { useEffect, useRef, useState } from 'react'
import { CaretUp, SignOut, UserCircle } from '@phosphor-icons/react'
import { BrandMark } from '../components/BrandMark'
import { ThumbLayer, useSlidingThumb } from '../components/Segmented'
import { formatDuration } from '../lib/stats'
import { NAV_TABS, tabOf, type Page, type Tab } from './navigation'

type Props = {
  page: Page
  measuring: boolean
  go: (tab: Tab) => void
  onLogout: () => void
  onProfile: () => void
  name: string
  today: { rate: number | null; valid: number }
  /** Opens today's records. */
  onToday?: () => void
}

export function AppSidebar({ page, measuring, go, onLogout, onProfile, name, today, onToday }: Props) {
  const current = tabOf(page)
  const { ref, thumb } = useSlidingThumb<HTMLElement>('[aria-current="true"]')
  return (
    <aside className="sidebar">
      <div className="brand">
        <BrandMark />
        <div>
          <div className="brand-name">PoseGood</div>
          <div className="brand-sub">바른자세 도우미</div>
        </div>
      </div>
      <nav ref={ref} className={`nav ${thumb ? 'has-thumb' : ''}`} aria-label="주요 화면">
        <ThumbLayer thumb={thumb} className="nav-thumb" />
        {NAV_TABS.map(({ tab, label, icon: TabIcon }) => (
          <button className="nav-item" key={tab} aria-current={current === tab} onClick={() => go(tab)}>
            <TabIcon size={20} weight={current === tab ? 'fill' : 'bold'} className="icon" />
            {label}
            {tab === 'measure' && measuring && <span className="nav-live" aria-label="측정 중" />}
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <button
          type="button"
          className="today-card"
          onClick={onToday ?? (() => go('records'))}
          aria-label="오늘 측정 기록 보기"
        >
          <div className="today-card-label">오늘 바른 자세</div>
          {today.rate === null ? (
            <p className="today-card-empty">오늘 측정을 마치면 여기에 보여요</p>
          ) : (
            <>
              <div className="today-card-value">
                {Math.round(today.rate * 100)}
                <small>%</small>
              </div>
              <div className="meter" style={{ marginTop: 10, height: 6 }}>
                <span style={{ width: `${today.rate * 100}%`, background: 'var(--good)' }} />
              </div>
              <p className="today-card-empty">{formatDuration(today.valid)} 측정</p>
            </>
          )}
        </button>
        <AccountMenu name={name} active={page === 'profile'} onProfile={onProfile} onLogout={onLogout} />
      </div>
    </aside>
  )
}

/**
 * The account chip opens a small menu above itself: profile settings closest to the
 * chip, sign-out on top in a warm red so leaving reads differently from navigating.
 */
function AccountMenu({
  name,
  active,
  onProfile,
  onLogout,
}: {
  name: string
  active: boolean
  onProfile: () => void
  onLogout: () => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  const pick = (action: () => void) => () => {
    setOpen(false)
    action()
  }
  return (
    <div className="me" ref={root}>
      {open && (
        <div className="me-menu" role="menu" aria-label="계정 메뉴">
          <button className="me-menu-item is-danger" role="menuitem" onClick={pick(onLogout)}>
            <SignOut size={18} weight="bold" className="icon" />
            로그아웃
          </button>
          <button className="me-menu-item" role="menuitem" onClick={pick(onProfile)}>
            <UserCircle size={18} weight="bold" className="icon" />
            프로필 설정
          </button>
        </div>
      )}
      <button
        className="me-profile"
        aria-current={active}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${name || '내 계정'} 계정 메뉴`}
        onClick={() => setOpen((old) => !old)}
      >
        <span className="avatar" aria-hidden="true">
          {name.trim().slice(0, 1) || '나'}
        </span>
        <span className="me-name">{name || '내 계정'}</span>
        <CaretUp size={14} weight="bold" className="icon me-caret" />
      </button>
    </div>
  )
}
