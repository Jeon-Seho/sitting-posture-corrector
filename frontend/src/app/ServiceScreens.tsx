import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { ArrowLeft, CheckCircle, WarningCircle, X } from '@phosphor-icons/react'
import type { CameraController } from '../hooks/useCamera'
import type { CollectionController } from '../hooks/useCollection'
import { SetupPage } from '../pages/SetupPage'
import { SettingsPage } from '../pages/SettingsPage'
import { exampleRecords } from '../data/exampleRecords'
import { CollectionPage } from '../pages/CollectionPage'
import { CameraWindow } from '../features/camera/CameraWindow'
import { useLaunchAutomation } from '../features/desktop/useLaunchAutomation'
import { LocalHistory } from '../features/history/LocalHistory'
import { RecordCalendarPage } from '../features/history/RecordCalendarPage'
import { LiveSessionPage } from '../features/session/live/LiveSessionPage'
import type { useSessionPersistence } from '../features/session/useSessionPersistence'
import type { ServiceSession } from '../features/session/types'
import type { LocalWorkspace } from '../features/storage/useLocalWorkspace'
import type { Rules } from '../lib/engine'
import { historyFor } from '../lib/history'
import { daySessionNumber, sessionLabel } from '../lib/sessionNumber'
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
  measuring: boolean
  go: (page: Page) => void
  openCollection: () => void
  logout: () => void
  saveRules: (rules: Rules) => void
  saveDemoPreference: (enabled: boolean) => void
  storageNotice: ReactNode
  profilePage: ReactNode
  alertsOn?: boolean
  onAlerts?: (enabled: boolean) => void
  settingsDisabled?: boolean
  /** Clears the floating notice (auto after a few seconds, or with its close button). */
  onClearError?: () => void
}

const NOTICE_MS = 6000

/** Problems get the warm warning icon; greetings and confirmations get the check. */
function noticeTone(text: string) {
  return /못했|못 했|실패|없어요|없습니다|확인해 주세요|마친 뒤|다시 시도|오류|할 수 없/.test(text) ? 'is-warn' : 'is-ok'
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
  measuring,
  go,
  openCollection,
  logout,
  saveRules,
  saveDemoPreference,
  storageNotice,
  profilePage,
  alertsOn = true,
  onAlerts = () => {},
  settingsDisabled = false,
  onClearError,
}: Props) {
  const { profile, records, rules, showDemo } = workspace
  const view = resolvePage(page, measuring)
  // 발표용 예시 기록: the same 기록·달력 screens, fed with fixed example records (never stored).
  const example = useMemo(() => (showDemo ? exampleRecords() : null), [showDemo])
  const shownRecords = example ?? records
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
    else go(tab === 'records' ? 'dashboard' : tab === 'calendar' ? 'calendar' : 'settings')
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
        onLogout={logout}
        onProfile={() => go('profile')}
        name={profile?.name ?? ''}
        today={{ rate: today.rate, valid: today.valid }}
        onToday={() => go('dashboard')}
      />
      <main ref={main} className="main service-main">
        {storageNotice}
        {error && (
          <p role="status" className={`service-notice ${noticeTone(error)}`}>
            {noticeTone(error) === 'is-warn' ? (
              <WarningCircle size={20} weight="fill" className="icon" />
            ) : (
              <CheckCircle size={20} weight="fill" className="icon" />
            )}
            <span>{error}</span>
            {onClearError && (
              <button className="snack-close" aria-label="알림 닫기" onClick={onClearError}>
                <X size={16} weight="bold" />
              </button>
            )}
          </p>
        )}
        {view === 'dashboard' && (
          <LocalHistory
            records={shownRecords}
            example={!!example}
            measuring={measuring}
            onStart={() => go(measuring ? 'session' : 'setup')}
            onCalendar={() => go('calendar')}
          />
        )}
        {view === 'calendar' && (
          <RecordCalendarPage
            records={shownRecords}
            example={!!example}
          />
        )}
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
        {(view === 'setup' || view === 'posture') && (
          <SetupPage
            key={view}
            camera={camera}
            onStart={persistence.start}
            onCollect={openCollection}
            measuring={measuring}
            registerAgain={view === 'posture'}
            onBack={view === 'posture' ? () => go('settings') : undefined}
            onOpenSession={() => go('session')}
          />
        )}
        {session && (
          <section className="session-slot" hidden={view !== 'session'}>
            <LiveSessionPage
              key={session.id}
              session={session}
              camera={camera}
              alertsOn={alertsOn}
              onDashboard={() => go('dashboard')}
              onPrepare={() => go('setup')}
              service={{
                active: view === 'session',
                onEnded: persistence.finish,
                sessionLabel: sessionLabel(
                  session.startedAt,
                  daySessionNumber(
                    records.filter((record) => record.id !== session.id).map((record) => record.startedAt),
                    session.startedAt,
                  ),
                ),
              }}
            />
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
              hasHistory={showDemo}
              onHasHistory={saveDemoPreference}
              account={{
                name: profile?.name ?? '',
                detail: '이 기기에만 저장',
                onProfile: () => go('profile'),
                onLogout: logout,
              }}
              onRegisterAgain={() => go('posture')}
              camera={camera}
              onCollect={openCollection}
            />
          </fieldset>
        )}
        {view === 'profile' && profilePage}
      </main>
      <CameraWindow
        camera={camera}
        floating={!CAMERA_PAGES.includes(view)}
        onExpand={() => go(measuring ? 'session' : 'setup')}
        measuring={measuring}
      />
    </div>
  )
}
