import { useState } from 'react'
import {
  ChartBar,
  Crosshair,
  GearSix,
  House,
  Record,
  SignOut,
  type Icon,
} from '@phosphor-icons/react'
import { DEFAULT_RULES, MODEL_VERSION } from './data/posture'
import { Rings } from './components/ui'
import { LoginPage } from './pages/LoginPage'
import { HomePage } from './pages/HomePage'
import { SetupPage } from './pages/SetupPage'
import { SessionPage } from './pages/SessionPage'
import { DashboardPage } from './pages/DashboardPage'
import { SettingsPage } from './pages/SettingsPage'

type Route = 'home' | 'setup' | 'session' | 'dashboard' | 'settings'

const NAV: { id: Route; label: string; icon: Icon }[] = [
  { id: 'home', label: '홈', icon: House },
  { id: 'setup', label: '측정 준비', icon: Crosshair },
  { id: 'session', label: '실시간 측정', icon: Record },
  { id: 'dashboard', label: '대시보드', icon: ChartBar },
  { id: 'settings', label: '설정', icon: GearSix },
]

export default function App() {
  const [authed, setAuthed] = useState(false)
  const [route, setRoute] = useState<Route>('home')
  const [hasHistory, setHasHistory] = useState(true)
  const [rules, setRules] = useState(DEFAULT_RULES)
  const [alertsOn, setAlertsOn] = useState(true)

  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} />

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">PG</span>
          <div>
            <div className="brand-name">POSEGOOD</div>
            <div className="brand-sub">자세 붕괴 주기 분석</div>
          </div>
        </div>

        <nav className="nav" aria-label="주요 화면">
          {NAV.map(({ id, label, icon: NavIcon }) => (
            <button
              key={id}
              className="nav-item"
              aria-current={route === id}
              onClick={() => setRoute(id)}
            >
              <NavIcon size={20} weight={route === id ? 'fill' : 'bold'} className="icon" />
              {label}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span>모델 {MODEL_VERSION}</span>
          <span>발표용 UI 데모 · 실제 카메라 미사용</span>
          <button
            className="btn btn-sm"
            style={{ marginTop: 10 }}
            onClick={() => {
              setAuthed(false)
              setRoute('home')
            }}
          >
            <SignOut size={16} weight="bold" className="icon" />
            로그아웃
          </button>
        </div>
      </aside>

      <Rings count={5} />

      <main className="main">
        {route === 'home' && (
          <HomePage
            hasHistory={hasHistory}
            onStart={() => setRoute('setup')}
            onDashboard={() => setRoute('dashboard')}
          />
        )}
        {route === 'setup' && (
          <SetupPage onStart={() => setRoute('session')} onCancel={() => setRoute('home')} />
        )}
        {route === 'session' && (
          <SessionPage
            rules={rules}
            alertsOn={alertsOn}
            onFinish={() => setRoute('home')}
            onDashboard={() => setRoute('dashboard')}
          />
        )}
        {route === 'dashboard' && <DashboardPage />}
        {route === 'settings' && (
          <SettingsPage
            rules={rules}
            onRules={setRules}
            alertsOn={alertsOn}
            onAlerts={setAlertsOn}
            hasHistory={hasHistory}
            onHasHistory={setHasHistory}
          />
        )}
      </main>
    </div>
  )
}
