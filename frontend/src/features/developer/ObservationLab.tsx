import { useEffect, useRef, useState } from 'react'
import { Circle, DownloadSimple, Info, Moon, Sun, VideoCamera } from '@phosphor-icons/react'
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
import type { GuideMode } from './observationProtocol'
import { boldNumbers } from './observationTypography'
import { ObservationReplay } from './ObservationReplayPanel'
import { downloadObservationReplay } from './observationReplay'
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
  const [theme, setTheme] = useState(savedTheme)
  const themeLabel = theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try { localStorage.setItem(THEME_KEY, next) } catch { /* The current view still works when storage is blocked. */ }
  }
  const startWithMode = (mode: GuideMode) => { session.changeGuideMode(mode); setChoosingMode(false); session.start('camera') }
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
  const values = session.reference && session.current ? comparisonValues(session.current, session.reference) : null
  const action = COMPARISON_ACTIONS.find(a => a.id === session.action)!
  const quality = !session.active ? '측정 대기' : session.registering ? `기준 등록 중 · ${Math.round(session.progress * 100)}%` : !session.current?.image ? '2D 측정 불가 · 얼굴과 양어깨를 확인하세요' : !session.reference ? '기준 등록이 필요해요' : values?.relativeZ == null ? '2D 관측 중 · z 비교 불가' : '2D · 상대 z 관측 중'
  const cameraView = <div className="oc-camera"><video ref={preview} muted playsInline hidden={!videoOn} aria-label="좌우 반전된 실시간 웹캠" />
          {session.frame && <svg viewBox={`0 0 ${session.frame.width} ${session.frame.height}`} aria-label="현재 Pose 관측점" className="oc-overlay">{[[2,5],[9,10],[11,12],[0,11],[0,12]].map(([a,b]) => { const p=session.frame!.landmarks[a], q=session.frame!.landmarks[b]; return p && q && (p.visibility ?? 0) >= .5 && (q.visibility ?? 0) >= .5 && [p.x,p.y,q.x,q.y].every(Number.isFinite) ? <line key={`${a}-${b}`} x1={p.x*session.frame!.width} y1={p.y*session.frame!.height} x2={q.x*session.frame!.width} y2={q.y*session.frame!.height} /> : null })}{[0,2,5,9,10,11,12].map(i => { const p=session.frame!.landmarks[i]; return p && (p.visibility ?? 0) >= .5 && [p.x,p.y].every(Number.isFinite) ? <circle key={i} cx={p.x*session.frame!.width} cy={p.y*session.frame!.height} r="4" /> : null })}</svg>}
          {!session.frame && !videoOn && <div className="oc-camera-empty"><VideoCamera size={52} weight="duotone" aria-hidden="true" /><h2>{session.active ? '관측을 기다리고 있어요' : session.replayCount ? '측정한 기록이 있어요' : '카메라를 켜 주세요'}</h2><p>얼굴과 양쪽 어깨가 보이도록 앉아 주세요.</p></div>}
          <span className="oc-camera-badge" data-quality={session.current?.image ? 'tracked' : 'waiting'} title={quality}><Circle size={10} weight="fill" aria-hidden="true" />{boldNumbers(demo ? '합성 예시 · 영상 아님' : !session.active ? '카메라 대기' : session.registering ? '기준 등록 중' : !session.current?.image ? '추적 불가' : !session.reference ? '기준 미등록' : values?.relativeZ == null ? '2D 추적 · z 없음' : '추적 중')}</span>
        </div>
  const manualTools = <section className="oc-actions" aria-label="직접 수행할 동작 선택"><h2>비교할 동작을 선택하세요</h2><div>{COMPARISON_ACTIONS.map((item, i) => <button key={item.id} disabled={session.guideLocked} aria-pressed={session.action === item.id} onClick={() => session.choose(item.id)}><small>{boldNumbers(i === 0 ? '기준 복귀' : `동작 0${i}`)}</small><strong>{item.title}</strong></button>)}</div><p>{demo ? '동작 선택은 가상 점의 표시만 바꿉니다. 실제로 움직이거나 촬영할 필요가 없습니다.' : `${action.instruction} 무리하지 말고 편안한 범위에서 움직이세요.`}</p></section>
  const tableTools = <section className="oc-comparison" aria-label="동작별 비교표">
    <div className="oc-table-heading"><div><h2>동작별 비교</h2><p>{boldNumbers(`시계열 ${session.traceCount.toLocaleString()}행`)}</p></div>
      <div className="oc-export-actions"><button disabled={!Object.keys(session.rows).length} onClick={() => session.exportCsv('summary')}><DownloadSimple size={16} aria-hidden="true" />비교표 CSV</button><button className="oc-csv-button" disabled={!session.traceCount} onClick={() => session.exportCsv('trace')}><DownloadSimple size={16} aria-hidden="true" />관측 시계열 CSV</button></div>
    </div>
    {session.active && <div className="oc-table-session"><span>{action.title}</span><ObservationStopButton className="oc-table-stop" onStop={session.stop} /></div>}
    <div className="oc-table-scroll"><table><caption className="oc-sr-only">최근 완료한 측정 구간별 비교 · 수행 정답이 아닌 관측값</caption><thead><tr><th scope="col">동작</th>{OBSERVATION_METRICS.map(m => <th scope="col" key={m.key}><span style={{ color: m.color }}>{m.title}</span></th>)}</tr></thead><tbody>{COMPARISON_ACTIONS.map(item => <tr key={item.id}><th scope="row">{item.title}</th>{OBSERVATION_METRICS.map(m => <td key={m.key}>{boldNumbers(valueText(session.rows[item.id]?.[m.key]))}</td>)}</tr>)}</tbody></table></div>
    <div className="oc-table-footer"><span>— 미측정</span><details className="oc-table-info"><summary><Info size={16} aria-hidden="true" />비교표 안내</summary><p>{boldNumbers('완료한 측정 5초 구간의 중앙값을 자동으로 반영하고 같은 동작은 최근 완료 회차로 갱신합니다. 중단된 시도는 제외하며 기존에 직접 담은 값이 있으면 보존합니다. 기준 자세 행은 별도 측정 구간이 없어 비워 둡니다. %는 등록 어깨폭 대비 변화이며 빈 값은 0이 아닙니다. 시계열 CSV는 안내의 측정 5초 구간만 기록하고, 준비·복귀·대기 중에는 수치를 모으지 않습니다. 동작 표식은 검증된 수행 정답이 아닙니다. 자료는 현재 탭 메모리에만 있으므로 새 측정·새로고침 전에 내려받으세요.')}</p></details><button disabled={session.guideLocked || !Object.keys(session.rows).length} onClick={session.clear}>비교표 비우기</button></div>
  </section>
  const help = <details className="oc-help" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus() } }}><summary aria-label="측정 방법과 주의사항" title="측정 방법과 주의사항"><Info size={20} aria-hidden="true" /></summary><ObservationScrollPanel className="oc-help-content" role="region" label="측정 방법과 주의사항 내용"><h2>측정 방법과 주의사항</h2><p>{boldNumbers('카메라를 고정하고 얼굴·양어깨가 보이는 편안한 정면 자세에서 카메라를 켜세요. 2초 안내 후 기준 자세를 8초 등록하고, 준비 2초·측정 5초·복귀 준비 5초씩 네 동작을 3바퀴 안내합니다. 어깨는 양쪽을 함께 올립니다. 자동은 시간이 끝나면 전환하고, 수동은 시간이 끝난 뒤 다음 버튼으로 전환합니다. 측정 5초 동안만 자료를 모읍니다.')}</p><p>{boldNumbers('준비·복귀·대기 중에는 측정 자료 수집 안 함 상태이며, CSV 측정값은 측정 5초 동안만 모읍니다. 리플레이 키포인트는 모든 안내 단계를 기록합니다. 영상은 이 화면에서만 사용합니다.')}</p><p>{boldNumbers('안내는 수행 정답이나 자세 판정이 아닙니다. 2D 추적 불가·탭 숨김·진행 지연 시 일시 정지합니다. z만 없으면 빈 값으로 기록합니다. 영상은 기록하지 않습니다. 키포인트는 이 탭에만 보관하며 리플레이 JSON 저장을 누르면 파일로 내려받습니다. 자동 저장·업로드는 하지 않습니다.')}</p><p>상대 z 좌표는 코 z에서 양어깨 평균 z를 뺀 모델 추정값이며 단위는 m입니다. 실제 목의 전방 길이나 깊이 센서 실측 거리가 아닙니다. 음수는 코의 z가 어깨 평균보다 작다는 뜻입니다. 핑크 카드의 %는 이 값의 변화를 등록 어깨폭으로 나눈 값입니다.</p><p>관측 반례를 찾는 연구 화면입니다. 신호가 다르다고 동작을 구별할 수 있다고 확정하지 않습니다.</p><p>기존 자료가 있으면 새 측정·재등록 전에 보존 확인창에서 CSV를 받을 수 있습니다. 카메라를 옮겼다면 측정을 종료하고 다시 시작해 기준을 등록하세요.</p><a href="/dev?demo=1" target="_blank" rel="noopener noreferrer">화면 조작 예시 · 별도 탭에서 열기 ↗</a></ObservationScrollPanel></details>
  return <div className="dev-lab oc-page" data-theme={theme} data-guiding={session.guideLocked || session.active}>
    <video ref={camera.videoRef} className="capture-source" muted playsInline aria-hidden="true" />

    <main>
      {demo && <section className="oc-demo-warning" aria-label="화면 조작 예시"><strong>화면 조작 예시 · 실제 측정이 아닙니다</strong><p>미리 만든 가상 점으로 표시만 확인합니다. 측정 자료를 모으거나 CSV로 내보내지 않습니다.</p><a href="/dev">실제 카메라 측정 화면 열기</a></section>}
      <div className="oc-heading-row"><h1 className="oc-page-title"><span className="oc-sr-only">동작 관측</span></h1><div className="oc-heading-actions">{help}<button type="button" className="oc-theme-toggle" aria-label={themeLabel} title={themeLabel} onClick={toggleTheme}><span className="oc-theme-symbol" key={theme}>{theme === 'dark' ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}</span></button></div></div>
      {demo && <div className="oc-toolbar"><button className="oc-primary" disabled={session.active} onClick={() => session.start('synthetic')}>가상 점으로 화면 확인</button><button disabled={!session.active} onClick={session.stop}>화면 예시 종료</button><span>예시 모드 · 수집 없음 · CSV 없음</span></div>}
      {session.source === 'camera' && camera.error && <div className="oc-status" role="alert">{camera.error}</div>}
      {demo ? <>
        <section className="oc-workspace" aria-label="카메라와 동작 안내"><section className="oc-camera-panel" aria-label="실시간 관측">{cameraView}<DepthNote current={session.current} reference={session.reference} /></section><ObservationMetrics samples={session.samples} values={values} /></section>
        {manualTools}
      </> : <ObservationWorkspace active={session.active} measurement={
        <section className="oc-workspace oc-measurement" aria-label="카메라와 동작 안내" ref={measurement} tabIndex={-1}>
          <ObservationGuide hasRecording={session.replayCount > 0} onDownload={() => { const data = session.getReplay(); if (data) downloadObservationReplay(data) }} active={session.active} setup={session.setup} mode={session.guideMode} onNext={session.nextGuide} guide={session.guide} ready={session.canGuide} onStart={() => setChoosingMode(true)} onPause={session.pauseGuide} onResume={session.resumeGuide} onStop={session.stop}>{cameraView}</ObservationGuide>
        </section>
      } analysis={setPanel => <ObservationTools onPanelChange={setPanel} metrics={<ObservationMetrics samples={session.samples} values={values} depthNote={<DepthNote current={session.current} reference={session.reference} />} />} table={tableTools} replay={visible => <ObservationReplay visible={visible} active={session.active} count={session.replayCount} dropped={session.replayDropped} getRecording={session.getReplay} />} />} />}
      {choosingMode && <ObservationModeDialog onCancel={() => setChoosingMode(false)} onStart={startWithMode} />}
      {session.pendingReset && <ConfirmDialog title="기존 측정 자료를 유지할까요?" confirmLabel={session.pendingReset === 'clear' ? '비교표만 비우기' : '자료를 비우고 계속하기'} onCancel={session.cancelReset} onConfirm={session.confirmReset}><p>측정을 멈추고 기존 자료를 보존했습니다. 취소하면 현재 자료·CSV·리플레이를 계속 사용할 수 있습니다.</p><p>{session.pendingReset === 'clear' ? '확인하면 비교표만 비웁니다. 시계열과 리플레이는 유지합니다.' : '계속하면 비교표·시계열·리플레이가 지워집니다. 필요한 CSV와 키포인트 JSON을 먼저 내려받으세요.'}</p><div className="oc-export-actions"><button disabled={!Object.keys(session.rows).length} onClick={() => session.exportCsv('summary')}>동작별 비교표 CSV</button><button disabled={!session.traceCount} onClick={() => session.exportCsv('trace')}>관측 시계열 CSV</button><button disabled={!session.replayCount} onClick={() => { const data = session.getReplay(); if (data) downloadObservationReplay(data) }}>키포인트 JSON 저장</button><span>실제 카메라 자료 · {boldNumbers(session.traceCount.toLocaleString())}행 · {boldNumbers(session.replayCount.toLocaleString())}프레임 보존 중</span></div></ConfirmDialog>}
    </main>
  </div>
}
