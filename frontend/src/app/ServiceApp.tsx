import { useRef, useState } from 'react'
import { useCamera } from '../hooks/useCamera'
import { useCollection } from '../hooks/useCollection'
import { SetupPage } from '../pages/SetupPage'
import { SettingsPage } from '../pages/SettingsPage'
import { LoginPage } from '../pages/LoginPage'
import { HomePage } from '../pages/HomePage'
import { DashboardPage } from '../pages/DashboardPage'
import { CollectionPage } from '../pages/CollectionPage'
import { LocalHistory } from '../features/history/LocalHistory'
import { ProfileFields } from '../features/profile/ProfileFields'
import { ProfilePage } from '../features/profile/ProfilePage'
import { useProfileForm } from '../features/profile/useProfileForm'
import { RecoveryNotice } from '../features/session/RecoveryNotice'
import { SessionPage } from '../features/session/SessionPage'
import { ServerSessionPage } from '../features/session/server/ServerSessionPage'
import { useSessionPersistence } from '../features/session/useSessionPersistence'
import type { ServiceSession } from '../features/session/types'
import { useLocalWorkspace } from '../features/storage/useLocalWorkspace'
import { KEYS, type Profile } from '../features/storage/types'
import { loadLocalState, writeLocal } from '../features/storage/localRepository'
import { DEFAULT_RULES } from '../data/posture'
import type { Rules } from '../lib/engine'
import { AppSidebar } from './AppSidebar'
import { StorageNotice } from './StorageNotice'
import { CAMERA_PAGES, type Page } from './navigation'

/** Compose feature controllers and screens; each feature owns its workflow. */
export default function ServiceApp() {
  const camera = useCamera()
  const [authed, setAuthed] = useState(false)
  const [page, setPage] = useState<Page>('home')
  const [error, setError] = useState('')
  const [registration, setRegistration] = useState(false)
  const [serverMode, setServerMode] = useState(false)
  const [session, setSession] = useState<ServiceSession | null>(null)
  const ended = useRef(false)
  const measuring = !!session && !ended.current
  const workspace = useLocalWorkspace(measuring, setError, reloadProfileFields)
  const { profile, records, rules, showDemo, draft, canWrite } = workspace
  const collection = useCollection(camera, rules)
  const persistence = useSessionPersistence({
    session,
    setSession,
    ended,
    workspace,
    camera,
    registration,
    serverMode,
    go,
    setError,
    onRegistrationComplete: () => setRegistration(false),
  })
  const form = useProfileForm({
    workspace,
    measuring,
    setError,
    hasPendingResult: () => !!persistence.pending.current,
    onWithdrawn: clearWorkspace,
  })
  const storageNotice = <StorageNotice workspace={workspace} />
  const profileFields = <ProfileFields form={form} canWrite={canWrite} />

  function reloadProfileFields(profile: Profile | null) {
    form.resetFields(profile)
  }

  // Keep a running session mounted when visiting another page.
  function go(next: Page) {
    setError('')
    if (!CAMERA_PAGES.includes(next) && !measuring) camera.stop()
    setPage(next)
  }

  function openCollection() {
    if (measuring) {
      setError('진행 중인 측정을 종료한 뒤 자세 등록으로 이동해 주세요.')
      return
    }
    go('collection')
  }

  function login() {
    if (profile && !canWrite) {
      setAuthed(true)
      setPage('home')
      return
    }
    if (!form.saveProfile(false)) return
    workspace.setDraft(loadLocalState().draft)
    setAuthed(true)
    setRegistration(!profile)
    setPage(profile ? 'home' : 'setup')
  }

  function logout() {
    if (persistence.pending.current) {
      setError('결과 저장을 완료한 뒤 나가 주세요.')
      return
    }
    camera.stop()
    setAuthed(false)
    setSession(null)
    workspace.setDraft(loadLocalState().draft)
  }

  function clearWorkspace() {
    camera.stop()
    workspace.setProfile(null)
    workspace.setRecords([])
    workspace.setDraft(null)
    workspace.setRules(DEFAULT_RULES)
    workspace.setShowDemo(false)
    persistence.clearSession()
    setRegistration(false)
    setAuthed(false)
  }

  function saveRules(next: Rules) {
    if (!workspace.requireWriter()) return
    try {
      writeLocal(KEYS.settings, next)
      workspace.setRules(next)
      setError('저장했습니다. 다음 측정부터 적용합니다.')
    } catch {
      setError('설정을 저장하지 못했습니다.')
    }
  }

  function saveDemoPreference(next: boolean) {
    if (!workspace.requireWriter()) return
    try {
      writeLocal(KEYS.demo, next)
      workspace.setShowDemo(next)
    } catch {
      setError('시연 옵션을 저장하지 못했습니다.')
    }
  }

  if (!authed) {
    const submitLabel = profile
      ? canWrite
        ? '내 프로필로 시작'
        : '저장된 프로필로 보기'
      : '프로필 만들고 시작'
    return (
      <LoginPage
        title={profile ? `${profile.name}님, 다시 오셨네요` : '시작하기'}
        lead="계정 서버 연결 전 미리보기입니다. 프로필과 측정 요약은 이 브라우저에만 저장합니다."
        submitLabel={submitLabel}
        fine="카메라는 ‘측정 준비’에서 직접 켤 때만 사용합니다. 카메라 없이도 홈과 저장된 기록을 볼 수 있습니다."
        onSubmit={login}
        footer={
          <>
            {storageNotice}
            {error && (
              <p role="alert" className="fine">
                {error}
              </p>
            )}
          </>
        }
      >
        {profileFields}
      </LoginPage>
    )
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
        page={page}
        measuring={measuring}
        hasSession={!!session}
        go={go}
        openCollection={openCollection}
        onLogout={logout}
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
              onServerMode={setServerMode}
              serverModeDisabled={registration || measuring}
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
                alertsOn={true}
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
          <SettingsPage
            serviceMode
            rules={rules}
            onRules={saveRules}
            alertsOn={true}
            onAlerts={() =>
              setError('화면 알림은 유지합니다. 소리만 측정 화면에서 끌 수 있습니다.')
            }
            hasHistory={showDemo}
            onHasHistory={saveDemoPreference}
          />
        )}
        {page === 'profile' && (
          <ProfilePage
            form={form}
            profileFields={profileFields}
            canWrite={canWrite}
            measuring={measuring}
            hasPendingResult={!!persistence.pending.current}
            onSettings={() => go('settings')}
          />
        )}
      </main>
    </div>
  )
}
