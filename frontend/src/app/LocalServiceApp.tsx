import type { CameraController } from '../hooks/useCamera'
import { ServiceScreens } from './ServiceScreens'
import { CollectionEntry } from './CollectionEntry'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useCollection } from '../hooks/useCollection'
import { LoginPage } from '../pages/LoginPage'
import { ProfileFields } from '../features/profile/ProfileFields'
import { ProfilePage } from '../features/profile/ProfilePage'
import { useProfileForm } from '../features/profile/useProfileForm'
import { useSessionPersistence } from '../features/session/useSessionPersistence'
import type { ServiceSession } from '../features/session/types'
import { useLocalWorkspace } from '../features/storage/useLocalWorkspace'
import { KEYS, type Profile } from '../features/storage/types'
import { loadLocalState, writeLocal } from '../features/storage/localRepository'
import { DEFAULT_RULES } from '../data/posture'
import type { Rules } from '../lib/engine'
import { StorageNotice } from './StorageNotice'
import { CAMERA_PAGES, type Page } from './navigation'

/** Compose feature controllers and screens; each feature owns its workflow. */
export function LocalServiceApp({ camera }: { camera: CameraController }) {
  const [collectionEntry, setCollectionEntry] = useState(() => window.location?.hash === '#collection')
  const [authed, setAuthed] = useState(false)
  const [page, setPage] = useState<Page>('home')
  const [error, setError] = useState('')
  const [registration, setRegistration] = useState(false)
  const [serverMode, setServerMode] = useState(false)
  const [session, setSession] = useState<ServiceSession | null>(null)
  const ended = useRef(false)
  const clearError = useCallback(() => setError(''), [])
  const measuring = !!session && !ended.current
  const workspace = useLocalWorkspace(measuring, setError, reloadProfileFields)
  const { profile, rules, canWrite } = workspace
  const collection = useCollection(camera, rules)
  useEffect(() => {
    const navigate = () => {
      if (collection.active || (collection.count > 0 && !collection.downloaded)) {
        if (collectionEntry) window.history?.replaceState(null, '', '#collection')
        return
      }
      const next = window.location?.hash === '#collection'
      if (collectionEntry && !next) {
        camera.stop()
        collection.clear()
      }
      setCollectionEntry(next)
    }
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [collection.active, collection.count, collection.downloaded, collectionEntry, collection.clear, camera.stop])
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

  if (!authed && collectionEntry) {
    return <CollectionEntry camera={camera} collection={collection} onBack={() => {
      camera.stop()
      collection.clear()
      window.history?.replaceState(null, '', window.location.pathname + window.location.search)
      setCollectionEntry(false)
    }} />
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
        lead="계정 서버 연결 전이라 프로필과 측정 기록은 이 기기에만 저장해요."
        submitLabel={submitLabel}
        fine="카메라는 측정하기 화면에서 직접 켤 때만 사용해요. 카메라 없이도 저장된 기록을 볼 수 있어요."
        onSubmit={login}
        footer={
          <>
            <a className="btn btn-quiet btn-sm collection-entry-link" href="#collection" onClick={(event) => {
              event.preventDefault()
              window.history?.replaceState(null, '', '#collection')
              setCollectionEntry(true)
            }}>프로필 없이 자세 데이터 수집</a>
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
    <ServiceScreens
      onClearError={clearError}
      camera={camera}
      collection={collection}
      workspace={workspace}
      persistence={persistence}
      session={session}
      page={page}
      error={error}
      registration={registration}
      measuring={measuring}
      serverMode={serverMode}
      onServerMode={setServerMode}
      setRegistration={setRegistration}
      go={go}
      openCollection={openCollection}
      logout={logout}
      saveRules={saveRules}
      saveDemoPreference={saveDemoPreference}
      storageNotice={storageNotice}
      profilePage={
        <ProfilePage
          form={form}
          profileFields={profileFields}
          canWrite={canWrite}
          measuring={measuring}
          hasPendingResult={!!persistence.pending.current}
          onSettings={() => go('settings')}
        />
      }
      onAlerts={() => setError('화면 알림은 유지합니다. 소리만 측정 화면에서 끌 수 있습니다.')}
    />
  )
}
