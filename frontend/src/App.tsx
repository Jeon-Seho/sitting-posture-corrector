import { useState } from 'react'
import { DEFAULT_RULES, MODEL_VERSION } from './data/posture'
import { LoginPage } from './pages/LoginPage'
import { HomePage } from './pages/HomePage'
import { SetupPage } from './pages/SetupPage'
import { SessionPage } from './pages/SessionPage'
import { DashboardPage } from './pages/DashboardPage'
import { SettingsPage } from './pages/SettingsPage'

type Route = 'home' | 'setup' | 'session' | 'dashboard' | 'settings'

const NAV: { id: Route; label: string }[] = [
  { id: 'home', label: '홈' },
  { id: 'setup', label: '측정 준비' },
  { id: 'session', label: '실시간 측정' },
  { id: 'dashboard', label: '대시보드' },
  { id: 'settings', label: '설정' },
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
          <span className="brand-mark">P</span>
          <div>
            <div className="brand-name">PoseGood</div>
            <div className="brand-sub">자세 붕괴 주기 분석</div>
          </div>
        </div>

        <nav className="nav">
          <div className="nav-label">측정</div>
          {NAV.map((n) => (
            <button
              key={n.id}
              className="nav-item"
              aria-current={route === n.id}
              onClick={() => setRoute(n.id)}
            >
              <span className="dot" />
              {n.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span>모델 {MODEL_VERSION}</span>
          <span>발표용 UI 데모 · 실제 카메라 미사용</span>
          <button
            className="btn btn-sm"
            style={{ marginTop: 8 }}
            onClick={() => {
              setAuthed(false)
              setRoute('home')
            }}
          >
            로그아웃
          </button>
        </div>
      </aside>

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
