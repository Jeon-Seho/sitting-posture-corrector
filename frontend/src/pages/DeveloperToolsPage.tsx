import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Switch } from '../components/ui'
import { CameraFaultTests } from '../features/developer/CameraFaultTests'
import { CameraFaultPreview } from '../features/developer/CameraFaultPreview'
import { DeveloperPreviewDialog } from '../features/developer/DeveloperPreviewDialog'
import { InteractionPreview } from '../features/developer/DeveloperGroup'
import { AppearanceDiagnostics } from '../features/appearance/AppearanceSettings'
import { TrackingRateCheck } from '../features/camera/TrackingRateCheck'
import { reportConnectionLost } from '../features/connection/connectionLost'
import { CameraWindowTest } from '../features/developer/CameraWindowTest'
import { AlertPreview } from '../features/desktop/AlertPreview'
import { probeAcceleration, type PerformanceNotice } from '../features/camera/acceleration'
import { PerformanceDialog } from '../features/camera/CameraPerformanceDialog'
import { CAMERA_ERRORS } from '../features/camera/errors'
import type { CameraController } from '../hooks/useCamera'
import { ErrorPage, ERROR_PAGES } from './ErrorPage'
import { ThemeIllustration } from '../features/appearance/ThemeIllustration'
import { desktopBridge } from '../features/desktop/bridge'
import { useAppearance } from '../features/appearance/theme'

const SECTIONS = [ ['errors', '오류 페이지'], ['camera', '카메라·인식'], ['alerts', '알림·연결'], ['appearance', '화면·모션'], ['records', '기록·수집'], ['diagnostics', '상태·버전'] ] as const
type SectionId = typeof SECTIONS[number][0]
const WEB_ERRORS = [['request', '400번대'], ['server', '500번대'], ['offline', '인터넷 끊김'], ['app', '앱 오류'], ['connecting', '연결 중 (앱)']] as const
const ERROR_LABELS: Record<keyof typeof CAMERA_ERRORS, string> = { unsupported: '지원하지 않는 환경', preparationTimeout: '준비 시간 초과', videoUnavailable: '영상 준비 실패', disconnected: '연결 끊김', trackingFailed: '추적 실패', permissionDenied: '권한 거부', deviceMissing: '카메라 없음', deviceBusy: '다른 앱에서 사용 중', deviceUnavailable: '선택 카메라 사용 불가', preparationFailed: '모델·카메라 로드 실패', aspectUnsupported: '4:3 화면 불가' }
function Tool({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <article className="dev-tool-card"><h3>{title}</h3>{description && <p className="setting-desc">{description}</p>}{children}</article>
}

export function DeveloperToolsPage({ camera, hasHistory, onHasHistory, onCollect, onCamera, onSettings, onRecords, onCalendar }: {
  camera: CameraController; hasHistory: boolean; onHasHistory: (enabled: boolean) => void; onCollect: () => void
  onCamera: () => void; onSettings: () => void; onRecords: () => void; onCalendar: () => void
}) {
  const [active, setActive] = useState<SectionId>('errors')
  const desktop = !!desktopBridge()
  const appearance = useAppearance()
  const connectingUrl = `/offline.html?${new URLSearchParams({ mode: appearance.mode, accent: appearance.accent })}`
  const tabsId = useId()
  const tabs = useRef<Partial<Record<SectionId, HTMLButtonElement | null>>>({})
  const [simulation, setSimulation] = useState<PerformanceNotice | null>(null)
  const [notice, setNotice] = useState<PerformanceNotice | null>(null)
  const [selectedError, setSelectedError] = useState<keyof typeof CAMERA_ERRORS>('permissionDenied')
  const [selectedNotice, setSelectedNotice] = useState<PerformanceNotice>('cpu')
  const [errorPreview, setErrorPreview] = useState<keyof typeof CAMERA_ERRORS | null>(null)
  const [interaction, setInteraction] = useState(false)
  const [webError, setWebError] = useState<typeof WEB_ERRORS[number][0]>('server')
  const [webErrorPreview, setWebErrorPreview] = useState(false)
  const [renderFailure, setRenderFailure] = useState(false)
  const errorContent = webError === 'connecting' ? { art: 504 as const, title: '연결하는 중이에요', description: '잠시만 기다려 주세요.' } : ERROR_PAGES[webError]
  if (renderFailure) throw new Error('Synthetic developer test: screen rendering failure')
  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? SECTIONS.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + SECTIONS.length) % SECTIONS.length
    const id = SECTIONS[next][0]
    setActive(id)
    tabs.current[id]?.focus()
  }
  function section(id: SectionId, description: string, children: ReactNode) {
    if (active !== id) return null
    return <section className="dev-section" role="tabpanel" tabIndex={0} id={`${tabsId}-panel-${id}`} data-dev-section={id} aria-labelledby={`${tabsId}-tab-${id}`}>
      <div className="dev-section-heading"><h2>{SECTIONS.find(([key]) => key === id)![1]}</h2><p>{description}</p></div>
      <div className="dev-tool-grid">{children}</div>
    </section>
  }
  return <div className="developer-page">
    <div className="page-head"><div><h1 className="page-title">개발자 도구</h1><p className="page-desc">화면을 직접 열어 확인하고, 실제 기능으로 이어서 테스트하세요.</p></div></div>
    <div className="dev-jump-nav" role="tablist" aria-label="개발자 도구 종류">{SECTIONS.map(([id, label], index) => <button className="chip" role="tab" key={id} id={`${tabsId}-tab-${id}`} aria-controls={`${tabsId}-panel-${id}`} aria-selected={active === id} tabIndex={active === id ? 0 : -1} ref={node => { tabs.current[id] = node }} onClick={() => setActive(id)} onKeyDown={event => moveTab(event, index)}>{label}</button>)}</div>
    {section('errors', '오류를 선택하고 같은 그림·설명으로 사용자 안내 화면을 재현해요.', <>
      <Tool title="오류 목록" description="확인할 오류 한 가지를 선택해 주세요.">
        <div className="dev-error-picker" role="group" aria-label="웹 오류 종류">{WEB_ERRORS.map(([kind, label]) => <button className="dev-error-option" key={kind} data-error-kind={kind} aria-pressed={webError === kind} onClick={() => setWebError(kind)}><strong>{label}</strong><span>{kind === 'connecting' ? '연결하는 중이에요' : ERROR_PAGES[kind].title}</span></button>)}</div>
      </Tool>
      <Tool title={errorContent.title}>
        <ThemeIllustration className="dev-error-art" kind={`error-${errorContent.art}`} width="320" height="220" />
        <p className="setting-desc">{errorContent.description}</p>
        <div className="dev-tool-actions"><button className="btn btn-primary" onClick={() => setWebErrorPreview(true)}>선택한 오류 재현</button>
        <button className="btn btn-ghost" onClick={() => window.location.assign(webError === 'connecting' ? connectingUrl : `/error/${webError}`)}>실제 오류 페이지 열기</button></div>
        {webError === 'app' && <button className="chip" onClick={() => setRenderFailure(true)}>앱 오류 재현</button>}
        <p className="fine">재현은 서버 상태를 바꾸지 않아요. 실제 페이지로 이동하면 홈으로 돌아가 복구할 수 있어요.</p>
      </Tool>
    </>)}
    {section('camera', '카메라 준비·복구 화면과 실제 장치 동작을 한곳에서 확인해요.', <>
      <Tool title="GPU·CPU 복구 테스트"><CameraFaultTests compact /></Tool>
      <Tool title="카메라 오류 화면" description="확인할 오류를 고르고 실제 사용자 안내 화면을 열어요.">
        <div className="dev-select-action"><label>오류 상황<select aria-label="카메라 오류 상황" value={selectedError} onChange={event => setSelectedError(event.target.value as keyof typeof CAMERA_ERRORS)}>{Object.entries(ERROR_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <button className="btn btn-sm" onClick={() => setErrorPreview(selectedError)}>오류 화면 열기</button></div>
      </Tool>
      <Tool title="그래픽 가속 상태" description="현재 기기의 그래픽 가속 지원 상태를 직접 점검해요.">
        <button className="btn btn-sm" onClick={() => setNotice(probeAcceleration())}>현재 그래픽 가속 확인</button>
      </Tool>
      <Tool title="성능 안내 팝업" description="사용자에게 보여줄 안내 한 가지를 선택해 확인해요.">
        <div className="dev-select-action"><label>안내 상황<select aria-label="성능 안내 상황" value={selectedNotice} onChange={event => setSelectedNotice(event.target.value as PerformanceNotice)}><option value="cpu">CPU 전환 안내</option><option value="limited">가속 제한 안내</option><option value="unknown">가속 확인 불가 안내</option></select></label>
        <button className="btn btn-sm" onClick={() => setSimulation(selectedNotice)}>안내 팝업 열기</button></div>
      </Tool>
      <Tool title="실제 카메라 연결" description="측정하기로 이동해 카메라 연결과 영상 상태를 확인해요.">
        <button className="btn btn-sm" onClick={onCamera}>측정하기에서 카메라 확인</button>
        <p className="fine">카메라 {camera.state} · {camera.metrics.delegate} · {camera.metrics.fps.toFixed(1)} FPS · 추론 {camera.metrics.inferenceMs.toFixed(1)} ms</p>
      </Tool>
      <Tool title="추적 속도·떨림 점검" description="카메라를 켠 뒤 속도를 조정하거나 떨림을 점검해요."><TrackingRateCheck camera={camera} /></Tool>
      <Tool title="작은 카메라 창"><CameraWindowTest /></Tool>
    </>)}
    {section('alerts', '앱 안 알림·앱 밖 팝업과 연결 장애 안내를 실제 표시 위치에서 확인해요.', <>
      <Tool title="알림 표시"><AlertPreview /></Tool>
      <Tool title="서버 연결 끊김" description="실제 장애 안내 팝업을 열어요. 테스트 종료로 돌아오며 실제 서버 연결은 바꾸지 않아요."><button className="chip" onClick={() => reportConnectionLost({ reason: 'test' })}>끊김 화면 확인</button></Tool>
    </>)}
    {section('appearance', '테마는 실제 앱에 적용하고, 준비 단계·차트·설명 표시는 별도 화면에서 확인해요.', <>
      <Tool title="앱 테마·아이콘" description="설정의 실제 화면 꾸미기로 이동해 테마·밝기·아이콘 적용을 확인해요."><button className="btn btn-sm" onClick={onSettings}>화면 꾸미기 열기</button><AppearanceDiagnostics /></Tool>
      <Tool title="준비 단계·차트·설명 표시"><button className="chip" onClick={() => setInteraction(true)}>화면·모션 미리보기 열기</button></Tool>
    </>)}
    {section('records', '예시 데이터를 실제 오늘·기록 화면에서 보고, 자세 데이터 수집 화면으로 이동해요.', <>
      <Tool title="자세 데이터 수집 · /dev" description="카메라·수치 그래프·리플레이가 있는 동작 관측 화면에서 수집하고 JSON으로 내려받아요."><a className="btn btn-primary" href="/dev" target={desktop ? '_self' : '_blank'} rel="noopener noreferrer">자세 데이터 수집 열기 (/dev)</a><p className="fine">{desktop ? '앱의 현재 창에서 열어요.' : '새 탭에서 열어요.'} 카메라와 수집은 수집 화면에서 직접 시작해 주세요.</p></Tool>
      <Tool title="기존 CSV 수집" description="자세 종류와 촬영 길이를 고르는 이전 수집 도구예요. /dev 관측 화면과는 별도입니다."><button className="btn btn-sm" onClick={onCollect}>기존 CSV 수집 열기</button></Tool>
      <Tool title="발표용 테스트 데이터" description="최신 KST 날짜 · 현재 기록 형식 · 오늘의 짧은 측정 포함">
        <div className="dev-tool-actions"><span>{hasHistory ? '예시 데이터 켜짐' : '예시 데이터 꺼짐'}</span><Switch checked={hasHistory} onChange={onHasHistory} label="발표용 예시 기록 표시" /></div>
        <div className="dev-tool-actions"><button className="chip" onClick={() => { onHasHistory(true); onRecords() }}>예시 오늘 화면 열기</button><button className="chip" onClick={() => { onHasHistory(true); onCalendar() }}>예시 기록·달력 열기</button></div>
      </Tool>
    </>)}
    {section('diagnostics', '현재 구성과 테스트 경계를 확인해요.', <Tool title="실행 정보"><dl className="dev-runtime"><dt>판정</dt><dd>서버 판정 · 기준 자세 REST 등록</dd><dt>관절 추출</dt><dd>MediaPipe Pose · 기기 내 처리</dd><dt>전송</dt><dd>관절 좌표 · 서버에서 계산</dd><dt>복구 테스트</dt><dd>합성 오류 사용 · 실제 카메라와 서버 세션은 변경하지 않음</dd></dl></Tool>)}
    {simulation && <CameraFaultPreview scenario="fallback" performance={simulation === 'limited' || simulation === 'unknown' ? simulation : undefined} onClose={() => setSimulation(null)} />}
    {notice && <PerformanceDialog notice={notice} preview onDismiss={() => setNotice(null)} />}
    {errorPreview && <CameraFaultPreview scenario="failed" errorKey={errorPreview} onClose={() => setErrorPreview(null)} />}
    {interaction && <DeveloperPreviewDialog title="준비 단계·차트·설명 표시" onClose={() => setInteraction(false)}><InteractionPreview /></DeveloperPreviewDialog>}
    {webErrorPreview && <DeveloperPreviewDialog title="웹 오류 페이지" onClose={() => setWebErrorPreview(false)}>{webError === 'connecting' ? <iframe className="dev-connecting-preview" title="앱 연결 중 화면" src={connectingUrl} /> : <ErrorPage kind={webError} status={webError === 'request' ? 400 : webError === 'server' ? 503 : null} at={Date.now()} recordsSafe onClose={() => setWebErrorPreview(false)} />}</DeveloperPreviewDialog>}
  </div>
}
