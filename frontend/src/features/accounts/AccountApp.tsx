import { useRef, useState } from 'react'
import type { CameraController } from '../../hooks/useCamera'
import { useCollection } from '../../hooks/useCollection'
import { ServiceScreens } from '../../app/ServiceScreens'
import { StorageNotice } from '../../app/StorageNotice'
import { CAMERA_PAGES, type Page } from '../../app/navigation'
import { useSessionPersistence } from '../session/useSessionPersistence'
import type { ServiceSession } from '../session/types'
import { AccountLoginPage } from './AccountLoginPage'
import { AccountProfilePage } from './AccountProfilePage'
import { useAccountAuth } from './useAccountAuth'
import { useRemoteWorkspace } from './useRemoteWorkspace'
import type { AccountUser, AccountWorkspace } from './contracts'
import { accountError } from './client'

export function AccountApp({ camera }: { camera: CameraController }) {
  const auth = useAccountAuth(() => camera.stop())
  if (auth.status === 'loading')
    return (
      <main className="account-loading" role="status">
        로그인을 확인하고 있습니다.
      </main>
    )
  if (!auth.user || !auth.workspace)
    return (
      <AccountLoginPage
        busy={auth.busy}
        message={auth.message}
        onAuthenticate={auth.authenticate}
      />
    )
  return (
    <AccountWorkspaceApp
      key={auth.user.user_id}
      camera={camera}
      user={auth.user}
      initial={auth.workspace}
      onLogout={auth.logout}
      onDeleted={auth.deleted}
      onPasswordChanged={auth.passwordChanged}
    />
  )
}

type WorkspaceProps = {
  camera: CameraController
  user: AccountUser
  initial: AccountWorkspace
  onLogout: () => Promise<void>
  onDeleted: () => void
  onPasswordChanged: () => void
}

function AccountWorkspaceApp({
  camera,
  user,
  initial,
  onLogout,
  onDeleted,
  onPasswordChanged,
}: WorkspaceProps) {
  const [page, setPage] = useState<Page>('home')
  const [error, setError] = useState('')
  const [registration, setRegistration] = useState(false)
  const [session, setSession] = useState<ServiceSession | null>(null)
  const ended = useRef(false)
  const loggingOut = useRef(false)
  const measuring = !!session && !ended.current
  const remote = useRemoteWorkspace(user.user_id, initial, setError)
  const workspace = remote.workspace
  const collection = useCollection(camera, workspace.rules)
  const persistence = useSessionPersistence({
    session,
    setSession,
    ended,
    workspace,
    camera,
    registration,
    serverMode: true,
    repository: remote.repository,
    onRegistrationComplete: () => setRegistration(false),
    go,
    setError,
  })

  function go(next: Page) {
    setError('')
    if (!CAMERA_PAGES.includes(next) && !measuring) camera.cancelCalibration()
    setPage(next)
  }

  function openCollection() {
    if (measuring) {
      setError('진행 중인 측정을 종료한 뒤 자세 등록으로 이동해 주세요.')
      return
    }
    go('collection')
  }

  async function logout() {
    if (loggingOut.current) return
    if (persistence.pending.current) {
      setError('결과 저장을 완료한 뒤 로그아웃해 주세요.')
      return
    }
    loggingOut.current = true
    camera.stop()
    setSession(null)
    try {
      await onLogout()
    } catch (failure) {
      setPage('home')
      workspace.reloadStorage()
      setError(accountError(failure))
      loggingOut.current = false
    }
  }

  return (
    <ServiceScreens
      camera={camera}
      collection={collection}
      workspace={workspace}
      persistence={persistence}
      session={session}
      page={page}
      error={error}
      registration={registration}
      measuring={measuring}
      serverMode
      accountMode
      onServerMode={() => {}}
      setRegistration={setRegistration}
      go={go}
      openCollection={openCollection}
      logout={() => void logout()}
      saveRules={(rules) => {
        void remote.update({ rules }).catch(() => {})
      }}
      saveDemoPreference={(show_demo) => {
        void remote
          .update({ preferences: { show_demo, alerts_on: remote.alertsOn } })
          .catch(() => {})
      }}
      alertsOn={remote.alertsOn}
      onAlerts={(alerts_on) => {
        void remote
          .update({ preferences: { show_demo: workspace.showDemo, alerts_on } })
          .catch(() => {})
      }}
      settingsDisabled={remote.saving}
      storageNotice={
        <>
          <StorageNotice workspace={workspace} />
          {remote.saving && <p role="status">설정을 저장하고 있습니다.</p>}
        </>
      }
      profilePage={
        <AccountProfilePage
          userId={user.user_id}
          email={user.email}
          profile={workspace.profile!}
          canWrite={workspace.canWrite}
          measuring={measuring}
          hasPendingResult={!!persistence.pending.current}
          onSave={(profile) => remote.update({ profile })}
          onSettings={() => go('settings')}
          onPasswordChanged={onPasswordChanged}
          onDeleted={() => {
            camera.stop()
            try {
              remote.storage.clear()
            } catch {
              /* Deleted accounts cannot reload this retry material. */
            }
            onDeleted()
          }}
        />
      }
    />
  )
}
