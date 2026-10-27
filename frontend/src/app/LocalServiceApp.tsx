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
import { readLocal, writeLocal } from '../features/storage/localRepository'
import { validEmail, validProfileInput } from '../features/storage/validation'
import { ValidatedInput } from '../components/InlineForm'
import { ConsentList } from '../features/auth/ConsentList'
import {
  CONSENT_DOCUMENT_VERSION,
  consentPayload,
  consentsComplete,
  type ConsentChoices,
} from '../features/auth/consents'
import {
  PASSWORD_GUIDANCE,
  SERVER_PASSWORD_GUIDANCE,
  validPassword,
  validServerPassword,
} from '../features/auth/password'
import {
  accountErrorMessage,
  createAccountClient,
  fromApiProfile,
  type AccountClient,
  type AccountView,
} from '../features/auth/accountClient'
import { DEFAULT_RULES } from '../data/posture'
import type { Rules } from '../lib/engine'
import { StorageNotice } from './StorageNotice'
import { CAMERA_PAGES, type Page } from './navigation'
import { SignupPostureStep } from '../features/auth/SignupPostureStep'
import { MailAccessPage } from '../features/auth/MailAccessPage'
import { mailRoute, type MailPurpose } from '../features/auth/mailApi'

type AuthView = 'login' | 'consent' | 'account' | 'posture' | 'mail'

/**
 * The app always signs in on the account server `/v2/auth` (D-66; no switch since 2026-10-22,
 * klaod-tech: the app always measures on the server, ADR 0025, so a local sign-in has no use).
 */
const DEFAULT_ACCOUNTS: AccountClient | null = createAccountClient()

function storedAccount() {
  try {
    return readLocal<LocalAccount | null>(KEYS.account, null)
  } catch {
    return null
  }
}

/** Compose feature controllers and screens; each feature owns its workflow. */
export function LocalServiceApp({
  camera,
  accounts = DEFAULT_ACCOUNTS,
}: {
  camera: CameraController
  /** Account server client. `null` signs in on this device and exists only for the older screen tests. */
  accounts?: AccountClient | null
}) {
  const [collectionEntry, setCollectionEntry] = useState(() => window.location?.hash === '#collection')
  const [authed, setAuthed] = useState(false)
  const [authView, setAuthView] = useState<AuthView>(() => mailRoute(window.location?.hash ?? '') ? 'mail' : 'login')
  const [mailPurpose, setMailPurpose] = useState<MailPurpose>('reset')
  const [mailReturn, setMailReturn] = useState<AuthView>('login')
  const [mailEntry, setMailEntry] = useState(0)
  useEffect(() => {
    const receiveMailLink = () => {
      const route = mailRoute(window.location.hash)
      if (!route || authed) return
      setMailPurpose(route.purpose)
      setMailReturn('login')
      setMailEntry(v => v + 1)
      setAuthView('mail')
    }
    window.addEventListener('hashchange', receiveMailLink)
    return () => window.removeEventListener('hashchange', receiveMailLink)
  }, [authed])
  const [account, setAccount] = useState<LocalAccount | null>(storedAccount)
  const [email, setEmail] = useState(() => account?.email ?? '')
  const [password, setPassword] = useState('')
  const [consents, setConsents] = useState<ConsentChoices>({})
  // Profiles made before sign-up consent existed keep their age and occupation.
  const optionalInfo = account ? account.consents.agreed.C3 === true : true
  const [page, setPage] = useState<Page>('home')
  const [error, setError] = useState('')
  // A sign-in/sign-up request to the account server is in flight.
  const [busy, setBusy] = useState(false)
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

  // (D-66) A login cookie from an earlier visit signs in again without typing (A4).
  useEffect(() => {
    if (!accounts) return
    let cancelled = false
    accounts
      .me()
      .then((view) => {
        if (!cancelled && view) enterWithAccount(view, false)
      })
      .catch(() => {
        // Server unreachable: the sign-in screen stays and shows the error on submit.
      })
    return () => {
      cancelled = true
    }
    // Only once per mount: later sign-ins go through login()/register().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts])

  // 「오늘」 comes from the server (ADR 0029). The app does not count time itself, so the day turns
  // over when it asks A4 again: on coming back to the app and on opening 기록·달력, at most once a
  // minute (a day changes once, so a minute late at midnight is enough).
  const lastTimeRefresh = useRef(0)
  const refreshToday = useCallback(() => {
    const refresh = accounts?.refreshServerTime
    if (!authed || !refresh || Date.now() - lastTimeRefresh.current < 60_000) return
    lastTimeRefresh.current = Date.now()
    void refresh()
  }, [accounts, authed])
  useEffect(() => {
    if (typeof document === 'undefined' || !window.addEventListener) return
    const back = () => {
      if (document.visibilityState !== 'hidden') refreshToday()
    }
    window.addEventListener('focus', back)
    document.addEventListener('visibilitychange', back)
    return () => {
      window.removeEventListener('focus', back)
      document.removeEventListener('visibilitychange', back)
    }
  }, [refreshToday])

  /** Signed in on the server: this device keeps a copy of the profile for the screens that read it. */
  function enterWithAccount(view: AccountView, greet = true) {
    const next = fromApiProfile(view.profile)
    try {
      writeLocal(KEYS.profile, next)
    } catch {
      // Only the copy failed; the screens use the profile in memory.
    }
    workspace.setProfile(next)
    form.resetFields(next)
    setEmail(view.email)
    setPassword('')
    setAuthed(true)
    setPage('home')
    setError(greet ? `${next.name}님, 다시 오셨네요.` : '')
  }

  function reloadProfileFields(profile: Profile | null) {
    form.resetFields(profile)
  }

  // Keep a running session mounted when visiting another page.
  function go(next: Page) {
    setError('')
    if (!CAMERA_PAGES.includes(next) && !measuring) camera.cancelCalibration()
    // 기록·달력 show 「오늘」: ask the server's day first (e.g. the app left open past midnight).
    if (next === 'dashboard' || next === 'calendar') refreshToday()
    setPage(next)
  }

  function openCollection() {
    if (measuring) {
      setError('진행 중인 측정을 마친 뒤 이동해 주세요.')
      return
    }
    go('collection')
  }

  /** With the account server (D-66) the credentials are checked by A3; without it the profile signed up on this device is used. */
  function login() {
    if (accounts) {
      void loginWithServer(accounts)
      return
    }
    if (!profile) {
      setError('이 기기에 가입한 계정이 없어요. 회원가입을 먼저 해 주세요.')
      return
    }
    setPassword('')
    setAuthed(true)
    setPage('home')
    // Greet only after login: before it, the app cannot know who is typing.
    setError(`${profile.name}님, 다시 오셨네요.`)
  }

  async function loginWithServer(client: AccountClient) {
    if (busy) return
    if (!validEmail(email.trim()) || !password) {
      setError('이메일과 비밀번호를 입력해 주세요.')
      return
    }
    setBusy(true)
    setError('')
    try {
      enterWithAccount(await client.login(email.trim(), password))
    } catch (error) {
      setPassword('')
      setError(accountErrorMessage(error, 'login'))
    } finally {
      setBusy(false)
    }
  }

  function register() {
    if (!workspace.requireWriter()) return
    if (!validEmail(email.trim())) {
      setError('이메일을 확인해 주세요.')
      return
    }
    if (accounts ? !validServerPassword(password) : !validPassword(password)) {
      setError(accounts ? SERVER_PASSWORD_GUIDANCE : PASSWORD_GUIDANCE)
      return
    }
    const withOptional = consents.C3 === true
    const next: Profile = withOptional
      ? { name: form.name.trim(), age: form.age, occupation: form.occupation.trim() }
      : { name: form.name.trim() }
    if (!validProfileInput(next)) {
      setError(
        withOptional
          ? '이름·나이·직업을 확인해 주세요. 나이는 14~120 사이의 정수로 입력해 주세요.'
          : '이름을 확인해 주세요.',
      )
      return
    }
    const nextAccount: LocalAccount = {
      email: email.trim(),
      consents: { version: CONSENT_DOCUMENT_VERSION, agreed: consents, at: new Date().toISOString() },
    }
    if (accounts) {
      void registerWithServer(accounts, next, nextAccount)
      return
    }
    keepSignup(next, nextAccount)
  }

  /** (D-66) A2 creates the account and signs in; this device keeps the profile and consent choices as before. */
  async function registerWithServer(client: AccountClient, next: Profile, nextAccount: LocalAccount) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const view = await client.register({
        email: nextAccount.email,
        password,
        profile: next,
        consents: consentPayload(consents),
      })
      keepSignup(fromApiProfile(view.profile), { ...nextAccount, email: view.email })
    } catch (error) {
      setError(accountErrorMessage(error, 'register'))
    } finally {
      setBusy(false)
    }
  }

  function keepSignup(next: Profile, nextAccount: LocalAccount) {
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
    // The camera was attached to step 3's capture element, which unmounts now: reconnect so
    // tracking follows the app shell's element (otherwise the skeleton stops until a restart).
    // connect() awaits the camera before it reads the element, by then the shell is mounted.
    if (camera.state === 'on' || camera.state === 'loading') void camera.connect()
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
    // (D-66) End the server login too. A failure (server down, another tab switched accounts)
    // still signs out here; the login cookie then expires on the server.
    if (accounts) void accounts.logout().catch(() => undefined)
    camera.stop()
    setAuthed(false)
    setAuthView('login')
    setSession(null)
  }

  function clearWorkspace() {
    camera.stop()
    workspace.setProfile(null)
    workspace.setRecords([])
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
      setError('저장했어요. 다음 측정부터 적용돼요.')
    } catch {
      setError('설정을 저장하지 못했어요.')
    }
  }

  function saveDemoPreference(next: boolean) {
    if (!workspace.requireWriter()) return
    try {
      writeLocal(KEYS.demo, next)
      workspace.setShowDemo(next)
    } catch {
      setError('시연 옵션을 저장하지 못했어요.')
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

  if (!authed && authView === 'mail') {
    return <MailAccessPage key={mailEntry} purpose={mailPurpose} initialEmail={email} onBack={() => openAuth(mailReturn)} />
  }

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
        lead={
          accounts
            ? '계정 서버에 가입해요. 비밀번호는 12자 이상이에요.'
            : '계정 서버 연결 전이라 이 기기에만 저장해요. 비밀번호는 저장하지 않아요.'
        }
        submitLabel={busy ? '가입하는 중…' : '다음'}
        submitDisabled={!canWrite || busy}
        onSubmit={register}
        footer={
          <>
            {storageNotice}
            {errorLine}
            <button type="button" className="btn btn-quiet" onClick={() => { setMailPurpose('verify'); setMailReturn('account'); openAuth('mail') }}>이메일 인증 안내</button>
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
        <ProfileFields form={form} canWrite={canWrite} optionalInfo={consents.C3 === true} />
      </LoginPage>
    )
  }

  if (!authed) {
    return (
      <LoginPage
        title="로그인"
        lead={
          accounts
            ? '가입한 이메일과 비밀번호로 로그인해요.'
            : '계정 서버 연결 전이라 입력한 값은 확인하지 않고, 이 기기에 가입한 프로필로 들어가요.'
        }
        submitLabel={busy ? '로그인하는 중…' : '로그인'}
        submitDisabled={busy}
        fine="카메라는 측정하기 화면에서 직접 켤 때만 사용해요. 카메라 없이도 저장된 기록을 볼 수 있어요."
        onSubmit={login}
        footer={
          <>
            <button type="button" className="btn btn-quiet" onClick={() => { setMailPurpose('reset'); setMailReturn('login'); openAuth('mail') }}>비밀번호 재설정</button>
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
      onAlerts={() => setError('화면 알림은 그대로 둬요. 소리만 측정 화면에서 끌 수 있어요.')}
    />
  )
}
