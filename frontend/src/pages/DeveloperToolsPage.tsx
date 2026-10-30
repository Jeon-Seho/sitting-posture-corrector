import { useRef, useState, type ReactNode } from 'react'
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

const SECTIONS = [ ['camera', '카메라·인식'], ['alerts', '알림·연결'], ['appearance', '화면·모션'], ['records', '기록·수집'], ['diagnostics', '상태·버전'] ] as const
type SectionId = typeof SECTIONS[number][0]
const ERROR_LABELS: Record<keyof typeof CAMERA_ERRORS, string> = { unsupported: '지원하지 않는 환경', preparationTimeout: '준비 시간 초과', videoUnavailable: '영상 준비 실패', disconnected: '연결 끊김', trackingFailed: '추적 실패', permissionDenied: '권한 거부', deviceMissing: '카메라 없음', deviceBusy: '다른 앱에서 사용 중', deviceUnavailable: '선택 카메라 사용 불가', preparationFailed: '모델·카메라 로드 실패' }
function Tool({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <article className="dev-tool-card"><h3>{title}</h3>{description && <p className="setting-desc">{description}</p>}{children}</article>
}

export function DeveloperToolsPage({ camera, hasHistory, onHasHistory, onCollect, onCamera, onSettings, onRecords, onCalendar }: {
  camera: CameraController; hasHistory: boolean; onHasHistory: (enabled: boolean) => void; onCollect: () => void
  onCamera: () => void; onSettings: () => void; onRecords: () => void; onCalendar: () => void
}) {
  const [active, setActive] = useState<SectionId>('camera')
  const headings = useRef<Partial<Record<SectionId, HTMLHeadingElement | null>>>({})
  const [simulation, setSimulation] = useState<PerformanceNotice | null>(null)
  const [notice, setNotice] = useState<PerformanceNotice | null>(null)
  const [selectedError, setSelectedError] = useState<keyof typeof CAMERA_ERRORS>('permissionDenied')
  const [selectedNotice, setSelectedNotice] = useState<PerformanceNotice>('cpu')
  const [errorPreview, setErrorPreview] = useState<keyof typeof CAMERA_ERRORS | null>(null)
  const [interaction, setInteraction] = useState(false)
  function jump(id: SectionId) {
    setActive(id)
    headings.current[id]?.scrollIntoView({ behavior: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
    headings.current[id]?.focus({ preventScroll: true })
  }
  function section(id: SectionId, description: string, children: ReactNode) {
    return <section className="dev-section" id={`dev-${id}`} data-dev-section={id} aria-labelledby={`dev-heading-${id}`}>
      <div className="dev-section-heading"><h2 id={`dev-heading-${id}`} ref={node => { headings.current[id] = node }} tabIndex={-1}>{SECTIONS.find(([key]) => key === id)![1]}</h2><p>{description}</p></div>
      <div className="dev-tool-grid">{children}</div>
    </section>
  }
  return <div className="developer-page">
    <div className="page-head"><div><h1 className="page-title">개발자 도구</h1><p className="page-desc">화면을 직접 열어 확인하고, 실제 기능으로 이어서 테스트하세요.</p></div></div>
    <section className="dev-data-banner" aria-label="발표용 테스트 데이터">
      <div><h2>발표용 테스트 데이터</h2><p>최신 KST 날짜 · 현재 기록 형식 · 오늘의 짧은 측정 포함</p></div>
      <div className="dev-tool-actions"><span>{hasHistory ? '예시 데이터 켜짐' : '예시 데이터 꺼짐'}</span><Switch checked={hasHistory} onChange={onHasHistory} label="발표용 예시 기록 표시" /></div>
      <div className="dev-tool-actions"><button className="chip" onClick={() => { onHasHistory(true); onRecords() }}>예시 오늘 화면 열기</button><button className="chip" onClick={() => { onHasHistory(true); onCalendar() }}>예시 기록·달력 열기</button></div>
    </section>
    <nav className="dev-jump-nav" aria-label="개발자 도구 바로가기">{SECTIONS.map(([id, label]) => <button className="chip" key={id} aria-current={active === id ? 'location' : undefined} onClick={() => jump(id)}>{label}</button>)}</nav>
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
      <Tool title="자세 데이터 수집" description="실제 수집 화면으로 이동해 카메라 연결과 CSV 수집을 시작할 수 있어요."><button className="btn btn-sm" onClick={onCollect}>자세 데이터 수집</button></Tool>
    </>)}
    {section('diagnostics', '현재 구성과 테스트 경계를 확인해요.', <Tool title="실행 정보"><dl className="dev-runtime"><dt>판정</dt><dd>서버 판정 · 기준 자세 REST 등록</dd><dt>관절 추출</dt><dd>MediaPipe Pose · 기기 내 처리</dd><dt>전송</dt><dd>관절 좌표 · 서버에서 계산</dd><dt>복구 테스트</dt><dd>합성 오류 사용 · 실제 카메라와 서버 세션은 변경하지 않음</dd></dl></Tool>)}
    {simulation && <CameraFaultPreview scenario="fallback" performance={simulation === 'limited' || simulation === 'unknown' ? simulation : undefined} onClose={() => setSimulation(null)} />}
    {notice && <PerformanceDialog notice={notice} preview onDismiss={() => setNotice(null)} />}
    {errorPreview && <CameraFaultPreview scenario="failed" errorKey={errorPreview} onClose={() => setErrorPreview(null)} />}
    {interaction && <DeveloperPreviewDialog title="준비 단계·차트·설명 표시" onClose={() => setInteraction(false)}><InteractionPreview /></DeveloperPreviewDialog>}
  </div>
}
