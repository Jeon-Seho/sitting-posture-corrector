import type { ReactNode } from 'react'
import type { CameraController } from '../hooks/useCamera'
import type { CollectionController } from '../hooks/useCollection'
import { SetupPage } from '../pages/SetupPage'
import { SettingsPage } from '../pages/SettingsPage'
import { HomePage } from '../pages/HomePage'
import { DashboardPage } from '../pages/DashboardPage'
import { CollectionPage } from '../pages/CollectionPage'
import { LocalHistory } from '../features/history/LocalHistory'
import { RecoveryNotice } from '../features/session/RecoveryNotice'
import { SessionPage } from '../features/session/SessionPage'
import { ServerSessionPage } from '../features/session/server/ServerSessionPage'
import type { useSessionPersistence } from '../features/session/useSessionPersistence'
import type { ServiceSession } from '../features/session/types'
import type { LocalWorkspace } from '../features/storage/useLocalWorkspace'
import type { Rules } from '../lib/engine'
import { AppSidebar } from './AppSidebar'
import type { Page } from './navigation'

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
}

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
}: Props) {
  const { profile, records, rules, showDemo, draft, canWrite } = workspace
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
        page={page}
        measuring={measuring}
        hasSession={!!session}
        go={go}
        openCollection={openCollection}
        onLogout={logout}
        accountMode={accountMode}
      />
      <main className="main service-main">
        {storageNotice}
        {error && (
          <p role="status" className="service-notice">
            {error}
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
        {showDemo && page === 'home' && (
          <HomePage
            hasHistory
            onStart={() => go(measuring ? 'session' : 'setup')}
            onDashboard={() => go('dashboard')}
          />
        )}
        {showDemo && page === 'dashboard' && <DashboardPage />}
        {page === 'collection' && <CollectionPage camera={camera} collection={collection} />}
        {!showDemo && (page === 'home' || page === 'dashboard') && (
          <LocalHistory
            page={page}
            name={profile?.name ?? ''}
            records={records}
            measuring={measuring}
            onStart={() => go(measuring ? 'session' : 'setup')}
            accountMode={accountMode}
            onRegister={() => {
              setRegistration(true)
              go('setup')
            }}
          />
        )}
        {page === 'setup' && (
          <>
            <SetupPage
              startLabel={registration ? '등록 완료 · 홈으로' : '측정 시작'}
              camera={camera}
              onStart={persistence.start}
              onCollect={openCollection}
              serverMode={serverMode}
              onServerMode={onServerMode}
              serverModeDisabled={registration || measuring}
              accountMode={accountMode}
              onCancel={() => {
                camera.cancelCalibration()
                go('home')
              }}
            />
            {registration && (
              <p>
                개인 기준 자료는 현재 카메라 연결에서만 유지됩니다. 카메라를 다시 연결하면 새 기준을
                등록해야 합니다.
              </p>
            )}
          </>
        )}
        {session && (
          <section hidden={page !== 'session'}>
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
                  active: page === 'session',
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
                  active: page === 'session',
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
        {page === 'settings' && (
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
            />
          </fieldset>
        )}
        {page === 'profile' && profilePage}
      </main>
    </div>
  )
}
