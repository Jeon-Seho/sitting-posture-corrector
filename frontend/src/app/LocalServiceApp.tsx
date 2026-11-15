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
  type SocialSignupDraft,
} from '../features/auth/accountClient'
import { DEFAULT_RULES } from '../data/posture'
import type { Rules } from '../lib/engine'
import { StorageNotice } from './StorageNotice'
import { CAMERA_PAGES, type Page } from './navigation'
import { SignupPostureStep } from '../features/auth/SignupPostureStep'
import { MailAccessPage } from '../features/auth/MailAccessPage'
import { fetchWorkspace, saveWorkspaceRules } from '../features/storage/serverWorkspace'
import { getServerAuth } from '../features/platform/serverAuth'
import { mailRoute, type MailPurpose } from '../features/auth/mailApi'
import { desktopBridge } from '../features/desktop/bridge'
import { clearSocialRoute, discordLoginEnabled, socialResultMessage, socialRoute } from '../features/auth/socialLogin'
import { SocialLoginButtons } from '../features/auth/SocialLoginButtons'
import { isDeveloperAccount } from '../features/auth/developerAccount'
import { setServerAuth } from '../features/platform/serverAuth'
import { ServerAccountPage } from '../features/profile/ServerAccountPage'
import { clearPageError, reportPageError } from '../features/connection/pageError'

type AuthView = 'login' | 'consent' | 'account' | 'posture' | 'mail'

/**
 * The app always signs in on the account server `/auth` (D-66; no switch since 2026-10-22,
 * klaod-tech: the app always measures on the server, ADR 0021, so a local sign-in has no use).
 */
const DEFAULT_ACCOUNTS: AccountClient | null = createAccountClient()

function storedAccount() {
  try {
    return readLocal<LocalAccount | null>(KEYS.account, null)
  } catch (caughtError) {
    console.error('[app/LocalServiceApp.tsx:storedAccount] Operation failed', caughtError)
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
  const [developer, setDeveloper] = useState(false)
  const authAttempt = useRef(0)
  const accountMutation = useRef(false)
  const [authView, setAuthView] = useState<AuthView>(() => mailRoute(window.location?.hash ?? '') ? 'mail' : 'login')
  const [mailPurpose, setMailPurpose] = useState<MailPurpose>('reset')
  const [mailReturn, setMailReturn] = useState<AuthView>('login')
  const [mailEntry, setMailEntry] = useState(0)
  // Back from Discord: a result to show once (after the usual A8 → A4 start) or a pending sign-up.
  const [socialLanding] = useState(() => socialRoute(window.location?.hash ?? ''))
  const socialNotice = useRef(socialLanding?.kind === 'result' ? socialResultMessage(socialLanding.status) : null)
  const [socialSignup, setSocialSignup] = useState<SocialSignupDraft | null>(null)
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
  const workspace = useLocalWorkspace(measuring, setError, reloadProfileFields, !accounts && !developer)
  const { profile, canWrite } = workspace
  const collection = useCollection(camera)
  const { active: collectionActive, count: collectionCount, downloaded: collectionDownloaded, clear: clearCollection } = collection
  const { stop: stopCamera } = camera
  useEffect(() => {
    const navigate = () => {
      if (collectionActive || (collectionCount > 0 && !collectionDownloaded)) {
        if (collectionEntry) window.history?.replaceState(null, '', '#collection')
        return
      }
      const next = window.location?.hash === '#collection'
      if (collectionEntry && !next) {
        stopCamera()
        clearCollection()
      }
      setCollectionEntry(next)
    }
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [collectionActive, collectionCount, collectionDownloaded, collectionEntry, clearCollection, stopCamera])
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
    onWithdrawn: clearWorkspace,
    optionalInfo,
  })
  const storageNotice = developer
    ? <p role="status">개발자 계정 · 서버 연결 없음 · 예시 기록과 화면 확인용</p>
    : <StorageNotice workspace={workspace} />
  const profileFields = <ProfileFields form={form} canWrite={canWrite} optionalInfo={optionalInfo} />

  // (D-66) A login cookie from an earlier visit signs in again without typing (A4).
  useEffect(() => {
    if (!accounts) return
    let cancelled = false
    const attempt = authAttempt.current
    accounts
      .me()
      .then((view) => {
        if (!cancelled && view && attempt === authAttempt.current) enterWithAccount(view, false)
      })
      .catch((caughtError) => {
        console.error('[app/LocalServiceApp.tsx:LocalServiceApp] Operation failed', caughtError)
        // Server unreachable: the sign-in screen stays and shows the error on submit.
      })
      .finally(() => {
        if (cancelled || !socialNotice.current) return
        setError(socialNotice.current)
        socialNotice.current = null
      })
    return () => {
      cancelled = true
    }
    // Only once per mount: later sign-ins go through login()/register().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts])

  // Back from Discord: drop the result from the address bar; a new user continues with consent.
  useEffect(() => {
    if (!socialLanding) return
    clearSocialRoute()
    const social = accounts?.social
    if (socialLanding.kind !== 'signup' || !social) return
    let cancelled = false
    social
      .signupDraft()
      .then((draft) => {
        if (cancelled) return
        if (!draft) {
          setError('Discord 가입 확인 시간이 지났어요. Discord로 다시 시작해 주세요.')
          return
        }
        setSocialSignup(draft)
        setEmail(draft.email)
        form.resetFields({ name: draft.suggested_name })
        setConsents({})
        setAuthView('consent')
      })
      .catch((caughtError) => {
        console.error('[app/LocalServiceApp.tsx:LocalServiceApp] Operation failed', caughtError)
        if (!cancelled) setError(accountErrorMessage(caughtError, 'register'))
      })
    return () => {
      cancelled = true
    }
    // Only once per mount, like the sign-in above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts])

  async function startDiscord() {
    const social = accounts?.social
    if (!social || busy) return
    setBusy(true)
    setError('')
    try {
      window.location.assign(await social.startLogin())
    } catch (caughtError) {
      console.error('[app/LocalServiceApp.tsx:startDiscord] Operation failed', caughtError)
      setError(accountErrorMessage(caughtError, 'login'))
      setBusy(false)
    }
  }

  // 「오늘」 comes from the server (ADR 0029). The app does not count time itself, so the day turns
  // over when it asks A4 again: on coming back to the app and on opening 기록·달력, at most once a
  // minute (a day changes once, so a minute late at midnight is enough).
  const lastTimeRefresh = useRef(0)
  const refreshToday = useCallback(() => {
    const refresh = accounts?.refreshServerTime
    if (developer || !authed || !refresh || Date.now() - lastTimeRefresh.current < 60_000) return
    lastTimeRefresh.current = Date.now()
    void refresh()
  }, [accounts, authed, developer])
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
    setDeveloper(false)
    workspace.setShowDemo(false)
    const next = fromApiProfile(view.profile)
    try {
      writeLocal(KEYS.profile, next)
    } catch (caughtError) {
      console.error('[app/LocalServiceApp.tsx:enterWithAccount] Operation failed', caughtError)
      // Only the copy failed; the screens use the profile in memory.
    }
    workspace.setProfile(next)
    form.resetFields(next)
    void loadServerRules()
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
    if (next === 'developer' && !developer) return
    if (accountMutation.current) { setError('계정 변경을 확인한 뒤 이동해 주세요.'); return }
    setError('')
    if (!CAMERA_PAGES.includes(next) && !measuring) camera.cancelCalibration()
    // 기록·달력 show 「오늘」: ask the server's day first (e.g. the app left open past midnight).
    if (next === 'dashboard' || next === 'calendar') refreshToday()
    // Another device may have changed the rules: S1 must send the account's (409 otherwise).
    if ((next === 'setup' || next === 'settings') && !measuring) void loadServerRules()
    setPage(next)
  }

  function openCollection() {
    if (!developer) return
    if (measuring) {
      setError('진행 중인 측정을 마친 뒤 이동해 주세요.')
      return
    }
    go('collection')
  }

  /** With the account server (D-66) the credentials are checked by A3; without it the profile signed up on this device is used. */
  function login() {
    if (email.trim() === 'admin') {
      if (!isDeveloperAccount(email, password)) {
        setError('개발자 계정의 비밀번호를 확인해 주세요.')
        return
      }
      authAttempt.current++
      accounts?.suspend?.()
      setServerAuth(null)
      camera.stop()
      workspace.setProfile({ name: '개발자' })
      workspace.setRecords([])
      workspace.setShowDemo(false)
      setDeveloper(true)
      setPassword('')
      setAuthed(true)
      setPage('home')
      setError('개발자 계정 · 서버 연결 없음. 예시 기록과 화면을 확인할 수 있어요.')
      return
    }
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
      console.error('[app/LocalServiceApp.tsx:loginWithServer] Operation failed', error)
      setPassword('')
      setError(accountErrorMessage(error, 'login'))
    } finally {
      setBusy(false)
    }
  }

  function register() {
    if (!workspace.requireWriter()) return
    if (socialSignup && accounts?.social) {
      const next: Profile = consents.C3 === true
        ? { name: form.name.trim(), age: form.age, occupation: form.occupation.trim() }
        : { name: form.name.trim() }
      if (!validProfileInput(next)) {
        setError(consents.C3 === true ? '이름·나이·직업을 확인해 주세요. 나이는 14~120 사이의 정수로 입력해 주세요.' : '이름을 확인해 주세요.')
        return
      }
      void registerSocialWithServer(accounts, next)
      return
    }
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
      console.error('[app/LocalServiceApp.tsx:registerWithServer] Operation failed', error)
      setError(accountErrorMessage(error, 'register'))
    } finally {
      setBusy(false)
    }
  }

  /** Discord sign-up: the e-mail is the one Discord confirmed; the account has no password yet. */
  async function registerSocialWithServer(client: AccountClient, next: Profile) {
    if (busy || !client.social || !socialSignup) return
    setBusy(true)
    setError('')
    try {
      const view = await client.social.signup({ profile: next, consents: consentPayload(consents) })
      setSocialSignup(null)
      keepSignup(fromApiProfile(view.profile), {
        email: view.email,
        consents: { version: CONSENT_DOCUMENT_VERSION, agreed: consents, at: new Date().toISOString() },
      })
    } catch (error) {
      console.error('[app/LocalServiceApp.tsx:registerSocialWithServer] Operation failed', error)
      setError(accountErrorMessage(error, 'register'))
    } finally {
      setBusy(false)
    }
  }

  function keepSignup(next: Profile, nextAccount: LocalAccount) {
    try {
      writeLocal(KEYS.profile, next)
      writeLocal(KEYS.account, nextAccount)
    } catch (caughtError) {
      console.error('[app/LocalServiceApp.tsx:keepSignup] Operation failed', caughtError)
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
    if (next === 'login') setSocialSignup(null)
    setAuthView(next)
  }

  function logout() {
    if (accountMutation.current) { setError('계정 변경을 확인한 뒤 로그아웃해 주세요.'); return }
    if (measuring) {
      go('session')
      setError('측정을 종료하고 결과 저장을 확인한 뒤 로그아웃해 주세요.')
      return
    }
    // (D-66) End the server login too. A failure (server down, another tab switched accounts)
    // still signs out here; the login cookie then expires on the server.
    if (accounts && !developer) {
      setBusy(true)
      void accounts.logout().catch((caughtError) => {
        console.error('[app/LocalServiceApp.tsx:logout] Operation failed', caughtError)
        return setError('서버 로그아웃을 확인하지 못했어요. 연결 후 다시 시도해 주세요.')
      }).finally(() => setBusy(false))
    }
    authAttempt.current++
    clearPageError()
    setDeveloper(false)
    workspace.setRecords([])
    workspace.setRules(DEFAULT_RULES)
    workspace.setShowDemo(false)
    camera.stop()
    setAuthed(false)
    setAuthView('login')
    setSession(null)
  }

  function clearWorkspace() {
    clearPageError()
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

  /**
   * Server accounts keep the posture rules on the server only (W1·W2, api-ws-spec 4장, 2026-11-10).
   * The newest request wins, so a slider drag that sends several saves ends on its last value.
   */
  const rulesRequest = useRef(0)
  async function loadServerRules() {
    if (!accounts || !getServerAuth()) return
    const ticket = ++rulesRequest.current
    try {
      const saved = await fetchWorkspace()
      if (ticket === rulesRequest.current) { workspace.setRules(saved.rules); clearPageError('rules') }
    } catch (caughtError) {
      console.error('[app/LocalServiceApp.tsx:loadServerRules] Operation failed', caughtError)
      if (ticket !== rulesRequest.current) return
      setError('서버 설정을 불러오지 못했어요. 측정 전에 설정 화면을 다시 열어 주세요.')
      reportPageError('rules', caughtError, () => void loadServerRules())
    }
  }

  async function saveServerRules(next: Rules) {
    const ticket = ++rulesRequest.current
    workspace.setRules(next)
    try {
      const saved = await saveWorkspaceRules(next)
      if (ticket !== rulesRequest.current) return
      workspace.setRules(saved.rules)
      setError('저장했어요. 다음 측정부터 적용돼요.')
    } catch (caughtError) {
      console.error('[app/LocalServiceApp.tsx:saveServerRules] Operation failed', caughtError)
      if (ticket !== rulesRequest.current) return
      setError(caughtError instanceof Error ? caughtError.message : '설정을 저장하지 못했어요.')
      void loadServerRules()
    }
  }

  function saveRules(next: Rules) {
    if (developer) { workspace.setRules(next); return }
    if (accounts) {
      if (!getServerAuth()) { setError('로그인이 필요해요. 다시 로그인해 주세요.'); return }
      void saveServerRules(next)
      return
    }
    if (!workspace.requireWriter()) return
    try {
      writeLocal(KEYS.settings, next)
      workspace.setRules(next)
      setError('저장했어요. 다음 측정부터 적용돼요.')
    } catch (caughtError) {
      console.error('[app/LocalServiceApp.tsx:saveRules] Operation failed', caughtError)
      setError('설정을 저장하지 못했어요.')
    }
  }

  function saveDemoPreference(next: boolean) {
    if (developer) { workspace.setShowDemo(next); return }
    if (!workspace.requireWriter()) return
    try {
      writeLocal(KEYS.demo, next)
      workspace.setShowDemo(next)
    } catch (caughtError) {
      console.error('[app/LocalServiceApp.tsx:saveDemoPreference] Operation failed', caughtError)
      setError('시연 옵션을 저장하지 못했어요.')
    }
  }

  if (authed && developer && collectionEntry) {
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
        title={socialSignup ? 'Discord로 회원가입 · 1/3 약관 동의' : '회원가입 · 1/3 약관 동의'}
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
          socialSignup
            ? 'Discord에서 확인된 이메일로 가입해요. 비밀번호 없이 Discord로 로그인하고, 비밀번호는 나중에 재설정 메일로 정할 수 있어요.'
            : accounts
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
            {!socialSignup && <button type="button" className="btn btn-quiet" onClick={() => { setMailPurpose('verify'); setMailReturn('account'); openAuth('mail') }}>이메일 인증 안내</button>}
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
            readOnly={!!socialSignup}
          />
        </label>
        {!socialSignup && <label className="field">
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
        </label>}
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
            {accounts?.social && (
              // Every planned provider is shown; only Discord works for now. Others say they are coming.
              <SocialLoginButtons disabled={busy} ready={id => id === 'discord'} onPick={(id, name) => {
                if (id === 'discord' && discordLoginEnabled()) void startDiscord()
                else if (id === 'discord') setError(desktopBridge()
                  ? 'Discord 로그인은 데스크톱 앱에서 준비 중이에요. 지금은 웹 브라우저에서 사용할 수 있어요.'
                  : 'Discord 로그인은 서버 설정을 마친 뒤 사용할 수 있어요.')
                else setError(`${name} 로그인은 준비 중이에요. 지금은 이메일이나 Discord로 로그인해 주세요.`)
              }} />
            )}
            <button type="button" className="btn btn-quiet" onClick={() => { setMailPurpose('reset'); setMailReturn('login'); openAuth('mail') }}>비밀번호 재설정</button>
            <button type="button" className="btn btn-quiet" onClick={() => {
              setConsents({})
              setSocialSignup(null)
              openAuth('consent')
            }}>
              회원가입
            </button>
            {storageNotice}
            {/* 안내가 떠도 로그인 칸이 밀리지 않게 폼 아래 빈 자리에 띄운다. */}
            {errorLine && <div className="auth-alert-slot">{errorLine}</div>}
          </>
        }
      >
        <label className="field">
          이메일 또는 개발자 ID
          <ValidatedInput name="email" validationLabel="이메일"
            className="input"
            type="text"
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
      developer={developer}
      pageErrors={!!accounts && !developer}
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
      profilePage={developer ? <p>개발자 계정은 서버·DB 계정이 아닙니다. 일반 계정으로 로그인하면 서버 측정을 사용할 수 있어요.</p> : accounts ?
        <ServerAccountPage blocked={measuring} onProfile={workspace.setProfile}
          social={discordLoginEnabled() ? accounts.social : undefined}
          onBusy={busy => { accountMutation.current = busy }}
          onSignedOut={message => { accounts.suspend?.(); clearWorkspace(); setError(message) }} /> :
        <ProfilePage
          form={form}
          profileFields={profileFields}
          canWrite={canWrite}
          measuring={measuring}
          onSettings={() => go('settings')}
        />
      }
      onAlerts={() => setError('화면 알림은 그대로 둬요. 소리만 측정 화면에서 끌 수 있어요.')}
    />
  )
}
