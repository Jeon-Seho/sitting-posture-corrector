import { useState } from 'react'
import { useCollection } from './hooks/useCollection'
import { CollectionPanel } from './components/CollectionPanel'
import { CollectionPage } from './pages/CollectionPage'
import { useCamera } from './hooks/useCamera'
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

type Route = 'home' | 'setup' | 'session' | 'collection' | 'dashboard' | 'settings'

const NAV: { id: Route; label: string; icon: Icon }[] = [
  { id: 'home', label: '홈', icon: House },
  { id: 'setup', label: '측정 준비', icon: Crosshair },
  { id: 'session', label: '실시간 측정', icon: Record },
  { id: 'collection', label: '라벨 수집', icon: Record },
  { id: 'dashboard', label: '대시보드', icon: ChartBar },
  { id: 'settings', label: '설정', icon: GearSix },
]

export default function App() {
  const camera = useCamera()
  const [mode, setMode] = useState<'camera' | 'demo'>('camera')
  const [authed, setAuthed] = useState(false)
  const [route, setRoute] = useState<Route>('home')
  const [hasHistory, setHasHistory] = useState(true)
  const [rules, setRules] = useState(DEFAULT_RULES)
  const [alertsOn, setAlertsOn] = useState(true)
  const collection = useCollection(camera, rules)

  const navigate = (next: Route) => {
    if (next === route) return
    collection.setPhase('inactive')
    if (next === 'session' && mode === 'camera' && !camera.baseline) { setRoute('setup'); return }
    if (next === 'collection') setMode('camera')
    if (next !== 'setup' && next !== 'session' && next !== 'collection') camera.stop()
    if ((route === 'session' || route === 'collection') && next === 'setup') camera.stop()
    setRoute(next)
  }

  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} />

  return (
    <div className="shell">
      <video ref={camera.videoRef} className="capture-source" muted playsInline aria-hidden="true" />
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
              onClick={() => navigate(id)}
            >
              <NavIcon size={20} weight={route === id ? 'fill' : 'bold'} className="icon" />
              {label}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span>{mode === 'camera' ? '개인 기준 규칙 v0.1 · LSTM 미연결' : `시연 데이터 ${MODEL_VERSION}`}</span>
          <span>{mode === 'camera' ? 'MediaPipe Heavy · 좌표 수집은 직접 시작' : '발표용 합성 시나리오'}</span>
          <button
            className="btn btn-sm"
            style={{ marginTop: 10 }}
            onClick={() => {
              collection.setPhase('inactive')
              camera.stop()
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
            onStart={() => navigate('setup')}
            onDashboard={() => navigate('dashboard')}
          />
        )}
        {route === 'setup' && (
          <SetupPage camera={camera} mode={mode} onMode={(next) => { if (next !== mode) { camera.stop(); setMode(next) } }} onStart={() => navigate('session')} onCollect={() => navigate('collection')} onCancel={() => navigate('home')} />
        )}
        {route === 'session' && (
          <SessionPage
            collection={collection}
            camera={camera}
            mode={mode}
            rules={rules}
            alertsOn={alertsOn}
            onFinish={() => navigate('home')}
            onPrepare={() => navigate('setup')}
            onDashboard={() => navigate('dashboard')}
          />
        )}
        {route === 'dashboard' && <DashboardPage />}
        {route === 'collection' && <CollectionPage camera={camera} collection={collection} onPrepare={() => navigate('setup')} />}
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
        {route !== 'collection' && !(route === 'session' && mode === 'camera') && collection.hasCapture && <CollectionPanel collection={collection} />}
      </main>
    </div>
  )
}
