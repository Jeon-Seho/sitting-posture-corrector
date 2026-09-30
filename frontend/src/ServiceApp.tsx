import { useEffect, useRef, useState } from 'react'
import { useCamera } from './hooks/useCamera'
import { useCollection } from './hooks/useCollection'
import { useWriterLock } from './hooks/useWriterLock'
import { SetupPage } from './pages/SetupPage'
import { SessionPage } from './pages/SessionPage'
import { SettingsPage } from './pages/SettingsPage'
import { LoginPage } from './pages/LoginPage'
import { HomePage } from './pages/HomePage'
import { DashboardPage } from './pages/DashboardPage'
import { CollectionPage } from './pages/CollectionPage'
import { LocalHistory } from './pages/LocalHistory'
import { ChartBar, Crosshair, GearSix, House, Record, SignOut, Tag, UserCircle, type Icon } from '@phosphor-icons/react'
import { Card } from './components/ui'
import { DEFAULT_RULES } from './data/posture'
import type { LiveState, Machine, Rules } from './lib/engine'
import { KEYS, readLocal, writeLocal, upsertRecord, loadLocalState, saveDraft, removeSavedDraft, recordFromDraft, resumeMachine, validProfile, type Draft, type RecordItem } from './lib/serviceStore'

type Page = 'home' | 'setup' | 'session' | 'collection' | 'dashboard' | 'settings' | 'profile'
const NAV: [Page, string, Icon][] = [['home','홈',House],['setup','측정 준비',Crosshair],['session','실시간 측정',Record],['collection','자세 등록',Tag],['dashboard','대시보드',ChartBar],['settings','설정',GearSix],['profile','프로필 설정',UserCircle]]
const CAMERA_PAGES: Page[] = ['setup', 'session', 'collection']
const SUB_TABS:Partial<Record<Page, Page[]>> = { session: ['setup', 'session'], profile: ['settings', 'profile'] }
type Session = { id: string; startedAt: string; mode: 'camera' | 'demo'; rules: Rules; initial?: Machine }
export default function ServiceApp() {
  const camera = useCamera()
  const writer = useWriterLock()
  const [initial] = useState(loadLocalState)
  const [storageIssues, setStorageIssues] = useState(initial.issues)
  const [profile, setProfile] = useState(initial.profile)
  const [authed, setAuthed] = useState(false)
  const [page, setPage] = useState<Page>('home')
  const [records, setRecords] = useState(initial.records)
  const [rules, setRules] = useState<Rules>(initial.settings)
  const [showDemo, setShowDemo] = useState(initial.demo)
  const collection = useCollection(camera, rules)
  const [session, setSession] = useState<Session | null>(null)
  const [draft, setDraft] = useState(initial.draft)
  const [saveMessage, setSaveMessage] = useState('이 브라우저' + '에 결과를 저장하고 있습니다.')
  const pending = useRef<RecordItem | null>(null)
  const [error, setError] = useState('')
  const [registration, setRegistration] = useState(false)
  const [name, setName] = useState(profile?.name ?? '')
  const [age, setAge] = useState(profile?.age ?? 23)
  const [occupation, setOccupation] = useState(profile?.occupation ?? '')
  const [consent, setConsent] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const ended = useRef(false)
  const measuring = !!session && !ended.current
  const canWrite = writer.state === 'ready' && storageIssues.length === 0
  const writable = useRef(canWrite); writable.current = canWrite
  const requireWriter = () => {
    if (writable.current) return true
    setError('저장소 안내를 확인해 주세요. 자료를 변경하거나 새 측정을 시작할 수 없습니다.'); return false
  }
  function reloadStorage() {
    const next = loadLocalState()
    setStorageIssues(next.issues); setRecords(next.records)
    if (!measuring) {
      setProfile(next.profile); setRules(next.settings); setShowDemo(next.demo); setDraft(next.draft)
      setName(next.profile?.name ?? ''); setAge(next.profile?.age ?? 23); setOccupation(next.profile?.occupation ?? '')
    }
  }
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (event.key === null || Object.values(KEYS).some(key => key === event.key)) reloadStorage() }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [measuring])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!measuring && !pending.current) return
      event.preventDefault(); event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [measuring])
  const storageNotice = <>
    {writer.state !== 'ready' && <p role="status">{writer.state === 'checking' ? '저장소 사용 상태를 확인하고 있습니다.' : writer.state === 'busy' ? '다른 탭에서 이 앱을 사용 중입니다. 여기서는 기록을 볼 수 있습니다. 변경하려면 기존 탭을 닫고 다시 확인해 주세요.' : '이 브라우저에서는 안전한 동시 저장을 지원하지 않습니다. 최신 Chrome의 localhost 또는 HTTPS에서 열어 주세요.'}{writer.state === 'busy' && <button className="btn btn-sm" onClick={() => { reloadStorage(); writer.retry() }}>저장 권한 다시 확인</button>}</p>}
    {storageIssues.length > 0 && <div role="alert">{storageIssues.map(issue => <p key={issue}>{issue}</p>)}<p>원본 자료를 지우거나 덮어쓰지 않았습니다. 저장소를 다시 읽거나 기존 자료를 확인해 주세요.</p><button className="btn btn-sm" onClick={reloadStorage}>저장소 다시 읽기</button></div>}
  </>
  // 카메라는 측정 준비에서 직접 켜고, 카메라가 필요 없는 화면으로 나가면 끈다. 진행 중인 측정은 유지한다.
  const go = (next: Page) => { setError(''); if (!CAMERA_PAGES.includes(next) && !measuring) camera.stop(); setPage(next) }
  function openCollection() {
    if (measuring) { setError('진행 중인 측정을 종료한 뒤 자세 등록으로 이동해 주세요.'); return }
    go('collection')
  }
  useEffect(() => {
    if (!confirmDelete) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setConfirmDelete(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [confirmDelete])
  function withdraw() {
    if (!requireWriter() || measuring || pending.current) return
    try {
      // Keep the profile until the other keys are removed, so a failed deletion remains visible.
      [KEYS.records, KEYS.draft, KEYS.settings, KEYS.demo, KEYS.profile].forEach(key => localStorage.removeItem(key))
      camera.stop(); setProfile(null); setRecords([]); setDraft(null); setSession(null); pending.current = null
      setRules(DEFAULT_RULES); setShowDemo(false); setRegistration(false); setAuthed(false)
      setName(''); setOccupation(''); setAge(23); setDeleting(false); setConsent(false); setConfirmDelete(false)
      setError('이 브라우저의 사용자 자료를 삭제했습니다.')
    } catch { setConfirmDelete(false); reloadStorage(); setError('자료를 모두 삭제하지 못했습니다. 남은 자료를 다시 확인한 뒤 시도해 주세요.') }
  }
  function saveProfile(notify = true) {
    if (!requireWriter()) return false
    const next = { name: name.trim(), age, occupation: occupation.trim() }
    if (!validProfile(next)) { setError('이름·나이·직업을 확인해 주세요. 나이는 1~120 사이의 정수로 입력해 주세요.'); return false }
    try { writeLocal(KEYS.profile, next); setProfile(next); setError(notify ? '저장했습니다.' : ''); return true }
    catch { setError('브라우저에 저장하지 못했습니다. 저장 공간과 권한을 확인해 주세요.'); return false }
  }
  function start() {
    if (!requireWriter()) return
    if (pending.current) { setError('이전 결과 저장을 완료한 뒤 새 측정을 시작해 주세요.'); return }
    if (session && !ended.current) { go('session'); return }
    try {
      const saved = readLocal<Draft | null>(KEYS.draft, null)
      if (saved && !readLocal<RecordItem[]>(KEYS.records, []).some(r => r.id === saved.id)) {
        setDraft(saved); setError('중단된 측정을 이어하거나 종료·저장한 뒤 새 측정을 시작해 주세요.'); return
      }
    } catch (cause) { setError((cause as Error).message); reloadStorage(); return }
    if (camera.state !== 'on' || !camera.baseline || !camera.quality || camera.progress !== null) {
      setError('카메라 연결과 기준 등록을 완료한 뒤 시작해 주세요.'); return
    }
    if (registration) { setRegistration(false); go('home'); return }
    // New sessions use the real webcam; existing synthetic records/drafts remain available.
    const next = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), mode: 'camera' as const, rules: { ...rules } }
    ended.current = false; pending.current = null; setSaveMessage('저장 대기'); setSession(next); go('session')
  }
  function saveResult(record: RecordItem) {
    pending.current = record
    if (!requireWriter()) { setSaveMessage('결과는 유지됩니다. 저장소 안내를 확인한 뒤 저장 다시 시도를 눌러 주세요.'); return }
    try {
      const next = upsertRecord(readLocal<RecordItem[]>(KEYS.records, []), record)
      writeLocal(KEYS.records, next)
      setRecords(next); setDraft(old => old?.id === record.id ? null : old); pending.current = null
      setSaveMessage('이 브라우저에 저장했습니다. 홈과 대시보드에 반영되었습니다.')
      try { removeSavedDraft(record.id) } catch { setError('결과는 저장했습니다. 중간 기록 정리에 실패했지만 같은 세션을 다시 측정하지 않습니다.') }
    } catch { pending.current = record; setSaveMessage('저장하지 못했습니다. 결과는 유지됩니다. 자동 재시도하거나 저장 다시 시도를 눌러 주세요.') }
  }
  useEffect(() => { const timer = setInterval(() => { if (pending.current) saveResult(pending.current) }, 5000); return () => clearInterval(timer) }, [])
  function finish(live: LiveState) {
    if (!session) return
    ended.current = true
    saveResult({ id: session.id, startedAt: session.startedAt, endedAt: new Date().toISOString(), mode: session.mode, rules: session.rules, valid: live.validSeconds, good: live.goodSeconds, total: live.totalSeconds, events: live.events })
  }
  function checkpoint(machine: Machine) {
    if (!session || ended.current) return
    if (!writable.current) { setError('중간 기록을 저장할 수 없습니다. 새로고침 시 기록을 잃을 수 있습니다.'); return }
    try { saveDraft({ id: session.id, startedAt: session.startedAt, mode: session.mode, rules: session.rules, savedAt: new Date().toISOString(), machine }); } catch { setError('중간 기록을 저장하지 못했습니다. 새로고침 시 기록을 잃을 수 있습니다.') }
  }
  function restore() {
    if (!draft || !requireWriter()) return
    ended.current = false
    setSession({ ...draft, initial: resumeMachine(draft.machine) }); setDraft(null); go('session')
  }
  const profileFields = <>
    <label className="field">이름<input className="input" disabled={!canWrite} value={name} onChange={e => setName(e.target.value)} required maxLength={50}/></label>
    <label className="field">나이<input className="input" disabled={!canWrite} type="number" min={1} max={120} value={age} onChange={e => setAge(Number(e.target.value))} required/></label>
    <label className="field">직업<input className="input" disabled={!canWrite} value={occupation} onChange={e => setOccupation(e.target.value)} required maxLength={80}/></label>
  </>
  if (!authed) return <LoginPage title={profile ? `${profile.name}님, 다시 오셨네요` : '시작하기'} lead="계정 서버 연결 전 미리보기입니다. 프로필과 측정 요약은 이 브라우저에만 저장합니다." submitLabel={profile ? canWrite ? '내 프로필로 시작' : '저장된 프로필로 보기' : '프로필 만들고 시작'} fine="카메라는 ‘측정 준비’에서 직접 켤 때만 사용합니다. 카메라 없이도 홈과 저장된 기록을 볼 수 있습니다." onSubmit={() => { if (profile && !canWrite) { setAuthed(true); setPage('home'); return } if (saveProfile(false)) { setDraft(loadLocalState().draft); setAuthed(true); setRegistration(!profile); setPage(profile ? 'home' : 'setup') } }} footer={<>{storageNotice}{error && <p role="alert" className="fine">{error}</p>}</>}>{profileFields}</LoginPage>
  return <div className="shell">
    <video ref={camera.videoRef} className="capture-source" muted playsInline aria-hidden="true"/>
    <aside className="sidebar"><div className="brand"><span className="brand-mark">PG</span><div><div className="brand-name">POSEGOOD</div><div className="brand-sub">내 기준으로, 꾸준히</div></div></div>
      <nav className="nav" aria-label="주요 화면">{NAV.filter(([id]) => !SUB_TABS[id] || SUB_TABS[id]!.includes(page) || (id === 'session' && measuring)).map(([id,label,NavIcon]) => <button className={SUB_TABS[id] ? 'nav-item nav-sub' : 'nav-item'} key={id} aria-current={page === id} onClick={() => id === 'collection' ? openCollection() : go(id === 'session' && !session ? 'setup' : id)}><NavIcon size={SUB_TABS[id] ? 16 : 20} weight={page === id ? 'fill' : 'bold'} className="icon"/>{label}</button>)}</nav>
      <div className="sidebar-foot"><span>개인 기준 규칙 v0.1 · LSTM 미연결</span><span>로컬 미리보기 · 서버 미연결</span><button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => { if (pending.current) { setError('결과 저장을 완료한 뒤 나가 주세요.'); return } camera.stop(); setAuthed(false); setSession(null); setDraft(loadLocalState().draft) }}><SignOut size={16} weight="bold" className="icon"/>로그아웃</button></div>
    </aside>
    <main className="main service-main">
      {storageNotice}
      {error && <p role="status" className="service-notice">{error}</p>}
      {draft && !session && <Card title="중단된 측정이 있습니다"><p>마지막 저장 지점{draft.savedAt ? ` (${new Date(draft.savedAt).toLocaleString()})` : ''}까지 복구합니다. 그 뒤 미저장 시간은 제외하며, 복구 후 직접 측정 재개를 눌러 주세요.</p><button className="btn btn-primary" disabled={!canWrite || !!pending.current} onClick={restore}>이어하기</button><button className="btn" disabled={!canWrite} onClick={() => { saveResult(pending.current ?? recordFromDraft(draft, draft.savedAt ?? new Date().toISOString())); }}>여기까지 종료·저장</button>{pending.current && <p role="status">{saveMessage}</p>}</Card>}
      {showDemo && page === 'home' && <HomePage hasHistory onStart={() => go(measuring ? 'session' : 'setup')} onDashboard={() => go('dashboard')}/>}
      {showDemo && page === 'dashboard' && <DashboardPage/>}
      {page === 'collection' && <CollectionPage camera={camera} collection={collection}/>}
      {!showDemo && (page === 'home' || page === 'dashboard') && <LocalHistory page={page} name={profile?.name ?? ''} records={records} measuring={measuring} onStart={() => go(measuring ? 'session' : 'setup')} onRegister={() => { setRegistration(true); go('setup') }}/>}
      {page === 'setup' && <><SetupPage startLabel={registration ? '등록 완료 · 홈으로' : '측정 시작'} camera={camera} onStart={start} onCollect={openCollection} onCancel={() => { camera.cancelCalibration(); go('home') }}/>{registration && <p>개인 기준 자료는 현재 카메라 연결에서만 유지됩니다. 카메라를 다시 연결하면 새 기준을 등록해야 합니다.</p>}</>}
      {session && <section hidden={page !== 'session'}><SessionPage key={session.id} camera={camera} collection={collection} mode={session.mode} rules={session.rules} alertsOn={true} onFinish={() => go('home')} onDashboard={() => go('dashboard')} onPrepare={() => go('setup')} service={{active:page === 'session', initial:session.initial, onCheckpoint:checkpoint,onEnded:finish,saveMessage,onRetry:() => { if(pending.current)saveResult(pending.current) }}}/></section>}
      {page === 'settings' && <SettingsPage serviceMode rules={rules} onRules={next => { if (!requireWriter()) return; try { writeLocal(KEYS.settings,next);setRules(next);setError('저장했습니다. 다음 측정부터 적용합니다.') }catch{setError('설정을 저장하지 못했습니다.')} }} alertsOn={true} onAlerts={() => setError('화면 알림은 유지합니다. 소리만 측정 화면에서 끌 수 있습니다.')} hasHistory={showDemo} onHasHistory={next => { if (!requireWriter()) return; try { writeLocal(KEYS.demo, next); setShowDemo(next) } catch { setError('시연 옵션을 저장하지 못했습니다.') } }}/>}
      {page === 'profile' && <div className="profile-page"><div className="page-head"><div><h1 className="page-title">프로필 설정</h1><p className="page-desc">이름·나이·직업은 이 브라우저에만 저장됩니다.</p></div><button className="btn" onClick={() => go('settings')}>설정으로</button></div>
        <div className="grid g2"><Card title="기본 정보"><form className="profile-form" onSubmit={e=>{e.preventDefault();saveProfile()}}>{profileFields}<div className="form-actions"><button className="btn" type="button" onClick={()=>{setName(profile?.name??'');setAge(profile?.age??23);setOccupation(profile?.occupation??'');setError('변경을 취소했습니다.')}}>취소</button><button className="btn btn-primary">변경 저장</button></div></form></Card>
          <Card title="비밀번호 변경"><p className="profile-text">이 미리보기는 실제 인증을 사용하지 않습니다. 비밀번호 변경은 인증 API 연결 후 제공됩니다.</p><div className="form-actions"><button className="btn" disabled>인증 서버 연결 필요</button></div></Card></div>
        <Card title="회원 탈퇴"><p className="profile-text">현재는 서버 계정이 없습니다. 아래 동작은 이 브라우저에 저장한 프로필·설정·측정 요약을 지웁니다. 자세 등록에서 내려받은 CSV 파일은 삭제하지 않습니다.</p>
          {!deleting && <div className="form-actions"><button className="btn btn-danger" disabled={!canWrite || measuring || !!pending.current} onClick={() => setDeleting(true)}>탈퇴하기</button></div>}
          {deleting && <div className="profile-delete"><label className="row"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>학습용 자료 사용에 동의합니다 (선택)</label><div className="form-actions"><button className="btn" onClick={() => { setDeleting(false); setConsent(false) }}>취소</button><button className="btn btn-danger" disabled={!canWrite || measuring || !!pending.current} onClick={() => setConfirmDelete(true)}>삭제하기</button></div></div>}
          {confirmDelete && <div className="confirm-backdrop" onClick={e => { if (e.target === e.currentTarget) setConfirmDelete(false) }}><div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="withdraw-title"><h2 id="withdraw-title">탈퇴하고 자료를 삭제할까요?</h2><p className="profile-text">{consent ? '학습용 보관 서버가 아직 연결되지 않아 동의 내용은 전달·보관되지 않습니다. 이 미리보기에서는 동의 여부와 관계없이 이 브라우저의 사용자 자료를 모두 삭제합니다.' : '학습용 보관 없이 이 브라우저의 사용자 자료를 삭제합니다. 이 화면은 스켈레톤을 영구 저장하지 않습니다.'}</p><div className="form-actions"><button className="btn" autoFocus onClick={() => setConfirmDelete(false)}>취소</button><button className="btn btn-danger" disabled={!canWrite || measuring || !!pending.current} onClick={withdraw}>확인</button></div></div></div>}
        </Card></div>}
    </main>
  </div>
}
