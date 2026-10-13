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
import { KEYS, type LocalAccount, type Profile } from '../features/storage/types'
import { loadLocalState, readLocal, writeLocal } from '../features/storage/localRepository'
import { validEmail, validProfile } from '../features/storage/validation'
import { ValidatedInput } from '../components/InlineForm'
import { ConsentList } from '../features/auth/ConsentList'
import { CONSENT_VERSION, consentsComplete, type ConsentChoices } from '../features/auth/consents'
import { PASSWORD_GUIDANCE, validPassword } from '../features/auth/password'
import { DEFAULT_RULES } from '../data/posture'
import type { Rules } from '../lib/engine'
import { StorageNotice } from './StorageNotice'
import { CAMERA_PAGES, type Page } from './navigation'
import { SignupPostureStep } from '../features/auth/SignupPostureStep'

type AuthView = 'login' | 'consent' | 'account' | 'posture'

function storedAccount() {
  try {
    return readLocal<LocalAccount | null>(KEYS.account, null)
  } catch {
    return null
  }
}

/** Compose feature controllers and screens; each feature owns its workflow. */
export function LocalServiceApp({ camera }: { camera: CameraController }) {
  const [collectionEntry, setCollectionEntry] = useState(() => window.location?.hash === '#collection')
  const [authed, setAuthed] = useState(false)
  const [authView, setAuthView] = useState<AuthView>('login')
  const [account, setAccount] = useState<LocalAccount | null>(storedAccount)
  const [email, setEmail] = useState(() => account?.email ?? '')
  const [password, setPassword] = useState('')
  const [consents, setConsents] = useState<ConsentChoices>({})
  // Profiles made before sign-up consent existed keep their age and occupation.
  const optionalInfo = account ? account.consents.agreed.C3 === true : true
  const [page, setPage] = useState<Page>('home')
  const [error, setError] = useState('')
  const [serverMode, setServerMode] = useState(false)
  const [session, setSession] = useState<ServiceSession | null>(null)
  const ended = useRef(false)
  const clearError = useCallback(() => setError(''), [])
  const measuring = !!session && !ended.current
  const workspace = useLocalWorkspace(measuring, setError, reloadProfileFields)
  const { profile, canWrite } = workspace
  const collection = useCollection(camera)
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
    serverMode,
    go,
    setError,
  })
  const form = useProfileForm({
    workspace,
    measuring,
    setError,
    hasPendingResult: () => !!persistence.pending.current,
    onWithdrawn: clearWorkspace,
    optionalInfo,
  })
  const storageNotice = <StorageNotice workspace={workspace} />
  const profileFields = <ProfileFields form={form} canWrite={canWrite} optionalInfo={optionalInfo} />

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

  /** No account server yet: credentials are not checked; the profile signed up on this device is used. */
  function login() {
    if (!profile) {
      setError('이 기기에 가입한 계정이 없어요. 회원가입을 먼저 해 주세요.')
      return
    }
    setPassword('')
    workspace.setDraft(loadLocalState().draft)
    setAuthed(true)
    setPage('home')
    // Greet only after login: before it, the app cannot know who is typing.
    setError(`${profile.name}님, 다시 오셨네요.`)
  }

  function register() {
    if (!workspace.requireWriter()) return
    if (!validEmail(email.trim())) {
      setError('이메일을 확인해 주세요.')
      return
    }
    if (!validPassword(password)) {
      setError(PASSWORD_GUIDANCE)
      return
    }
    const withOptional = consents.C3 === true
    const next: Profile = withOptional
      ? { name: form.name.trim(), age: form.age, occupation: form.occupation.trim() }
      : { name: form.name.trim() }
    if (!validProfile(next)) {
      setError(
        withOptional
          ? '이름·나이·직업을 확인해 주세요. 나이는 1~120 사이의 정수로 입력해 주세요.'
          : '이름을 확인해 주세요.',
      )
      return
    }
    const nextAccount: LocalAccount = {
      email: email.trim(),
      consents: { version: CONSENT_VERSION, agreed: consents, at: new Date().toISOString() },
    }
    try {
      writeLocal(KEYS.profile, next)
      writeLocal(KEYS.account, nextAccount)
    } catch {
      setError('브라우저에 저장하지 못했습니다. 저장 공간과 권한을 확인해 주세요.')
      return
    }
    workspace.setProfile(next)
    setAccount(nextAccount)
    setPassword('')
    setError('')
    setAuthView('posture')
  }

  /** Step 3 is optional: a registered posture goes straight to 측정하기, a skip goes home. */
  function finishSignup(registered: boolean) {
    workspace.setDraft(loadLocalState().draft)
    setAuthed(true)
    setAuthView('login')
    setError('')
    setPage(registered ? 'setup' : 'home')
  }

  function openAuth(next: AuthView) {
    setError('')
    setAuthView(next)
  }

  function logout() {
    if (persistence.pending.current) {
      setError('결과 저장을 완료한 뒤 나가 주세요.')
      return
    }
    camera.stop()
    setAuthed(false)
    setAuthView('login')
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
    setAccount(null)
    setConsents({})
    setEmail('')
    setAuthView('login')
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

  const errorLine = error && (
    <p role="alert" className="fine">
      {error}
    </p>
  )

  if (!authed && authView === 'consent') {
    return (
      <LoginPage
        title="회원가입 · 1/3 약관 동의"
        lead="필수 항목에는 모두 동의하고, 선택 항목은 동의 여부를 골라 주세요."
        submitLabel="다음"
        submitDisabled={!consentsComplete(consents)}
        onSubmit={() => openAuth('account')}
        footer={
          <>
            {errorLine}
            <button type="button" className="btn btn-quiet" onClick={() => openAuth('login')}>
              로그인으로 돌아가기
            </button>
          </>
        }
      >
        <ConsentList choices={consents} onChange={setConsents} />
      </LoginPage>
    )
  }

  if (!authed && authView === 'posture') {
    return (
      <SignupPostureStep
        camera={camera}
        onBack={() => {
          camera.stop()
          openAuth('account')
        }}
        onFinish={finishSignup}
      />
    )
  }

  if (!authed && authView === 'account') {
    return (
      <LoginPage
        title="회원가입 · 2/3 계정 정보"
        lead="계정 서버 연결 전이라 이 기기에만 저장해요. 비밀번호는 저장하지 않아요."
        submitLabel="다음"
        submitDisabled={!canWrite}
        onSubmit={register}
        footer={
          <>
            {storageNotice}
            {errorLine}
            <button type="button" className="btn btn-quiet" onClick={() => openAuth('consent')}>
              이전
            </button>
          </>
        }
      >
        <label className="field">
          이메일
          <ValidatedInput name="email" validationLabel="이메일"
            className="input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={254}
            required
          />
        </label>
        <label className="field">
          비밀번호
          <ValidatedInput name="password" validationLabel="비밀번호"
            className="input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            maxLength={72}
            required
          />
        </label>
        <ProfileFields form={form} canWrite={canWrite} nameMax={30} optionalInfo={consents.C3 === true} />
      </LoginPage>
    )
  }

  if (!authed) {
    return (
      <LoginPage
        title="로그인"
        lead="계정 서버 연결 전이라 입력한 값은 확인하지 않고, 이 기기에 가입한 프로필로 들어가요."
        submitLabel="로그인"
        fine="카메라는 측정하기 화면에서 직접 켤 때만 사용해요. 카메라 없이도 저장된 기록을 볼 수 있어요."
        onSubmit={login}
        footer={
          <>
            <button type="button" className="btn btn-quiet" onClick={() => {
              setConsents({})
              openAuth('consent')
            }}>
              회원가입
            </button>
            {storageNotice}
            {errorLine}
          </>
        }
      >
        <label className="field">
          이메일
          <ValidatedInput name="email" validationLabel="이메일"
            className="input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={254}
          />
        </label>
        <label className="field">
          비밀번호
          <ValidatedInput name="password" validationLabel="비밀번호"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            maxLength={72}
          />
        </label>
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
      measuring={measuring}
      serverMode={serverMode}
      onServerMode={setServerMode}
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
