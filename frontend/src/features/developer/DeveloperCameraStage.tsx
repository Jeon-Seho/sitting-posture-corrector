import { useEffect, useId, useRef, useState } from 'react'
import { ArrowClockwise, Camera, Check, DownloadSimple, Flask, Play, Square, WarningCircle } from '@phosphor-icons/react'
import type { ForecastDisplay, ForecastState } from '../../../../model/prototype/forecast'
import { FORECAST_DISPLAY_EDGES, FORECAST_DISPLAY_POINT_NAMES, freshForecastDisplay,
  projectForecastDisplay, type ForecastPlane } from '../../../../model/prototype/forecastDisplay'
import { GUIDANCE_SETTINGS } from '../../../../model/prototype/developerGuidance'
import type { CameraController } from '../../hooks/useCamera'
import { POSE_EDGES } from '../../lib/poseVisual'
import type { DeveloperSession, LabGuideFrame, LabGuidePoint } from './types'
import './camera-stage.css'
import { selectedDurationMs, selectedLabState } from './readingView'
import { useGuideDisplay } from './useGuideDisplay'
import type { FaceTrackingController } from './face/useFaceTracking'
import type { FaceFrame } from './face/comparison'
import DeveloperFaceComparison from './face/DeveloperFaceComparison'

interface Size { width: number; height: number }
const FALLBACK_FRAME: Size = { width: 640, height: 480 }
const guideLeft = GUIDANCE_SETTINGS.center_x - GUIDANCE_SETTINGS.center_tolerance
const guideShoulderY = (GUIDANCE_SETTINGS.shoulder_top + GUIDANCE_SETTINGS.shoulder_bottom) / 2
const activePhases = ['connecting', 'guiding', 'registering', 'measuring']
const stateLabels: Record<ForecastState, string> = {
  needs_reference: '기준 등록 대기', registering: '기준 등록 중', warming: '연속 관측을 다시 모으는 중',
  near_reference: '자세 비교 · 기준 범위 안', deviation_pending: '변화 지속 확인 중',
  unexpected_motion_candidate: '예상 밖 움직임', persistent_deviation_candidate: '지속 이탈 후보',
  recovery_pending: '기준 복귀 확인 중', unmeasurable: '측정 불가',
}
const validSize = (size: Size | null | undefined): size is Size => !!size && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
const matchingAspect = (a: Size, b: Size) => Math.abs(a.width / a.height - b.width / b.height) < .01
const usablePoint = (point: LabGuidePoint | undefined): point is LabGuidePoint => !!point &&
  [point.x, point.y, point.visibility].every(Number.isFinite) && point.visibility >= GUIDANCE_SETTINGS.minimum_visibility &&
  point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1

/** Matches the video's object-fit: contain / object-position: center exactly. */
export function fitVideoFrame(frame: Size, viewport: Size) {
  const scale = Math.min(viewport.width / frame.width, viewport.height / frame.height)
  const width = frame.width * scale, height = frame.height * scale
  return { x: (viewport.width - width) / 2, y: (viewport.height - height) / 2, width, height }
}

/** Original image coordinates receive exactly the same single horizontal mirror as video. */
export function projectGuidePoint(point: Pick<LabGuidePoint, 'x' | 'y'>, frame: Size, viewport: Size) {
  const rect = fitVideoFrame(frame, viewport)
  return { x: rect.x + (1 - point.x) * rect.width, y: rect.y + point.y * rect.height }
}

const middle = (left: LabGuidePoint, right: LabGuidePoint): LabGuidePoint => ({
  x: (left.x + right.x) / 2, y: (left.y + right.y) / 2, visibility: Math.min(left.visibility, right.visibility),
})
const signed = (value: number | null, suffix: string) => value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}${suffix}`

function PoseOverlay({ live, reference, frame, viewport, vectorId, bodyOnly = false, comparison = false }: {
  live: LabGuideFrame | null; reference: LabGuideFrame | null; frame: Size; viewport: Size; vectorId: string; bodyOnly?: boolean; comparison?: boolean
}) {
  const project = (point: LabGuidePoint) => projectGuidePoint(point, frame, viewport)
  const skeleton = (sample: LabGuideFrame, ghost: boolean) => <g className={ghost ? 'dc-reference-pose' : `dc-live-pose ${comparison ? 'dc-pose-comparison' : ''}`} data-testid={ghost ? 'reference-pose' : 'live-pose'}>
    {POSE_EDGES.map(([a, b]) => {
      if (bodyOnly && (a < 11 || b < 11)) return null
      if (!usablePoint(sample.points[a]) || !usablePoint(sample.points[b])) return null
      const from = project(sample.points[a]), to = project(sample.points[b])
      return <line key={`${a}-${b}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
    })}
    {sample.points.slice(0, 13).map((point, i) => {
      if (bodyOnly && i < 11) return null
      if (!usablePoint(point)) return null
      const p = project(point)
      return <circle key={i} data-point={i} cx={p.x} cy={p.y} r={ghost ? 3 : i > 10 ? 5 : 3.5} />
    })}
  </g>
  const liveShoulders = live && usablePoint(live.points[11]) && usablePoint(live.points[12]) ? middle(live.points[11], live.points[12]) : null
  const referenceHead = !bodyOnly && reference && usablePoint(reference.points[0]) ? project(reference.points[0]) : null
  const liveHead = !bodyOnly && live && usablePoint(live.points[0]) ? project(live.points[0]) : null
  const shoulderCenter = liveShoulders ? project(liveShoulders) : null
  return <>
    <defs><marker id={vectorId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1 7 4 1 7" fill="none" stroke="currentColor" strokeWidth="1.5" /></marker></defs>
    {reference && skeleton(reference, true)}
    {live && skeleton(live, false)}
    {liveHead && shoulderCenter && <g className="dc-live-axis" data-testid="live-axis"><line x1={liveHead.x} y1={liveHead.y} x2={shoulderCenter.x} y2={shoulderCenter.y} /><line x1={shoulderCenter.x - 8} x2={shoulderCenter.x + 8} y1={shoulderCenter.y} y2={shoulderCenter.y} /></g>}
    {referenceHead && liveHead && Math.hypot(referenceHead.x - liveHead.x, referenceHead.y - liveHead.y) > 3 && <g className="dc-displacement" data-testid="observed-displacement"><line x1={referenceHead.x} y1={referenceHead.y} x2={liveHead.x} y2={liveHead.y} markerEnd={`url(#${vectorId})`} /></g>}
  </>
}

function FaceOverlay({ face, frame, viewport }: { face: FaceFrame; frame: Size; viewport: Size }) {
  const points = new Map(face.points.map(point => [point.index, projectGuidePoint(point, frame, viewport)]))
  return <g className="dc-face-landmarks" data-testid="face-landmarks">{face.edges.map(([a, b]) => {
    const from = points.get(a), to = points.get(b)
    return from && to ? <line key={`${a}-${b}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} /> : null
  })}{[1, 61, 291].map(index => { const p = points.get(index); return p ? <circle key={index} cx={p.x} cy={p.y} r={3} /> : null })}</g>
}

const predictorNames = { lstm: 'LSTM', hold_last: '위치 유지 비교군', constant_velocity: '등속 비교군' }
const forecastDirection = (value: number, negative: string, positive: string) => Math.abs(value) < .05
  ? '변화 0.0%' : `${value < 0 ? negative : positive} ${Math.abs(value).toFixed(1)}%`
const resetReasonLabels: Record<string, string> = {
  quality: '좌표 품질 부족', gap: '관측 간격 초과', time: '관측 시각 불일치', reset: '새 입력 준비',
}

/** Real model output in its own coordinate plane. It is not an image-space overlay. */
function ForecastPreview({ forecast, session, allowed, metrics, cropMismatch }: {
  forecast?: ForecastDisplay | null; session: DeveloperSession; allowed: boolean; metrics?: CameraController['metrics']; cropMismatch: boolean
}) {
  const [plane, setPlane] = useState<ForecastPlane>('front')
  const marker = `dc-forecast-${useId().replace(/:/g, '')}`
  const fresh = allowed && session.reading && freshForecastDisplay(forecast, session.reading.timeMs) ? forecast : null
  const plot = fresh ? projectForecastDisplay(fresh, plane) : null
  const predictor = predictorNames[session.predictor]
  const status = session.predictionStatus
  const required = status?.requiredSteps ?? 30
  const collected = status ? Math.min(required, Math.max(0, status.collectedSteps)) : null
  const prepared = collected !== null && collected >= required
  const resetReason = status?.lastResetReason ? resetReasonLabels[status.lastResetReason] ?? '입력 연속성 중단' : null
  const title = cropMismatch ? '영상 비율이 바뀌었어요' : !allowed ? '새 유효 관측을 기다려요' : prepared ? '입력 준비 완료 · 새 예측 대기'
    : collected !== null ? '예측 입력 준비 중' : '예측 상태를 확인하고 있어요'
  const detail = cropMismatch ? '기준을 다시 등록하면 새 화면에 맞춰 예측을 표시합니다.'
    : !allowed ? '관측이 끊기거나 유효하지 않아 예측 표시를 잠시 멈췄습니다.'
    : prepared ? '지난 시각의 예측은 숨깁니다. 새 관측과 예측이 도착하면 표시합니다.'
    : collected !== null ? '최근 약 3초의 좌표를 준비합니다. 거리·시간 판정은 별도로 진행됩니다.'
    : '새 유효 관측의 예측이 도착하면 표시합니다.'
  const skeleton = (predicted: boolean) => {
    if (!plot) return null
    const points = predicted ? plot.predicted : plot.current
    return <g className={predicted ? 'dc-forecast-future' : 'dc-forecast-input'} data-testid={predicted ? 'forecast-future-pose' : 'forecast-input-pose'}>
      {FORECAST_DISPLAY_EDGES.map(([from, to]) => <line key={`${from}-${to}`} x1={points[from].x} y1={points[from].y} x2={points[to].x} y2={points[to].y} />)}
      {points.map((point, i) => <circle key={i} data-point={i} cx={point.x} cy={point.y} r={i > 10 ? 3.5 : 2.2}><title>{FORECAST_DISPLAY_POINT_NAMES[i]}</title></circle>)}
    </g>
  }
  return <section className="dc-forecast" aria-label="미래 좌표 예측" data-testid="forecast-preview">
    <div className="dc-forecast-heading"><h3>{predictor} · 0.3초 뒤</h3><div className="dc-forecast-planes" role="group" aria-label="예측 도식 시점">
      <button type="button" aria-pressed={plane === 'front'} onClick={() => setPlane('front')}>정면</button>
      <button type="button" aria-pressed={plane === 'side'} onClick={() => setPlane('side')}>깊이</button>
    </div></div>
    {plot && fresh ? <>
      <div className="dc-forecast-body">
        <svg viewBox="0 0 360 148" role="img" aria-label={`${predictor}의 얼굴·귀·어깨 13점 예측. ${plane === 'front' ? '좌우·상하' : '깊이·상하'} 모델 좌표 도식. 화살표는 입력 끝에서 0.3초 뒤 예상 위치로 향합니다.`}>
          <defs><marker id={marker} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M1 1 7 4 1 7" fill="none" stroke="currentColor" strokeWidth="1.5" /></marker></defs>
          <line className="dc-forecast-axis" x1="16" x2="344" y1={plot.origin.y} y2={plot.origin.y} />
          {skeleton(false)}
          <g className="dc-forecast-vectors" data-testid="forecast-vectors">{plot.current.map((from, i) => {
            const to = plot.predicted[i]
            return Math.hypot(to.x - from.x, to.y - from.y) < .35 ? null : <line key={i} data-point={i} x1={from.x} y1={from.y} x2={to.x} y2={to.y} markerEnd={`url(#${marker})`} />
          })}</g>
          {skeleton(true)}
          <text x="344" y="141" textAnchor="end" className="dc-forecast-axis-label">{plane === 'front' ? '좌우 반전 · x/y' : '카메라 쪽 → · −z/y'}</text>
        </svg>
        <div className="dc-forecast-deltas"><span>얼굴 중심 예상 이동</span><strong>{forecastDirection(plot.faceDelta.horizontal, '왼쪽', '오른쪽')}</strong><strong>{forecastDirection(plot.faceDelta.vertical, '위', '아래')}</strong><strong>{forecastDirection(plot.faceDelta.towardCamera, '카메라 반대쪽', '카메라 쪽')}</strong><small>어깨폭 기준 · 방향·크기 그대로</small></div>
      </div>
      <div className="dc-forecast-legend"><span><i />입력 끝 시점</span><span><i />0.3초 뒤 예측</span><time>{(fresh.inputAtMs / 1000).toFixed(1)}s → {(fresh.targetAtMs / 1000).toFixed(1)}s</time></div>
      <p className="dc-forecast-note">{fresh.modelId} · 얼굴 9 + 귀 2 + 어깨 2점의 3D 좌표. 어깨 중심·폭에 맞춘 도식입니다.</p>
    </> : <div className="dc-forecast-empty"><strong>{title}</strong><p>{detail}</p>
      {collected !== null && <div className="dc-forecast-progress">
        <div><span>예측 입력</span><span>{`${collected} / ${required}`}</span></div>
        <progress aria-label="예측 입력 준비" max={required} value={collected} />
      </div>}
      {!!status?.resetCount && resetReason && <p className="dc-forecast-reset">{`최근 초기화: ${resetReason} · ${status.resetCount}회`}</p>}
    </div>}
    {(metrics || status?.lastGapMs != null || !!status?.bridgedGapCount) && <div className="dc-forecast-health" aria-label="예측 입력 처리 상태">
      {metrics && Number.isFinite(metrics.fps) && <span>{`카메라 ${metrics.fps.toFixed(1)} FPS`}</span>}
      {metrics && Number.isFinite(metrics.inferenceMs) && <span>{`좌표 추출 ${Math.round(metrics.inferenceMs)}ms`}</span>}
      {status?.lastGapMs != null && <span>{`최근 입력 간격 ${Math.round(status.lastGapMs)}ms`}</span>}
      {!!status?.bridgedGapCount && <span>{`짧은 간격 보간 ${status.bridgedGapCount}회`}</span>}
    </div>}
  </section>
}

export default function DeveloperCameraStage({ camera, session, compact = false, face }: { camera: CameraController; session: DeveloperSession; compact?: boolean; face?: FaceTrackingController }) {
  const preview = useRef<HTMLVideoElement>(null)
  const workspace = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState<Size>({ width: 960, height: 540 })
  const [videoSize, setVideoSize] = useState<Size | null>(null)
  const vectorId = `dc-vector-${useId().replace(/:/g, '')}`
  const active = activePhases.includes(session.phase)
  const synthetic = session.source === 'synthetic'
  const guidance = session.guidance
  const videoOn = active && !synthetic && camera.state === 'on'
  const observed = active && session.reading?.state !== 'unmeasurable' ? guidance.live : null
  const displayed = useGuideDisplay(observed)
  const frame = validSize(observed) ? observed : videoOn && validSize(videoSize) ? videoSize : validSize(guidance.reference) ? guidance.reference : FALLBACK_FRAME
  // A resized viewport is safe; a different camera aspect can mean a different crop.
  // Do not project an old reference into a new crop and imply a measured movement.
  const live = displayed && matchingAspect(displayed, frame) ? displayed : null
  const reference = guidance.reference && matchingAspect(guidance.reference, frame) ? guidance.reference : null
  const referenceMismatch = !!guidance.reference && !reference
  const rect = fitVideoFrame(frame, viewport)
  const faceFrame = videoOn && face?.enabled && face.sample?.frame && matchingAspect(face.sample.frame, frame) ? face.sample.frame : null
  const faceSelected = !!face?.enabled && face.mode !== 'pose'
  const registering = session.phase === 'registering'
  const preparing = session.phase === 'guiding' || registering
  const tracking = session.phase === 'measuring'
  const progress = Math.max(0, Math.min(1, registering ? session.reading?.progress ?? 0 : guidance.holdProgress))
  const needsModel = session.predictor === 'lstm' && !session.model
  const state = session.reading ? selectedLabState(session.reading, session.alertBasis) : undefined
  const alertState = state
  const showAlert = tracking && state !== 'warming' && state !== 'unmeasurable' && alertState === 'persistent_deviation_candidate' && session.alerts.length > 0
  const tone = state === 'near_reference' ? 'good' : state === 'persistent_deviation_candidate' || state === 'unexpected_motion_candidate' || state === 'deviation_pending' ? 'warning' : 'neutral'
  const readout = state ? stateLabels[state] : session.phase === 'connecting' ? '카메라 연결 중' : session.phase === 'guiding' ? '구도 확인 중' : '측정 대기'
  const subtitleKey = `${guidance.step}-${guidance.cue}-${guidance.introStep}-${registering}`
  const Dock = tracking ? 'details' : 'div'

  useEffect(() => {
    const node = workspace.current
    if (!node) return
    const measure = () => {
      const bounds = node.getBoundingClientRect()
      if (bounds.width > 0 && bounds.height > 0) setViewport({ width: bounds.width, height: bounds.height })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure); observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const video = preview.current
    if (!video) return
    video.srcObject = videoOn ? camera.streamRef.current : null
    if (video.srcObject) void video.play().catch(() => {})
    if (!videoOn) setVideoSize(null)
    return () => { video.srcObject = null }
  }, [videoOn, camera.streamRef])

  useEffect(() => {
    if (videoOn && observed) setVideoSize({ width: observed.width, height: observed.height })
  }, [videoOn, observed?.width, observed?.height])

  return <section className="dev-camera-workspace" aria-label="카메라 측정 작업공간" data-tone={tone} data-phase={session.phase} data-compact={compact}>
    <div className="dc-viewport" ref={workspace}>
      <video ref={preview} className="dc-video" muted playsInline aria-label="좌우 반전된 실제 웹캠 영상" hidden={!videoOn} onLoadedMetadata={() => {
        const video = preview.current
        if (video && video.videoWidth > 0 && video.videoHeight > 0) setVideoSize({ width: video.videoWidth, height: video.videoHeight })
      }} />
      <svg className="dc-overlay" viewBox={`0 0 ${viewport.width} ${viewport.height}`} preserveAspectRatio="none" role="img" aria-label={faceSelected && faceFrame ? `얼굴 전용 ${faceFrame.landmarkCount}점 중 눈·코·입 윤곽과 Pose 어깨. 보라 점선은 등록 당시 Pose입니다.` : live ? `${synthetic ? '합성' : '실제'} 관측 13점. 점선은 등록 당시 화면 위치, 화살표는 화면 위치 변화입니다. 자세 판정 거리는 별도입니다.` : reference ? '현재 관측 없음. 등록 당시 화면 위치만 점선으로 표시합니다.' : '카메라 구도 안내 영역'}>
        {preparing && <g className={`dc-framing-target ${guidance.ready ? 'dc-target-ready' : ''}`} data-testid="framing-target">
          <line className="dc-target-center" x1={rect.x + rect.width * GUIDANCE_SETTINGS.center_x} x2={rect.x + rect.width * GUIDANCE_SETTINGS.center_x} y1={rect.y + rect.height * GUIDANCE_SETTINGS.face_top} y2={rect.y + rect.height * GUIDANCE_SETTINGS.shoulder_bottom} />
          <rect x={rect.x + rect.width * guideLeft} y={rect.y + rect.height * GUIDANCE_SETTINGS.face_top} width={rect.width * GUIDANCE_SETTINGS.center_tolerance * 2} height={rect.height * (GUIDANCE_SETTINGS.face_bottom - GUIDANCE_SETTINGS.face_top)} rx={Math.min(rect.width * GUIDANCE_SETTINGS.center_tolerance, 45)} />
          <path d={`M${rect.x + rect.width * (GUIDANCE_SETTINGS.center_x - GUIDANCE_SETTINGS.maximum_shoulder_width / 2)},${rect.y + rect.height * (guideShoulderY - .035)}v${rect.height * .07}h${rect.width * GUIDANCE_SETTINGS.maximum_shoulder_width}v-${rect.height * .07}`} />
        </g>}
        <PoseOverlay live={live} reference={reference} frame={frame} viewport={viewport} vectorId={vectorId} bodyOnly={faceSelected && face?.mode !== 'both'} comparison={face?.enabled && face?.mode === 'both'} />
        {faceSelected && faceFrame && <FaceOverlay face={faceFrame} frame={frame} viewport={viewport} />}
      </svg>
      <div className="dc-state-outline" key={state ?? session.phase} aria-hidden="true" />
      <div className="dc-topline"><span className={`dc-source ${synthetic ? 'dc-source-synthetic' : ''}`}><span className={`dc-signal ${live ? 'dc-signal-live' : ''}`} />{synthetic ? '합성 관측 · 영상 아님' : videoOn ? 'CAMERA LIVE' : 'CAMERA'}</span><span className="dc-input-count" title="화면에서 보이는 점의 수와 3D 모델 입력의 유효성은 다릅니다.">{live ? live.points.filter(usablePoint).length : 0}<span> / 13점</span>{!synthetic && session.observationUsable === false && <span> · 3D 입력 대기</span>}</span></div>

      {!active ? <div className="dc-launch">
        <span className="dc-launch-icon">{session.phase === 'error' ? <WarningCircle size={28} /> : session.phase === 'finished' ? <Check size={28} /> : <Camera size={28} />}</span>
        <h2>{session.phase === 'error' ? '카메라를 다시 연결해 주세요' : session.phase === 'finished' ? '측정이 종료되었습니다' : '카메라 앞에 편안하게 앉으세요'}</h2>
        <p>{session.phase === 'finished' ? session.readings.length ? '결과는 아래에서 확인하거나 내려받을 수 있습니다.' : '수집한 관측이 없습니다. 준비되면 다시 시작하세요.' : '시작하면 구도 안내, 기준 등록, 측정이 순서대로 진행됩니다.'}</p>
        {session.error && <p role="alert" className="dc-error">{session.error}</p>}
        <p>작은 움직임은 허용하고, 등록 때보다 큰 몸 위치·크기 변화가 3초 이어지는지 확인합니다. 카메라는 고정해 주세요.</p>
        <button className="dc-primary" disabled={needsModel} onClick={session.start}>{session.phase === 'error' ? <ArrowClockwise size={18} /> : <Play size={17} weight="fill" />}{session.phase === 'error' ? '다시 연결' : session.phase === 'finished' ? '새 측정 시작' : '자세 측정 시작'}</button>
        {needsModel && <p className="dc-error">실험 설정에서 LSTM 모델을 연결하거나 기본 예측 방식을 선택해 주세요.</p>}
        <div className="dc-secondary-actions"><button disabled={needsModel} onClick={session.startDemo}><Flask size={16} />합성 데모 실행</button>{session.readings.length > 0 && <button onClick={() => session.download()}><DownloadSimple size={16} />결과 내려받기</button>}</div>
      </div> : <>
        {session.phase === 'connecting' && <div className="dc-connection" role="status"><span className="dc-loader" /><strong>카메라를 연결하고 있습니다</strong><p>브라우저가 요청하면 카메라 사용을 허용해 주세요.</p></div>}
        <div className="dc-running-controls"><span className={`dc-state dc-state-${tone}`}><span />{readout}</span><button className="dc-stop" onClick={session.stop}><Square size={12} weight="fill" />측정 종료</button></div>
      </>}
    </div>
    {face && !synthetic && <DeveloperFaceComparison face={face} />}
    {tracking && <ForecastPreview forecast={session.forecast} session={session} metrics={!synthetic ? camera.metrics : undefined}
      cropMismatch={referenceMismatch}
      allowed={!!live && !referenceMismatch && session.reading?.state !== 'unmeasurable'} />}
    {active && (preparing || tracking) && <Dock className={showAlert ? 'dc-instruction-dock dc-alert-active' : 'dc-instruction-dock'} open={tracking ? !compact : undefined}>
      {tracking && <summary className="dc-detail-summary">영상 위치 수치<span>좌우 · 상하 · 어깨선</span></summary>}
      <div className={`dc-guidance ${tracking ? 'dc-guidance-tracking' : ''}`}>
        <div className="dc-guidance-copy" key={subtitleKey}><span className="dc-step-label">{registering ? '02 · 기준 등록' : tracking ? '03 · 실시간 관측' : `01 · ${guidance.step === 'intro' ? '시작 안내' : '구도 맞추기'}`}</span><h2 role="status">{showAlert ? `${synthetic ? '합성 알림 · ' : '이탈 알림 · '}지속적인 자세 변화가 관찰됩니다` : guidance.instruction}</h2><p>{showAlert ? `${session.reading?.postureScore != null ? `종합 이탈 ${session.reading.postureScore.toFixed(2)}배 · 상대 모양 거리 ` : '개인 기준과의 거리 '}${((session.reading?.deviation ?? 0) * 100).toFixed(1)}% · 연속 ${((session.reading ? selectedDurationMs(session.reading, session.alertBasis) : 0) / 1000).toFixed(1)}초 · 스트레칭 의도는 구분하지 않습니다.` : guidance.detail}</p></div>
        {preparing && guidance.step !== 'intro' && <div className="dc-hold"><div><span>{registering ? '기준 자료 수집' : '구도 확인'}</span><strong>{`${Math.round(progress * 100)}%`}</strong></div><progress max="1" value={progress} aria-label={registering ? '기준 자료 수집 진행' : '구도 확인 진행'} /></div>}
      </div>
      {tracking && <div className="dc-observed-values" aria-label="화면 위치 변화와 별도의 자세 판정 거리">
        <div><span>화면 좌우 · 화면폭</span><strong>{signed(live && reference && guidance.lateralPercent != null ? -guidance.lateralPercent : null, '%')}</strong></div>
        <div><span>화면 상하 · 화면높이</span><strong>{live && reference && guidance.verticalPercent != null ? `${Math.abs(guidance.verticalPercent).toFixed(1)}% ${guidance.verticalPercent > 0 ? '↓' : guidance.verticalPercent < 0 ? '↑' : ''}`.trim() : '—'}</strong></div>
        <div><span>어깨선 변화</span><strong>{signed(live && reference && guidance.shoulderDegrees != null ? -guidance.shoulderDegrees : null, '°')}</strong></div>
        <div className="dc-posture-distance"><span>자세 차이 · 어깨폭</span><strong>{live && reference && session.reading?.deviation != null && !referenceMismatch ? `${(session.reading.deviation * 100).toFixed(1)}%` : '—'}</strong></div>
      </div>}
      {tracking && <p className="dc-comparison-explanation">자세 비교는 3D 좌표를 양어깨 중심·폭에 맞춰 비교합니다. 몸 전체의 이동·크기 변화는 제외하므로 화면 위치가 달라도 기준 범위 안일 수 있습니다.</p>}
    </Dock>}
    <div className="dc-caption"><span><i className="dc-key-live" />현재 화면 위치<i className="dc-key-reference" />등록 당시 화면 위치</span><span className={referenceMismatch ? 'dc-caption-warning' : undefined}>{referenceMismatch ? '영상 비율이 바뀌어 기준선을 숨겼습니다. 새 측정으로 기준을 등록해 주세요.' : synthetic ? '합성 관측점 · 영상 화살표는 기준→현재' : '영상 화살표: 기준→현재 · 미래 예측은 별도 도식'}</span></div>
  </section>
}
