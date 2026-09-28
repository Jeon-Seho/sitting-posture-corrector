import { useEffect, useRef, useState } from 'react'
import { useCamera } from './hooks/useCamera'
import { useCollection } from './hooks/useCollection'
import { SetupPage } from './pages/SetupPage'
import { SessionPage } from './pages/SessionPage'
import { SettingsPage } from './pages/SettingsPage'
import type { LiveState, Machine, Rules } from './lib/engine'
import {
  KEYS, readLocal, writeLocal, upsertRecord, resumeMachine, recordFromDraft, validateProfile,
  parseDraft, parseMode, parseProfile, parseRecords, parseRules,
  type Draft, type Mode, type Profile, type RecordItem,
} from './lib/serviceStore'
import { EMPTY_PROFILE } from './service/ProfileFields'
import { LoginScreen } from './service/LoginScreen'
import { ServiceSidebar, type ServicePage } from './service/ServiceSidebar'
import { DraftCard } from './service/DraftCard'
import { RecordsPage } from './service/RecordsPage'
import { ProfilePage } from './service/ProfilePage'

type Session = { id: string; startedAt: string; mode: Mode; rules: Rules; initial?: Machine }

/** 로컬 서비스 미리보기. 화면은 service/ 컴포넌트에 두고, 여기서는 상태·저장·측정 수명을 조립한다. */
export default function ServiceApp() {
  const camera = useCamera()
  const [profile, setProfile] = useState<Profile | null>(() => parseProfile(readLocal(KEYS.profile, null)))
  const [form, setForm] = useState<Profile>(() => profile ?? EMPTY_PROFILE)
  const [authed, setAuthed] = useState(false)
  const [page, setPage] = useState<ServicePage>('home')
  const [records, setRecords] = useState<RecordItem[]>(() => parseRecords(readLocal(KEYS.records, null)))
  const [rules, setRules] = useState<Rules>(() => parseRules(readLocal(KEYS.settings, null)))
  const [mode, setMode] = useState<Mode>(() => parseMode(readLocal(KEYS.mode, null)))
  const collection = useCollection(camera, rules)
  const [session, setSession] = useState<Session | null>(null)
  const [draft, setDraft] = useState<Draft | null>(() => parseDraft(readLocal(KEYS.draft, null)))
  const [saveMessage, setSaveMessage] = useState('이 브라우저에 결과를 저장하고 있습니다.')
  const pending = useRef<RecordItem | null>(null)
  const [error, setError] = useState('')
  const [registration, setRegistration] = useState(false)
  const ended = useRef(false)
  const measuring = !!session && !ended.current

  useEffect(() => {
    if (authed) void camera.connect()
  }, [authed])
  useEffect(() => { try { writeLocal(KEYS.mode, mode) } catch { /* 모드 기억은 편의 기능이라 실패해도 진행한다. */ } }, [mode])
  useEffect(() => { const timer = setInterval(() => { if (pending.current) saveResult(pending.current) }, 5000); return () => clearInterval(timer) }, [])

  const go = (next: ServicePage) => { setError(''); setPage(next) }

  function saveProfile(notify = true) {
    const next = validateProfile(form)
    if (!next) { setError('이름·나이·직업을 확인해 주세요.'); return false }
    try { writeLocal(KEYS.profile, next); setProfile(next); setError(notify ? '저장했습니다.' : ''); return true }
    catch { setError('브라우저에 저장하지 못했습니다. 저장 공간과 권한을 확인해 주세요.'); return false }
  }
  function login() {
    if (!saveProfile(false)) return
    setAuthed(true); setRegistration(!profile); setPage(profile ? 'home' : 'setup')
  }
  function exit() {
    if (pending.current) { setError('결과 저장을 완료한 뒤 나가 주세요.'); return }
    camera.stop(); setAuthed(false); setSession(null); setDraft(parseDraft(readLocal(KEYS.draft, null)))
  }
  function withdraw() {
    try {
      Object.values(KEYS).forEach(k => localStorage.removeItem(k))
      camera.stop(); setProfile(null); setForm(EMPTY_PROFILE); setRecords([]); setDraft(null); setSession(null)
      pending.current = null; setAuthed(false); setError('이 브라우저의 사용자 자료를 삭제했습니다.')
    } catch { setError('자료를 모두 삭제하지 못했습니다. 다시 시도해 주세요.') }
  }
  function start() {
    if (pending.current) { setError('이전 결과 저장을 완료한 뒤 새 측정을 시작해 주세요.'); return }
    if (registration) { setRegistration(false); go('home'); return }
    if (measuring) { go('session'); return }
    const next = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), mode, rules: { ...rules } }
    ended.current = false; pending.current = null; setSaveMessage('저장 대기'); setSession(next); go('session')
  }
  function saveResult(record: RecordItem) {
    try {
      const next = upsertRecord(parseRecords(readLocal(KEYS.records, null)), record)
      writeLocal(KEYS.records, next); localStorage.removeItem(KEYS.draft)
      setRecords(next); setDraft(null); pending.current = null
      setSaveMessage('이 브라우저에 저장했습니다. 홈과 대시보드에 반영되었습니다.')
    } catch { pending.current = record; setSaveMessage('저장하지 못했습니다. 결과는 유지됩니다. 자동 재시도하거나 저장 다시 시도를 눌러 주세요.') }
  }
  function finish(live: LiveState) {
    if (!session) return
    ended.current = true
    saveResult({ id: session.id, startedAt: session.startedAt, endedAt: new Date().toISOString(), mode: session.mode,
      valid: live.validSeconds, good: live.goodSeconds, total: live.totalSeconds, events: live.events })
  }
  function checkpoint(machine: Machine) {
    if (!session || ended.current) return
    try { writeLocal(KEYS.draft, { ...session, machine }) } catch { setError('중간 기록을 저장하지 못했습니다. 새로고침 시 기록을 잃을 수 있습니다.') }
  }
  function restore() {
    if (!draft) return
    ended.current = false; setMode(draft.mode)
    setSession({ ...draft, initial: resumeMachine(draft.machine) }); setDraft(null); go('session')
  }
  function changeMode(next: Mode) {
    if (measuring) { setError('진행 중인 측정을 종료한 후 모드를 바꿔 주세요.'); return }
    camera.stop(); setMode(next)
  }
  function changeRules(next: Rules) {
    try { writeLocal(KEYS.settings, next); setRules(next); setError('저장했습니다. 다음 측정부터 적용합니다.') }
    catch { setError('설정을 저장하지 못했습니다.') }
  }

  if (!authed) return <LoginScreen hasProfile={!!profile} form={form} onForm={setForm} onSubmit={login} error={error} />

  return (
    <div className="shell">
      <video ref={camera.videoRef} className="capture-source" muted playsInline aria-hidden="true" />
      <ServiceSidebar page={page} measuring={measuring} onExit={exit}
        onNavigate={id => go(id === 'session' && !session ? 'setup' : id)} />
      <main className="main service-main">
        <div className="service-status">
          <span>{camera.state === 'on' ? '카메라 사용 중' : camera.state === 'loading' ? '카메라 준비 중' : '카메라 꺼짐'}</span>
          <button className="btn btn-sm" disabled={camera.state === 'loading'} onClick={() => camera.state === 'on' ? camera.stop() : void camera.connect()}>
            {camera.state === 'on' ? '카메라 끄기' : '카메라 켜기'}
          </button>
          <button className="btn btn-sm" aria-current={page === 'profile'} onClick={() => go('profile')}>{profile?.name} · 프로필 설정</button>
        </div>
        {error && <p role="status" className="service-notice">{error}</p>}
        {draft && !session && <DraftCard onRestore={restore} onSave={() => saveResult(recordFromDraft(draft, new Date().toISOString()))} />}
        {(page === 'home' || page === 'dashboard') && (
          <RecordsPage scope={page} name={profile?.name ?? ''} records={records} measuring={measuring}
            onStart={() => go(measuring ? 'session' : 'setup')} onReRegister={() => { setRegistration(true); go('setup') }} />
        )}
        {page === 'setup' && (
          <>
            <p className="service-notice">
              {registration
                ? '내 기준 자세 등록: 현재 연결의 기준을 확인한 뒤 완료하세요. 잘못된 예시의 개인화 학습은 아직 연결되지 않았습니다.'
                : '현재 카메라 위치에 맞는 기준을 확인하세요.'}
            </p>
            <SetupPage startLabel={registration ? '등록 완료 · 홈으로' : '측정 시작'} camera={camera} mode={mode} onMode={changeMode} onStart={start}
              onCollect={() => setError('연구 수집은 좌측 연구·라벨 수집 화면에서 진행합니다.')} onCancel={() => go('home')} />
            {registration && <p>아래 시작 버튼은 이번 흐름에서 등록 완료로 처리되어 홈으로 이동합니다. 개인 기준 자료는 현재 연결에서만 유지됩니다.</p>}
          </>
        )}
        {session && (
          <section hidden={page !== 'session'}>
            <SessionPage key={session.id} camera={camera} collection={collection} mode={session.mode} rules={session.rules} alertsOn={true}
              onFinish={() => go('home')} onDashboard={() => go('dashboard')} onPrepare={() => go('setup')}
              service={{
                active: page === 'session', initial: session.initial, onCheckpoint: checkpoint, onEnded: finish, saveMessage,
                onRetry: () => { if (pending.current) saveResult(pending.current) },
              }} />
          </section>
        )}
        {page === 'settings' && (
          <SettingsPage serviceMode rules={rules} onRules={changeRules} alertsOn={true}
            onAlerts={() => setError('화면 알림은 유지합니다. 소리만 측정 화면에서 끌 수 있습니다.')}
            hasHistory={records.length > 0} onHasHistory={() => setError('서비스 미리보기에서는 실제 로컬 기록에 따라 표시합니다.')} />
        )}
        {page === 'profile' && (
          <ProfilePage form={form} onForm={setForm} onSave={() => saveProfile()} onHome={() => go('home')} onWithdraw={withdraw}
            onCancel={() => { setForm(profile ?? EMPTY_PROFILE); setError('변경을 취소했습니다.') }} />
        )}
      </main>
    </div>
  )
}
