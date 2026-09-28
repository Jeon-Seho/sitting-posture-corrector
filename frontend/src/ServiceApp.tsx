import { useEffect, useRef, useState } from 'react'
import { useCamera } from './hooks/useCamera'
import { useCollection } from './hooks/useCollection'
import { SetupPage } from './pages/SetupPage'
import { SessionPage } from './pages/SessionPage'
import { SettingsPage } from './pages/SettingsPage'
import { Card, Ledger, Stat } from './components/ui'
import { DEFAULT_RULES } from './data/posture'
import { formatDuration, formatPercent } from './lib/stats'
import type { LiveState, Machine, Rules } from './lib/engine'
import { KEYS, readLocal, writeLocal, upsertRecord, summary, resumeMachine, type Draft, type Profile, type RecordItem } from './lib/serviceStore'

type Page = 'home' | 'setup' | 'session' | 'dashboard' | 'settings' | 'profile'
type Session = { id: string; startedAt: string; mode: 'camera' | 'demo'; rules: Rules; initial?: Machine }
const day = (iso: string) => new Date(iso).toLocaleDateString('sv-SE')
export default function ServiceApp() {
  const camera = useCamera()
  const [profile, setProfile] = useState<Profile | null>(() => readLocal(KEYS.profile, null))
  const [authed, setAuthed] = useState(false)
  const [page, setPage] = useState<Page>('home')
  const [records, setRecords] = useState<RecordItem[]>(() => readLocal(KEYS.records, []))
  const [rules, setRules] = useState<Rules>(() => readLocal(KEYS.settings, DEFAULT_RULES))
  const [mode, setMode] = useState<'camera' | 'demo'>(() => readLocal<string>(KEYS.mode, 'camera') === 'demo' ? 'demo' : 'camera')
  const collection = useCollection(camera, rules)
  const [session, setSession] = useState<Session | null>(null)
  const [draft, setDraft] = useState<Draft | null>(() => readLocal(KEYS.draft, null))
  const [saveMessage, setSaveMessage] = useState('이 브라우저' + '에 결과를 저장하고 있습니다.')
  const pending = useRef<RecordItem | null>(null)
  const [error, setError] = useState('')
  const [registration, setRegistration] = useState(false)
  const [name, setName] = useState(profile?.name ?? '')
  const [age, setAge] = useState(profile?.age ?? 23)
  const [occupation, setOccupation] = useState(profile?.occupation ?? '')
  const [consent, setConsent] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const ended = useRef(false)
  useEffect(() => {
    if (authed) void camera.connect()
  }, [authed])
  useEffect(() => { try { writeLocal(KEYS.mode, mode) } catch { /* 모드 기억은 편의 기능이라 실패해도 진행한다. */ } }, [mode])
  const go = (next: Page) => { setError(''); setPage(next) }
  function saveProfile(notify = true) {
    if (!name.trim() || !occupation.trim() || age < 1 || age > 120) { setError('이름·나이·직업을 확인해 주세요.'); return false }
    const next = { name: name.trim(), age, occupation: occupation.trim() }
    try { writeLocal(KEYS.profile, next); setProfile(next); setError(notify ? '저장했습니다.' : ''); return true }
    catch { setError('브라우저에 저장하지 못했습니다. 저장 공간과 권한을 확인해 주세요.'); return false }
  }
  function start() {
    if (pending.current) { setError('이전 결과 저장을 완료한 뒤 새 측정을 시작해 주세요.'); return }
    if (registration) { setRegistration(false); go('home'); return }
    if (session && !ended.current) { go('session'); return }
    const next = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), mode, rules: { ...rules } }
    ended.current = false; pending.current = null; setSaveMessage('저장 대기'); setSession(next); go('session')
  }
  function saveResult(record: RecordItem) {
    try {
      const next = upsertRecord(readLocal<RecordItem[]>(KEYS.records, []), record)
      writeLocal(KEYS.records, next); localStorage.removeItem(KEYS.draft)
      setRecords(next); setDraft(null); pending.current = null
      setSaveMessage('이 브라우저에 저장했습니다. 홈과 대시보드에 반영되었습니다.')
    } catch { pending.current = record; setSaveMessage('저장하지 못했습니다. 결과는 유지됩니다. 자동 재시도하거나 저장 다시 시도를 눌러 주세요.') }
  }
  useEffect(() => { const timer = setInterval(() => { if (pending.current) saveResult(pending.current) }, 5000); return () => clearInterval(timer) }, [])
  function finish(live: LiveState) {
    if (!session) return
    ended.current = true
    saveResult({ id: session.id, startedAt: session.startedAt, endedAt: new Date().toISOString(), mode: session.mode, valid: live.validSeconds, good: live.goodSeconds, total: live.totalSeconds, events: live.events })
  }
  function checkpoint(machine: Machine) {
    if (!session || ended.current) return
    try { writeLocal(KEYS.draft, { ...session, machine }); } catch { setError('중간 기록을 저장하지 못했습니다. 새로고침 시 기록을 잃을 수 있습니다.') }
  }
  function restore() {
    if (!draft) return
    ended.current = false; setMode(draft.mode)
    setSession({ ...draft, initial: resumeMachine(draft.machine) }); setDraft(null); go('session')
  }
  const profileFields = <>
    <label className="field">이름<input className="input" value={name} onChange={e => setName(e.target.value)} required maxLength={50}/></label>
    <label className="field">나이<input className="input" type="number" min={1} max={120} value={age} onChange={e => setAge(Number(e.target.value))} required/></label>
    <label className="field">직업<input className="input" value={occupation} onChange={e => setOccupation(e.target.value)} required maxLength={80}/></label>
  </>
  if (!authed) return <div className="service-login"><div className="service-login-card"><div className="brand-name">POSEGOOD / V2</div><h1>내 자세를 알아가는 시간</h1><p>계정 서버 연결 전 미리보기입니다. 프로필과 측정 요약은 이 브라우저에만 저장합니다.</p><form onSubmit={e => { e.preventDefault(); if (saveProfile(false)) { setAuthed(true); setRegistration(!profile); setPage(profile ? 'home' : 'setup') } }}>{profileFields}<p className="fine">시작하면 카메라 준비를 요청합니다. 허용하지 않아도 홈과 시연을 이용할 수 있습니다.</p><button className="btn btn-primary btn-lg" type="submit">{profile ? '내 프로필로 시작' : '프로필 만들고 시작'}</button></form>{error && <p role="alert">{error}</p>}<a href="?research=1">기존 연구·라벨 수집 화면</a></div></div>
  const today = day(new Date().toISOString())
  const modeRecords = records.filter(r => r.mode === mode)
  const currentRecords = modeRecords.filter(r => day(r.endedAt) === today)
  const stats = summary(page === 'home' ? currentRecords : modeRecords)
  return <div className="shell">
    <video ref={camera.videoRef} className="capture-source" muted playsInline aria-hidden="true"/>
    <aside className="sidebar"><div className="brand"><span className="brand-mark">PG</span><div><div className="brand-name">POSEGOOD</div><div className="brand-sub">내 기준으로, 꾸준히</div></div></div>
      <nav className="nav" aria-label="주요 화면">{([['home','홈'],['setup','측정 준비'],['session','실시간 측정'],['dashboard','대시보드'],['settings','측정 설정']] as [Page,string][]).map(([id,label]) => <button className="nav-item" key={id} aria-current={page === id} onClick={() => go(id === 'session' && !session ? 'setup' : id)}>{label}</button>)}</nav>
      <div className="sidebar-foot"><span>로컬 미리보기 · 서버 미연결</span><a className="sidebar-link" href="?research=1" onClick={e => { if (session && !ended.current && !confirm('연구 화면으로 이동하면 현재 측정이 중단됩니다. 중간 저장 지점에서 복구할 수 있습니다. 이동할까요?')) e.preventDefault() }}>연구·라벨 수집</a><button className="btn" onClick={() => { if (pending.current) { setError('결과 저장을 완료한 뒤 나가 주세요.'); return } camera.stop(); setAuthed(false); setSession(null); setDraft(readLocal(KEYS.draft, null)) }}>나가기</button></div>
    </aside>
    <main className="main service-main">
      <div className="service-status"><span>{camera.state === 'on' ? '카메라 사용 중' : camera.state === 'loading' ? '카메라 준비 중' : '카메라 꺼짐'}</span><button className="btn btn-sm" disabled={camera.state === 'loading'} onClick={() => camera.state === 'on' ? camera.stop() : void camera.connect()}>{camera.state === 'on' ? '카메라 끄기' : '카메라 켜기'}</button></div>
      {error && <p role="status" className="service-notice">{error}</p>}
      {draft && !session && <Card title="중단된 측정이 있습니다"><p>마지막 저장 지점까지 복구합니다. 복구 후 직접 측정 재개를 눌러 주세요.</p><div className="row"><button className="btn btn-primary" onClick={restore}>이어하기</button><button className="btn" onClick={() => { const m = draft.machine; saveResult({ id: draft.id, startedAt: draft.startedAt, endedAt: new Date().toISOString(), mode: draft.mode, total: m.total, valid: Math.max(0,m.total-m.paused-m.unknown),good:m.good,events:resumeMachine(m).events }); }}>여기까지 종료·저장</button></div></Card>}
      {(page === 'home' || page === 'dashboard') && <>
        <div className="page-head"><div><h1 className="page-title">{page === 'home' ? `${profile?.name}님의 오늘` : '측정 기록'}</h1><p className="page-desc">{today} 기준 · {page === 'home' ? '오늘' : '이 브라우저 전체'} 기록 · {mode === 'camera' ? '실제 웹캠 기록만 집계' : '합성 시연 기록만 집계'}</p></div><button className="btn btn-primary" onClick={() => go(session && !ended.current ? 'session' : 'setup')}>{session && !ended.current ? '진행 중인 측정으로' : '측정 시작'}</button></div>
        <Ledger cols={4}><Stat label="기준 자세 유지율" value={formatPercent(stats.rate)}/><Stat label="유효 측정 시간" value={formatDuration(stats.valid)}/><Stat label="붕괴 사건" value={`${stats.count}건`}/><Stat label="측정 기록" value={`${(page === 'home' ? currentRecords : modeRecords).length}회`}/></Ledger>
        <Card title="기록별 유지율" note="유효 시간이 없는 기록은 유지율을 계산하지 않습니다.">{(page === 'home' ? currentRecords : modeRecords).length === 0 ? <div className="empty"><h2>아직 측정 기록이 없습니다</h2><p>첫 측정을 마치면 여기에 결과가 쌓입니다.</p></div> : (page === 'home' ? currentRecords : modeRecords).map(r => <div className="service-record" key={r.id}><div><strong>{new Date(r.startedAt).toLocaleString()}</strong><span> {r.mode === 'demo' ? '합성 시연' : '실제 웹캠'} · {formatDuration(r.valid)} · {r.events.length}건</span></div><div className="service-bar"><span style={{width:`${r.valid ? r.good/r.valid*100 : 0}%`}}/></div><b>{formatPercent(r.valid ? r.good/r.valid : null)}</b></div>)}</Card>
        {page === 'home' && <button className="btn" onClick={() => { setRegistration(true); go('setup') }}>내 기준 자세 다시 등록</button>}
      </>}
      {page === 'setup' && <><p className="service-notice">{registration ? '내 기준 자세 등록: 현재 연결의 기준을 확인한 뒤 완료하세요. 잘못된 예시의 개인화 학습은 아직 연결되지 않았습니다.' : '현재 카메라 위치에 맞는 기준을 확인하세요.'}</p><SetupPage startLabel={registration ? '등록 완료 · 홈으로' : '측정 시작'} camera={camera} mode={mode} onMode={next => { if (session && !ended.current) { setError('진행 중인 측정을 종료한 후 모드를 바꿔 주세요.'); return } camera.stop(); setMode(next) }} onStart={start} onCollect={() => setError('연구 수집은 좌측 연구·라벨 수집 화면에서 진행합니다.')} onCancel={() => go('home')}/>{registration && <p>아래 시작 버튼은 이번 흐름에서 등록 완료로 처리되어 홈으로 이동합니다. 개인 기준 자료는 현재 연결에서만 유지됩니다.</p>}</>}
      {session && <section hidden={page !== 'session'}><SessionPage key={session.id} camera={camera} collection={collection} mode={session.mode} rules={session.rules} alertsOn={true} onFinish={() => go('home')} onDashboard={() => go('dashboard')} onPrepare={() => go('setup')} service={{active:page === 'session', initial:session.initial, onCheckpoint:checkpoint,onEnded:finish,saveMessage,onRetry:() => { if(pending.current)saveResult(pending.current) }}}/></section>}
      {page === 'settings' && <SettingsPage serviceMode rules={rules} onRules={next => { try { writeLocal(KEYS.settings,next);setRules(next);setError('저장했습니다. 다음 측정부터 적용합니다.') }catch{setError('설정을 저장하지 못했습니다.')} }} alertsOn={true} onAlerts={() => setError('화면 알림은 유지합니다. 소리만 측정 화면에서 끌 수 있습니다.')} hasHistory={records.length > 0} onHasHistory={() => setError('서비스 미리보기에서는 실제 로컬 기록에 따라 표시합니다.')}/>}
      {page === 'profile' && <><div className="page-head"><h1 className="page-title">프로필 설정</h1><button className="btn" onClick={() => go('home')}>홈으로</button></div><div className="grid g2"><Card title="기본 정보"><form onSubmit={e=>{e.preventDefault();saveProfile()}}>{profileFields}<button className="btn btn-primary">변경 저장</button><button className="btn" type="button" onClick={()=>{setName(profile?.name??'');setAge(profile?.age??23);setOccupation(profile?.occupation??'');setError('변경을 취소했습니다.')}}>취소</button></form></Card><Card title="비밀번호 변경"><p>이 미리보기는 실제 인증을 사용하지 않습니다. 비밀번호 변경은 인증 API 연결 후 제공됩니다.</p><button className="btn" disabled>인증 서버 연결 필요</button></Card></div><Card title="회원 탈퇴"><p>현재는 서버 계정이 없습니다. 아래 동작은 이 브라우저에 저장한 프로필·설정·측정 요약을 지웁니다. 연구 화면에서 내려받은 CSV는 삭제하지 않습니다.</p><button className="btn btn-danger" onClick={()=>setDeleting(true)}>탈퇴 흐름 확인</button>{deleting && <div><label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>학습용 자료 사용에 동의합니다 (선택)</label><p>{consent ? '학습용 보관 정책과 서버가 미연결되어 동의 상태의 실제 처리는 지원하지 않습니다.' : '학습용 보관 없이 이 브라우저의 사용자 자료를 삭제합니다. 이 화면은 스켈레톤을 영구 저장하지 않습니다.'}</p><button className="btn" onClick={()=>setDeleting(false)}>취소</button><button className="btn btn-danger" disabled={consent} onClick={()=>{try{Object.values(KEYS).forEach(k=>localStorage.removeItem(k));camera.stop();setProfile(null);setRecords([]);setDraft(null);setSession(null);pending.current=null;setAuthed(false);setName('');setOccupation('');setAge(23);setDeleting(false);setError('이 브라우저의 사용자 자료를 삭제했습니다.')}catch{setError('자료를 모두 삭제하지 못했습니다. 다시 시도해 주세요.')}}}>로컬 자료 삭제 확정</button></div>}</Card></>}
    </main><button className="profile-dock" onClick={()=>go('profile')}>{profile?.name} · 프로필 설정</button>
  </div>
}
