import { useEffect, useRef } from 'react'
import { ArrowLeft, Circle, VideoCamera } from '@phosphor-icons/react'
import type { CameraController } from '../../hooks/useCamera'
import { comparisonValues, type ComparisonGeometry, type ComparisonSample, type ComparisonValues } from '../../../../model/prototype/observationComparison'
import { COMPARISON_ACTIONS } from './comparisonDemo'
import { useObservationComparison } from './useObservationComparison'
import { ConfirmDialog } from '../dialog/ConfirmDialog'
import { ObservationGuide } from './ObservationGuide'
import './developer.css'
import './observation.css'

export const OBSERVATION_METRICS = [
  { key: 'headGap', title: '머리–어깨 간격', note: '＋ 코와 어깨 사이가 영상에서 더 벌어짐', family: '2D', color: '#64d2ff' },
  { key: 'faceHeight', title: '얼굴 세로 길이', note: '＋ 눈 중점과 입 중점 사이가 더 길어짐', family: '2D', color: '#bf5af2' },
  { key: 'shoulderLift', title: '어깨 높이', note: '＋ 양어깨 중점이 화면 위로 이동', family: '2D', color: '#d6ff48' },
  { key: 'shoulderScale', title: '어깨폭', note: '＋ 영상에서 양어깨 사이가 더 넓어짐', family: '2D', color: '#64d2ff' },
  { key: 'relativeZ', title: '코–어깨 상대 z', note: '＋ 코 z − 양어깨 평균 z가 더 커짐', family: 'Pose world', color: '#ff6489' },
] as const
const valueText = (v: number | null | undefined) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
function Trace({ samples, field, color }: { samples: ComparisonSample[]; field: keyof ComparisonValues; color: string }) {
  const end = samples.at(-1)?.timeMs ?? 0, start = end - 10000
  const extent = Math.max(5, ...samples.map(s => Math.abs(s.values?.[field] ?? 0))) * 1.15
  let open = false, last = 0
  const path = samples.map(s => {
    const value = s.values?.[field]
    if (value == null) { open = false; return '' }
    const command = open && s.timeMs - last <= 500 ? 'L' : 'M'
    open = true; last = s.timeMs
    return `${command}${((s.timeMs - start) / 10000 * 300).toFixed(1)},${(36 - value / extent * 30).toFixed(1)}`
  }).join(' ')
  return <div className="oc-trace"><svg viewBox="0 0 300 72" preserveAspectRatio="none" role="img" aria-label="최근 10초 기준 대비 변화. 누락 구간은 연결하지 않음."><path d="M0 36H300" stroke="currentColor" strokeDasharray="3 5" opacity=".25" /><path d={path} fill="none" stroke={color} strokeWidth="2" /></svg><small>−10초 <span>0 기준 · 세로축 ±{extent.toFixed(1)}%</span>지금</small></div>
}

function Metrics({ samples, values }: { samples: ComparisonSample[]; values: ComparisonValues | null }) {
  return <section className="oc-metrics" aria-label="기준 대비 2D와 상대 z"><div className="oc-metrics-heading"><h2>기준에서 얼마나 변했나요?</h2><p>분모는 등록 어깨폭에 고정 · 그래프는 항목별 자동 축</p></div>{OBSERVATION_METRICS.map(metric => <article className={`oc-metric ${metric.key === 'relativeZ' ? 'oc-depth' : ''}`} key={metric.key}><div className="oc-metric-label"><span>{metric.family}</span><h3>{metric.title}</h3><p>{metric.note}</p></div><strong style={{color:metric.color}}>{valueText(values?.[metric.key])}</strong><Trace samples={samples} field={metric.key} color={metric.color} /></article>)}</section>
}

function DepthNote({ current, reference }: { current: ComparisonGeometry | null; reference: ComparisonGeometry | null }) {
  return <div className="oc-depth-note"><span>상대 z를 읽는 법</span><p>코 z − 양어깨 평균 z</p><strong>{current?.world ? `${current.world.relativeZ.toFixed(3)} 추정 m` : '측정 불가'}</strong><small>기준 {reference?.world ? `${reference.world.relativeZ.toFixed(3)} 추정 m` : '없음'}<br />Pose가 추정한 좌표입니다. 음수는 코 z가 어깨 평균보다 작다는 뜻이며, 실제 목의 전방 거리는 아닙니다.</small></div>
}

export default function ObservationLab({ camera, demo = false }: { camera: CameraController; demo?: boolean }) {
  const session = useObservationComparison(camera, demo ? 'synthetic' : 'camera')
  const preview = useRef<HTMLVideoElement>(null)
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
          {!session.frame && !videoOn && <div className="oc-camera-empty"><VideoCamera size={52} weight="duotone" aria-hidden="true" /><strong>{session.active ? '관측을 기다리고 있어요' : '얼굴과 양쪽 어깨가 보이도록'}</strong><p>영상은 이 화면에서만 사용해요.</p></div>}
          <span className="oc-camera-badge" data-quality={session.current?.image ? 'tracked' : 'waiting'} title={quality}><Circle size={10} weight="fill" aria-hidden="true" />{demo ? '합성 예시 · 영상 아님' : !session.active ? '카메라 대기' : session.registering ? '기준 등록 중' : !session.current?.image ? '추적 불가' : !session.reference ? '기준 미등록' : values?.relativeZ == null ? '2D 추적 · z 없음' : '추적 중'}</span>
        </div>
  return <div className="dev-lab oc-page" data-theme="dark" data-guiding={session.guideLocked}>
    <video ref={camera.videoRef} className="capture-source" muted playsInline aria-hidden="true" />
    <header className="oc-header"><a href="/dev" aria-label="개발 실험실로 돌아가기"><ArrowLeft size={18} aria-hidden="true" /><strong>PoseGood</strong></a><span>관측 비교</span><span className={demo ? 'oc-demo-label' : ''}>{demo ? '합성 예시 · 실제 측정 아님' : 'LIVE · 로컬 관측'}</span></header>
    <main>
      {demo && <section className="oc-demo-warning" aria-label="화면 조작 예시"><strong>화면 조작 예시 · 실제 측정이 아닙니다</strong><p>미리 만든 가상 점으로 표시만 확인합니다. 측정 자료를 모으거나 CSV로 내보내지 않습니다.</p><a href="/dev?view=observation">실제 카메라 측정 화면 열기</a></section>}
      <div className="oc-toolbar" aria-label="측정 준비">
        <div className="oc-toolbar-title"><h1>동작 관측</h1><span>{demo ? '예시 모드 · 수집 없음 · CSV 없음' : '2D + 상대 z'}</span></div>
        <div className="oc-toolbar-controls">
          <button className="oc-primary" disabled={session.active} onClick={() => session.start(demo ? 'synthetic' : 'camera')}>{demo ? '가상 점으로 화면 확인' : '카메라 켜기'}</button>
          <button disabled={!session.active || session.registering || session.guideLocked || session.source === 'camera' && camera.state !== 'on'} onClick={session.register}>{session.registering ? '기준을 모으는 중…' : session.reference ? '기준 다시 등록 · 2초' : '기준 2초 등록'}</button>
          {(!session.guideLocked || demo) && <button disabled={!session.active} onClick={session.stop}>{demo ? '화면 예시 종료' : '측정 종료'}</button>}
          {!demo && <button className="oc-csv-button" disabled={!session.traceCount} onClick={() => session.exportCsv('trace')}>관측 시계열 CSV</button>}
        </div>
      </div>
      <div className="oc-status" role="status">{session.notice}{session.source === 'camera' && camera.error ? ` ${camera.error}` : ''}</div>
      <section className={`oc-workspace${demo ? '' : ' oc-measurement'}`} aria-label="카메라와 동작 안내" ref={measurement} tabIndex={demo ? undefined : -1}>
        {demo ? <><section className="oc-camera-panel" aria-label="실시간 관측">{cameraView}<DepthNote current={session.current} reference={session.reference} /></section><Metrics samples={session.samples} values={values} /></> : <ObservationGuide guide={session.guide} ready={session.canGuide} hasTrace={session.traceCount > 0} onStart={session.startGuide} onPause={session.pauseGuide} onResume={session.resumeGuide} onStop={session.stop} onExport={() => session.exportCsv('trace')}>{cameraView}</ObservationGuide>}
      </section>
      {!demo && <details className="oc-demo-help"><summary>측정 방법과 주의사항</summary><p>카메라를 고정하고 얼굴·양어깨가 보이는 편안한 정면 자세에서 기준을 2초 등록하세요. 이동 2초·유지 5초·기준 복귀 5초씩 네 동작을 3바퀴 안내합니다. 어깨는 양쪽을 함께 올립니다.</p><p>안내는 수행 정답이나 자세 판정이 아닙니다. 2D 추적 불가·탭 숨김·진행 지연 시 일시 정지합니다. z만 없으면 빈 값으로 기록합니다. 영상·원본 좌표는 저장하거나 전송하지 않습니다. CSV는 직접 내려받으세요.</p><p>기존 자료가 있으면 새 측정·재등록 전에 보존 확인창에서 CSV를 받을 수 있습니다. 카메라를 옮기면 기준을 다시 등록하세요.</p><a href="/dev?view=observation&demo=1" target="_blank" rel="noopener noreferrer">화면 조작 예시 · 별도 탭에서 열기 ↗</a></details>}
      {!demo && <details className="oc-analysis"><summary>2D·상대 z 수치와 그래프 보기</summary><div className="oc-analysis-grid"><DepthNote current={session.current} reference={session.reference} /><Metrics samples={session.samples} values={values} /></div></details>}
      <details className="oc-manual" open={demo ? true : undefined}><summary>{demo ? '가상 점의 동작 선택' : '직접 동작을 선택해서 비교하기 · 자동 안내 중에는 잠금'}</summary><section className="oc-actions" aria-label="직접 수행할 동작 선택"><h2>비교할 동작을 선택하세요</h2><div>{COMPARISON_ACTIONS.map((item, i) => <button key={item.id} disabled={session.guideLocked} aria-pressed={session.action === item.id} onClick={() => session.choose(item.id)}><small>{i === 0 ? '기준 복귀' : `동작 0${i}`}</small><strong>{item.title}</strong></button>)}</div><p>{demo ? '동작 선택은 가상 점의 표시만 바꿉니다. 실제로 움직이거나 촬영할 필요가 없습니다.' : `${action.instruction} 무리하지 말고 편안한 범위에서 움직이세요.`}</p></section></details>
      {!demo && <details className="oc-manual-table"><summary>수동 비교표 · 자동 안내 전체 자료는 시계열 CSV로 받으세요</summary>
      <section className="oc-comparison" aria-label="직접 선택한 동작별 비교표"><div className="oc-table-heading"><div><h2>04　동작별로 나란히 비교</h2><p>수동 비교표입니다. 자동 안내의 세 바퀴 자료는 관측 시계열 CSV에 모두 기록합니다.</p></div><button className="oc-primary" disabled={!session.active || !values || session.registering || session.guideLocked} onClick={session.capture}>‘{action.title}’ 비교표에 담기</button></div><div className="oc-export-actions"><button disabled={!Object.keys(session.rows).length} onClick={() => session.exportCsv('summary')}>동작별 비교표 CSV</button><button disabled={!session.traceCount} onClick={() => session.exportCsv('trace')}>관측 시계열 CSV</button><span>현재 {session.traceCount.toLocaleString()}행 · 최대 12,000행{session.droppedRows > 0 ? ` · 앞부분 ${session.droppedRows.toLocaleString()}행 잘림` : ' · 기준 등록 후 약 10Hz'}</span><p>비교표는 담은 동작의 1초 중앙값, 시계열은 모든 관측값·품질과 자동 안내의 바퀴·동작·이동/유지/복귀·재시도 구간을 담습니다. 새 실행·재등록·새로고침 전에 내려받으세요.</p></div><div className="oc-table-scroll"><table><caption>직접 선택한 수행 표식 · 검증된 동작 정답이 아님 · 현재 탭 메모리만 사용</caption><thead><tr><th scope="col">직접 선택한 동작</th>{OBSERVATION_METRICS.map(m => <th scope="col" key={m.key}>{m.title}</th>)}</tr></thead><tbody>{COMPARISON_ACTIONS.map(item => <tr key={item.id}><th scope="row">{item.title}</th>{OBSERVATION_METRICS.map(m => <td key={m.key}>{valueText(session.rows[item.id]?.[m.key])}</td>)}</tr>)}</tbody></table></div><div className="oc-table-footer"><p>2D: 기준 영상 어깨폭 대비 변화 / z: 기준 world 어깨폭 대비 변화 · 비어 있는 값은 0이 아닙니다.</p><button disabled={session.guideLocked} onClick={session.clear}>비교표 비우기</button></div></section>
      </details>}
      {session.pendingReset && <ConfirmDialog title="기존 측정 자료를 유지할까요?" confirmLabel={session.pendingReset === 'clear' ? '비교표만 비우기' : '자료를 비우고 계속하기'} onCancel={session.cancelReset} onConfirm={session.confirmReset}><p>측정을 멈추고 기존 자료를 보존했습니다. 취소하면 현재 자료와 CSV를 계속 사용할 수 있습니다.</p><p>{session.pendingReset === 'clear' ? '확인하면 비교표만 비웁니다. 시계열은 유지합니다.' : '계속하면 비교표와 시계열이 지워집니다. 필요한 CSV를 먼저 내려받으세요.'}</p><div className="oc-export-actions"><button disabled={!Object.keys(session.rows).length} onClick={() => session.exportCsv('summary')}>동작별 비교표 CSV</button><button disabled={!session.traceCount} onClick={() => session.exportCsv('trace')}>관측 시계열 CSV</button><span>실제 카메라 자료 · {session.traceCount.toLocaleString()}행 보존 중</span></div></ConfirmDialog>}
      <footer className="oc-footer">관측 반례를 찾는 연구 화면 · 신호가 다르다고 동작을 구별할 수 있다고 확정하지 않습니다.</footer>
    </main>
  </div>
}
