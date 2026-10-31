import { useEffect, useRef, useState } from 'react'
import { DownloadSimple, Info, Moon, Sun } from '@phosphor-icons/react'
import { ObservationStatusIcon } from './ObservationStatusIcon'
import { ObservationOverlay } from './ObservationOverlay'
import type { CameraController } from '../../hooks/useCamera'
import { comparisonValues } from '../../../../model/prototype/observationComparison'
import { COMPARISON_ACTIONS } from './comparisonDemo'
import { useObservationComparison } from './useObservationComparison'
import { ConfirmDialog } from '../dialog/ConfirmDialog'
import { DepthNote, ObservationMetrics, OBSERVATION_METRICS, valueText } from './ObservationMetrics'
import { ObservationStopButton } from './ObservationStopButton'
import { ObservationGuide } from './ObservationGuide'
import { ObservationWorkspace } from './ObservationWorkspace'
import { ObservationScrollPanel } from './ObservationScrollPanel'
import { ObservationTools } from './ObservationTools'
import { ObservationModeDialog } from './ObservationModeDialog'
import type { GuideMode, GuidePlan } from './observationProtocol'
import { boldNumbers } from './observationTypography'
import { ObservationReplay } from './ObservationReplayPanel'
import { downloadObservationReplay } from './observationReplay'
import { downloadObservationFeatures } from './observationFeatureExport'
import './developer.css'
import './observation.css'

const THEME_KEY = 'posture-lab-observation-theme-v1'
function savedTheme(): 'dark' | 'light' {
  try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark' }
  catch { return 'dark' }
}

export default function ObservationLab({ camera, demo = false }: { camera: CameraController; demo?: boolean }) {
  const session = useObservationComparison(camera, demo ? 'synthetic' : 'camera')
  const preview = useRef<HTMLVideoElement>(null)
  const [choosingMode, setChoosingMode] = useState(false)
  const [stretchNote, setStretchNote] = useState('')
  const [theme, setTheme] = useState(savedTheme)
  const themeLabel = theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try { localStorage.setItem(THEME_KEY, next) } catch { /* The current view still works when storage is blocked. */ }
  }
  const startWithMode = (mode: GuideMode, plan: GuidePlan) => { session.changeGuideMode(mode); session.changeGuidePlan(plan); setChoosingMode(false); session.start('camera') }
  useEffect(() => { if (session.guide.status === 'note') setStretchNote('') }, [session.guide.status, session.guide.step?.trial])
  const measurement = useRef<HTMLElement>(null), focusedGuideRun = useRef('')
  const videoOn = session.active && session.source === 'camera' && camera.state === 'on'
  useEffect(() => {
    const video = preview.current
    if (!video) return
    video.srcObject = videoOn ? camera.streamRef.current : null
    if (video.srcObject) void video.play().catch(() => {})
    return () => { video.srcObject = null }
  }, [videoOn, camera.streamRef])
  useEffect(() => { const title = document.title; document.title = demo ? '화면 예시 · 측정·CSV 없음' : '실제 카메라 관측 비교 · Posture Lab'; return () => { document.title = title } }, [demo])
  useEffect(() => {
    if (session.guide.status !== 'running' || focusedGuideRun.current === session.guide.runId) return
    focusedGuideRun.current = session.guide.runId
    measurement.current?.scrollIntoView({ behavior: 'auto', block: 'start' })
    measurement.current?.focus({ preventScroll: true })
  }, [session.guide.status, session.guide.runId])
  useEffect(() => {
    const referenceReady = session.setup.status === 'preparing' && session.canStartReference
    if (!referenceReady && (session.guide.status !== 'waiting' || session.guideMode !== 'manual' || !session.canGuide)) return
    const nextFromBody = (event: KeyboardEvent) => {
      if (event.target !== document.body || event.key !== 'Enter' || event.repeat || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing || document.querySelector?.('[role="dialog"][aria-modal="true"]')) return
      event.preventDefault(); if (referenceReady) session.startReference(); else session.nextGuide()
    }
    document.addEventListener('keydown', nextFromBody)
    return () => document.removeEventListener('keydown', nextFromBody)
  }, [session.guide.status, session.guideMode, session.canGuide, session.nextGuide, session.setup.status, session.canStartReference, session.startReference])
  const values = session.reference && session.current ? comparisonValues(session.current, session.reference) : null
  const action = COMPARISON_ACTIONS.find(a => a.id === session.action)!
  const quality = !session.active ? '측정 대기' : session.registering ? `기준 등록 중 · ${Math.round(session.progress * 100)}%` : !session.current?.image ? '2D 측정 불가 · 얼굴과 양어깨를 확인하세요' : !session.reference ? '기준 등록이 필요해요' : values?.relativeZ == null ? '2D 관측 중 · z 비교 불가' : '2D · 상대 z 관측 중'
  const status = demo ? (session.active ? 'waiting' : 'off') : camera.state === 'off' || camera.state === 'error' ? 'off' : camera.state === 'loading' ? 'connecting' : session.measuring && session.current?.image ? 'measuring' : 'waiting'
  const statusLabel = status === 'off' ? '카메라 꺼짐 또는 연결 안 됨' : status === 'connecting' ? '카메라 연결 중' : status === 'measuring' ? '측정 중' : '대기 중 또는 측정하지 않음'
  const cameraView = <div className="oc-camera"><video ref={preview} muted playsInline hidden={!videoOn} aria-label="좌우 반전된 실시간 웹캠" />
          <ObservationOverlay frame={session.frame} />
          {!session.active && !videoOn && <div className="oc-camera-empty"><h2>카메라를 켜 주세요</h2></div>}
          <span className="oc-camera-badge" data-status={status} role="img" aria-label={`${statusLabel} · ${demo ? '합성 예시' : quality}`} title={`${statusLabel} · ${quality}`}><ObservationStatusIcon status={status} /></span>
        </div>
  const manualTools = <section className="oc-actions" aria-label="직접 수행할 동작 선택"><h2>비교할 동작을 선택하세요</h2><div>{COMPARISON_ACTIONS.map((item, i) => <button key={item.id} disabled={session.guideLocked} aria-pressed={session.action === item.id} onClick={() => session.choose(item.id)}><small>{boldNumbers(i === 0 ? '기준 복귀' : `동작 0${i}`)}</small><strong>{item.title}</strong></button>)}</div><p>{demo ? '동작 선택은 가상 점의 표시만 바꿉니다. 실제로 움직이거나 촬영할 필요가 없습니다.' : `${action.instruction} 무리하지 말고 편안한 범위에서 움직이세요.`}</p></section>
  const tableTools = <section className="oc-comparison" aria-label="동작별 비교표">
    <div className="oc-table-heading"><div><h2>동작별 비교</h2><p>{boldNumbers(`시계열 ${session.traceCount.toLocaleString()}행`)}</p></div>
      <div className="oc-export-actions"><button disabled={!Object.keys(session.rows).length} onClick={() => session.exportCsv('summary')}><DownloadSimple size={16} aria-hidden="true" />비교표 CSV</button><button className="oc-csv-button" disabled={!session.traceCount} onClick={() => session.exportCsv('trace')}><DownloadSimple size={16} aria-hidden="true" />관측 시계열 CSV</button></div>
    </div>
    {session.active && <div className="oc-table-session"><span>{action.title}</span><ObservationStopButton className="oc-table-stop" onStop={session.stop} /></div>}
    <div className="oc-table-scroll"><table><caption className="oc-sr-only">최근 완료한 측정 구간별 비교 · 수행 정답이 아닌 관측값</caption><thead><tr><th scope="col">동작</th>{OBSERVATION_METRICS.map(m => <th scope="col" key={m.key}><span style={{ color: m.color }}>{m.title}</span></th>)}</tr></thead><tbody>{COMPARISON_ACTIONS.map(item => <tr key={item.id}><th scope="row">{item.title}{item.id === 'stretch' && session.stretchNote && <small> · {session.stretchNote}</small>}</th>{OBSERVATION_METRICS.map(m => <td key={m.key}>{boldNumbers(valueText(session.rows[item.id]?.[m.key]))}</td>)}</tr>)}</tbody></table></div>
    <div className="oc-table-footer"><span>— 미측정</span><details className="oc-table-info"><summary><Info size={16} aria-hidden="true" />비교표 안내</summary><p>{boldNumbers('완료한 측정 구간(매번 8~15초)의 중앙값을 자동으로 반영하고 같은 동작은 최근 완료 회차로 갱신합니다. 중단된 시도는 제외하며 기존에 직접 담은 값이 있으면 보존합니다. 기준 자세 행은 동작 뒤 기준 측정 구간의 값입니다. %는 등록 어깨폭 대비 변화이며 빈 값은 0이 아닙니다. 시계열 CSV는 안내의 측정 구간만 기록하고, 준비·복귀·대기 중에는 수치를 모으지 않습니다. 동작 표식은 검증된 수행 정답이 아닙니다. 자료는 현재 탭 메모리에만 있으므로 새 측정·새로고침 전에 내려받으세요.')}</p></details><button disabled={session.guideLocked || !Object.keys(session.rows).length} onClick={session.clear}>비교표 비우기</button></div>
  </section>
  const help = <details className="oc-help" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus() } }}><summary aria-label="측정 방법과 주의사항" title="측정 방법과 주의사항"><Info size={20} aria-hidden="true" /></summary><ObservationScrollPanel className="oc-help-content" role="region" label="측정 방법과 주의사항 내용"><h2>측정 방법과 주의사항</h2><h3>카메라 상태</h3><ul className="oc-status-legend"><li><span className="oc-legend-icon" data-status="off"><ObservationStatusIcon status="off" /></span><span><strong>움직이는 회색 점</strong> · 카메라가 꺼졌거나 연결 중이에요. 연결 실패 시 오류 안내를 확인하세요.</span></li><li><span className="oc-legend-icon" data-status="waiting"><ObservationStatusIcon status="waiting" /></span><span><strong>주황색 점</strong> · 대기 중이거나 측정하지 않는 상태예요.</span></li><li><span className="oc-legend-icon" data-status="measuring"><ObservationStatusIcon status="measuring" /></span><span><strong>초록색 점</strong> · 관측을 측정하고 있어요.</span></li></ul><p>상태 색은 자세가 정상인지 판정하지 않습니다.</p><p>{boldNumbers('카메라를 고정하고 얼굴·양어깨가 보이는 편안한 정면 자세에서 카메라를 켜세요. 준비되면 기준 자세를 8초 등록하고, 기본은 한 사이클에 이탈과 기준 측정을 두 번 안내합니다. 선택하면 두 번째 이탈 대신 앉은 채 스트레칭을 안내합니다. 사이클 수(1~5)는 시작할 때 입력합니다. 스트레칭 직전에 입력하는 메모는 리플레이 JSON에 포함됩니다. 이탈 자세는 알림을 받아야 한다고 생각하는 자세를 매번 다르게 잡습니다. 스트레칭은 일어서지 않고 합니다. 자동은 준비 2초·동작 측정·복귀 준비 3초·기준 측정 뒤 자동으로 전환합니다. 동작 측정과 그 뒤의 기준 측정은 같은 길이이며, 매번 8~15초 중 1초 단위로 정해집니다. 수동은 동작을 준비한 뒤 직접 측정을 시작하며, 측정과 복귀 준비가 끝나면 버튼이나 Enter로 이어갑니다. 측정 구간 동안만 CSV 자료를 모읍니다.')}</p><p>{boldNumbers('준비·복귀·대기 중에는 측정 자료 수집 안 함 상태이며, CSV 측정값은 측정 구간 동안만 모읍니다. 리플레이 키포인트는 모든 안내 단계의 포즈 전체 좌표(원래 0~32번)를 기록합니다. 영상은 이 화면에서만 사용합니다.')}</p><p>{boldNumbers('안내는 수행 정답이나 자세 판정이 아닙니다. 2D 추적 불가·탭 숨김·진행 지연 시 일시 정지합니다. z만 없으면 빈 값으로 기록합니다. 영상은 기록하지 않습니다. 키포인트는 이 탭에만 보관하며 전체 데이터 JSON 또는 ML 후보 특징 JSON으로 내려받습니다. 원본 영상은 포함하지 않습니다. 약 10Hz로 기록하며 6,000프레임에 도달하면 측정을 종료해 자료를 보존합니다. 자동 저장·업로드는 하지 않습니다.')}</p><p>상대 z 좌표는 코 z에서 양어깨 평균 z를 뺀 모델 추정값이며 단위는 m입니다. 실제 목의 전방 길이나 깊이 센서 실측 거리가 아닙니다. 음수는 코의 z가 어깨 평균보다 작다는 뜻입니다. 핑크 카드의 %는 이 값의 변화를 등록 어깨폭으로 나눈 값입니다.</p><p>관측 반례를 찾는 연구 화면입니다. 신호가 다르다고 동작을 구별할 수 있다고 확정하지 않습니다.</p><p>기존 자료가 있으면 새 측정·재등록 전에 보존 확인창에서 CSV를 받을 수 있습니다. 카메라를 옮겼다면 측정을 종료하고 다시 시작해 기준을 등록하세요.</p><a href="/dev?demo=1" target="_blank" rel="noopener noreferrer">화면 조작 예시 · 별도 탭에서 열기 ↗</a></ObservationScrollPanel></details>
  return <div className="dev-lab oc-page" data-theme={theme} data-guiding={session.guideLocked || session.active}>
    <video ref={camera.videoRef} className="capture-source" muted playsInline aria-hidden="true" />

    <main>
      {session.recordingLimitReached && <div className="oc-status" role="alert">기록 한도 6,000프레임에 도달해 측정을 종료했어요. 데이터를 내려받고 새 측정을 시작하세요.</div>}
      {demo && <section className="oc-demo-warning" aria-label="화면 조작 예시"><strong>화면 조작 예시 · 실제 측정이 아닙니다</strong><p>미리 만든 가상 점으로 표시만 확인합니다. 측정 자료를 모으거나 CSV로 내보내지 않습니다.</p><a href="/dev">실제 카메라 측정 화면 열기</a></section>}
      <div className="oc-heading-row"><h1 className="oc-page-title"><span className="oc-sr-only">동작 관측</span></h1><div className="oc-heading-actions">{help}<button type="button" className="oc-theme-toggle" aria-label={themeLabel} title={themeLabel} onClick={toggleTheme}><span className="oc-theme-symbol" key={theme}>{theme === 'dark' ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}</span></button></div></div>
      {demo && <div className="oc-toolbar"><button className="oc-primary" disabled={session.active} onClick={() => session.start('synthetic')}>가상 점으로 화면 확인</button><button disabled={!session.active} onClick={session.stop}>화면 예시 종료</button><span>예시 모드 · 수집 없음 · CSV 없음</span></div>}
      {session.source === 'camera' && (camera.error ? <div className="oc-status" role="alert">{camera.error}</div> : camera.state === 'loading' && <div className="oc-status" role="status">카메라를 연결하고 있어요.</div>)}
      {demo ? <>
        <section className="oc-workspace" aria-label="카메라와 동작 안내"><section className="oc-camera-panel" aria-label="실시간 관측">{cameraView}<DepthNote current={session.current} reference={session.reference} /></section><ObservationMetrics samples={session.samples} values={values} /></section>
        {manualTools}
      </> : <ObservationWorkspace active={session.active} measurement={
        <section className="oc-workspace oc-measurement" aria-label="카메라와 동작 안내" ref={measurement} tabIndex={-1} onKeyDown={event => {
          const target = event.target as HTMLElement
          if (event.key !== 'Enter' || event.repeat || event.isDefaultPrevented() || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing || target.closest?.('button, a, input, select, textarea, [contenteditable="true"]') || document.querySelector?.('[role="dialog"][aria-modal="true"]')) return
          if (session.setup.status === 'preparing' && session.canStartReference) { event.preventDefault(); session.startReference() }
          else if (session.guide.status === 'waiting' && session.guideMode === 'manual' && session.canGuide) { event.preventDefault(); session.nextGuide() }
        }}>
          <ObservationGuide hasRecording={session.replayCount > 0} onDownload={() => { const data = session.getReplay(); if (data) downloadObservationReplay(data) }} onDownloadFeatures={() => { const data = session.getReplay(); if (data) downloadObservationFeatures(data) }} active={session.active} setup={session.setup} mode={session.guideMode} onNext={session.nextGuide} guide={session.guide} ready={session.canGuide} canStartReference={session.canStartReference} onStartReference={session.startReference} onStart={() => setChoosingMode(true)} onPause={session.pauseGuide} onResume={session.resumeGuide} onStop={session.stop} onRegister={session.register}>{cameraView}</ObservationGuide>
        </section>
      } analysis={setPanel => <ObservationTools onPanelChange={setPanel} metrics={<ObservationMetrics samples={session.samples} values={values} depthNote={<DepthNote current={session.current} reference={session.reference} />} />} table={tableTools} replay={visible => <ObservationReplay visible={visible} active={session.active} count={session.replayCount} dropped={session.replayDropped} getRecording={session.getReplay} />} />} />}
      {session.guide.status === 'note' && <div className="oc-stretch-dialog"><ConfirmDialog title="어떤 스트레칭을 할까요?" confirmLabel="준비하기" cancelLabel="건너뛰기" onCancel={() => session.finishStretchNote('')} onConfirm={() => session.finishStretchNote(stretchNote)}><p className="oc-stretch-description">앉은 채 할 동작을 적어주세요. 준비하기 전까지 측정 시간은 흐르지 않아요.</p><div className="oc-stretch-field"><label htmlFor="stretch-note">스트레칭 동작 <span>선택</span></label><input className="oc-field-input" id="stretch-note" type="text" maxLength={120} value={stretchNote} onChange={event => setStretchNote(event.target.value)} placeholder="예: 팔 뻗기" aria-describedby="stretch-note-help" /><p id="stretch-note-help">개인 정보는 입력하지 마세요. 메모는 리플레이 JSON에 포함됩니다.</p></div></ConfirmDialog></div>}
      {choosingMode && <ObservationModeDialog onCancel={() => setChoosingMode(false)} onStart={startWithMode} />}
      {session.pendingReset && <ConfirmDialog title={session.pendingReset === 'register' ? '기준 자세를 다시 측정할까요?' : '기존 측정 자료를 유지할까요?'} confirmLabel={session.pendingReset === 'register' ? '자료를 비우고 다시 측정' : session.pendingReset === 'clear' ? '비교표만 비우기' : '자료를 비우고 계속하기'} onCancel={session.cancelReset} onConfirm={session.confirmReset}><p>{session.pendingReset === 'register' ? '확인하기 전까지 측정은 계속됩니다. 취소하면 현재 측정과 자료를 유지합니다.' : '기존 자료를 보존했습니다. 취소하면 현재 자료·CSV·리플레이를 계속 사용할 수 있습니다.'}</p><p>{session.pendingReset === 'clear' ? '확인하면 비교표만 비웁니다. 시계열과 리플레이는 유지합니다.' : '계속하면 비교표·시계열·리플레이가 지워집니다. 필요한 CSV와 키포인트 JSON을 먼저 내려받으세요.'}</p><div className="oc-export-actions"><button disabled={!Object.keys(session.rows).length} onClick={() => session.exportCsv('summary')}>동작별 비교표 CSV</button><button disabled={!session.traceCount} onClick={() => session.exportCsv('trace')}>관측 시계열 CSV</button><button disabled={!session.replayCount} onClick={() => { const data = session.getReplay(); if (data) downloadObservationReplay(data) }}>전체 데이터 JSON</button><button disabled={!session.replayCount} onClick={() => { const data = session.getReplay(); if (data) downloadObservationFeatures(data) }}>ML 후보 특징 JSON</button><span>실제 카메라 자료 · {boldNumbers(session.traceCount.toLocaleString())}행 · {boldNumbers(session.replayCount.toLocaleString())}프레임 보존 중</span></div></ConfirmDialog>}
    </main>
  </div>
}
