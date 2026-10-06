import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, X } from '@phosphor-icons/react'
import type { CameraController } from '../hooks/useCamera'
import type { CollectionController } from '../hooks/useCollection'
import { SetupPage } from '../pages/SetupPage'
import { SettingsPage } from '../pages/SettingsPage'
import { DashboardPage } from '../pages/DashboardPage'
import { CollectionPage } from '../pages/CollectionPage'
import { CameraWindow } from '../features/camera/CameraWindow'
import { useLaunchAutomation } from '../features/desktop/useLaunchAutomation'
import { LocalHistory } from '../features/history/LocalHistory'
import { RecoveryNotice } from '../features/session/RecoveryNotice'
import { SessionPage } from '../features/session/SessionPage'
import { ServerSessionPage } from '../features/session/server/ServerSessionPage'
import type { useSessionPersistence } from '../features/session/useSessionPersistence'
import type { ServiceSession } from '../features/session/types'
import type { LocalWorkspace } from '../features/storage/useLocalWorkspace'
import type { Rules } from '../lib/engine'
import { historyFor } from '../lib/history'
import { summary } from '../lib/serviceStore'
import { AppSidebar } from './AppSidebar'
import { CAMERA_PAGES, resolvePage, type Page, type Tab } from './navigation'

type Props = {
  camera: CameraController
  collection: CollectionController
  workspace: LocalWorkspace
  persistence: ReturnType<typeof useSessionPersistence>
  session: ServiceSession | null
  page: Page
  error: string
  registration: boolean
  measuring: boolean
  serverMode: boolean
  onServerMode: (enabled: boolean) => void
  setRegistration: (enabled: boolean) => void
  go: (page: Page) => void
  openCollection: () => void
  logout: () => void
  saveRules: (rules: Rules) => void
  saveDemoPreference: (enabled: boolean) => void
  storageNotice: ReactNode
  profilePage: ReactNode
  accountMode?: boolean
  alertsOn?: boolean
  onAlerts?: (enabled: boolean) => void
  settingsDisabled?: boolean
  /** Clears the floating notice (auto after a few seconds, or with its close button). */
  onClearError?: () => void
}

const NOTICE_MS = 6000

/** The local prototype and signed-in account share measurement/history presentation. */
export function ServiceScreens({
  camera,
  collection,
  workspace,
  persistence,
  session,
  page,
  error,
  registration,
  measuring,
  serverMode,
  onServerMode,
  setRegistration,
  go,
  openCollection,
  logout,
  saveRules,
  saveDemoPreference,
  storageNotice,
  profilePage,
  accountMode = false,
  alertsOn = true,
  onAlerts = () => {},
  settingsDisabled = false,
  onClearError,
}: Props) {
  const { profile, records, rules, showDemo, draft, canWrite } = workspace
  const view = resolvePage(page, measuring)
  // Each click on the sidebar's today card reopens records on the "today" period.
  const [todayRequest, setTodayRequest] = useState(0)
  const today = summary(historyFor(records, 'all', 'today'))
  useLaunchAutomation({ camera, ready: !measuring && view === 'setup' })
  // Each screen opens at its top instead of inheriting the previous tab's scroll.
  const main = useRef<HTMLElement>(null)
  useEffect(() => {
    if (main.current) main.current.scrollTop = 0
  }, [view])
  useEffect(() => {
    if (!error || !onClearError) return
    const timer = setTimeout(onClearError, NOTICE_MS)
    return () => clearTimeout(timer)
  }, [error, onClearError])

  function openTab(tab: Tab) {
    if (tab === 'measure') go(measuring ? 'session' : 'setup')
    else go(tab === 'records' ? 'dashboard' : 'settings')
  }

  function registerAgain() {
    setRegistration(true)
    go('setup')
  }

  return (
    <div className="shell">
      <video
        ref={camera.videoRef}
        className="capture-source"
        muted
        playsInline
        aria-hidden="true"
      />
      <AppSidebar
        page={view}
        measuring={measuring}
        go={openTab}
        onToday={() => {
          setTodayRequest((n) => n + 1)
          go('dashboard')
        }}
        onLogout={logout}
        onProfile={() => go('profile')}
        name={profile?.name ?? ''}
        today={{ rate: today.rate, valid: today.valid }}
      />
      <main ref={main} className="main service-main">
        {storageNotice}
        {error && (
          <p role="status" className="service-notice">
            {error}
            {onClearError && (
              <button className="btn btn-quiet btn-icon btn-sm" aria-label="알림 닫기" onClick={onClearError}>
                <X size={16} weight="bold" />
              </button>
            )}
          </p>
        )}
        {draft && !session && (
          <RecoveryNotice
            draft={draft}
            canWrite={canWrite}
            hasPendingResult={!!persistence.pending.current}
            saveMessage={persistence.saveMessage}
            onRestore={persistence.restore}
            onFinish={persistence.finishDraft}
            accountMode={accountMode}
          />
        )}
        {view === 'dashboard' &&
          (showDemo ? (
            <DashboardPage />
          ) : (
            <LocalHistory
              key={todayRequest}
              initialPeriod={todayRequest ? 'today' : 'week'}
              records={records}
              measuring={measuring}
              onStart={() => go(measuring ? 'session' : 'setup')}
              accountMode={accountMode}
            />
          ))}
        {view === 'collection' && (
          <>
            <div className="page-actions">
              <button className="btn btn-sm" onClick={() => go('settings')}>
                <ArrowLeft size={16} weight="bold" className="icon" />
                설정으로
              </button>
            </div>
            <CollectionPage camera={camera} collection={collection} />
          </>
        )}
        {view === 'setup' && (
          <SetupPage
            startLabel={registration ? '등록 완료' : '측정 시작'}
            camera={camera}
            onStart={persistence.start}
            onCollect={openCollection}
            serverMode={serverMode}
            onServerMode={onServerMode}
            serverModeDisabled={registration || measuring}
            accountMode={accountMode}
            onCancel={() => {
              camera.cancelCalibration()
              go('dashboard')
            }}
          />
        )}
        {session && (
          <section className="session-slot" hidden={view !== 'session'}>
            {session.server ? (
              <ServerSessionPage
                key={session.id}
                session={{ ...session, server: session.server }}
                camera={camera}
                accountMode={accountMode}
                alertsOn={alertsOn}
                onFinish={() => go('home')}
                onDashboard={() => go('dashboard')}
                onPrepare={() => go('setup')}
                service={{
                  active: view === 'session',
                  onCheckpoint: persistence.checkpoint,
                  onEnded: persistence.finish,
                  onArchive: persistence.archiveServerResult,
                  saveMessage: persistence.saveMessage,
                  onRetry: persistence.retrySave,
                }}
              />
            ) : (
              <SessionPage
                key={session.id}
                camera={camera}
                collection={collection}
                mode={session.mode}
                rules={session.rules}
                alertsOn={alertsOn}
                onFinish={() => go('home')}
                onDashboard={() => go('dashboard')}
                onPrepare={() => go('setup')}
                service={{
                  active: view === 'session',
                  initial: session.initial,
                  onCheckpoint: persistence.checkpoint,
                  onEnded: persistence.finish,
                  saveMessage: persistence.saveMessage,
                  onRetry: persistence.retrySave,
                }}
              />
            )}
          </section>
        )}
        {view === 'settings' && (
          <fieldset className="account-fieldset" disabled={settingsDisabled}>
            <SettingsPage
              serviceMode
              rules={rules}
              onRules={saveRules}
              alertsOn={alertsOn}
              onAlerts={onAlerts}
              accountMode={accountMode}
              hasHistory={showDemo}
              onHasHistory={saveDemoPreference}
              account={{
                name: profile?.name ?? '',
                detail: accountMode ? '내 계정에 저장' : '이 기기에만 저장',
                onProfile: () => go('profile'),
                onLogout: logout,
              }}
              onRegisterAgain={registerAgain}
              onCollect={openCollection}
            />
          </fieldset>
        )}
        {view === 'profile' && profilePage}
      </main>
      <CameraWindow camera={camera} floating={!CAMERA_PAGES.includes(view)} />
    </div>
  )
}
