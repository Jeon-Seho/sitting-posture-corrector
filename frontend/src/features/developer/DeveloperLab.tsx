import DeveloperAlerts from './DeveloperAlerts'
import DeveloperLiveStatus from './DeveloperLiveStatus'
import DeveloperDecisionNumbers from './DeveloperDecisionNumbers'
import { useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, ArrowsLeftRight, Check, Clock, DownloadSimple, Flask, GearSix, Info, Moon, Pulse, Stack, Sun, UploadSimple, Waveform } from '@phosphor-icons/react'
import { DEV_POSTURE_DECISION, type ForecastReading, type ForecastState } from '../../../../model/prototype/forecast'
import type { CameraController } from '../../hooks/useCamera'
import DeveloperCameraStage from './DeveloperCameraStage'
import { LAB_SETTINGS } from './session'
import type { DeveloperSession, LabPredictor, LabRecord } from './types'
import './developer.css'
import { postureEntryRatio, postureRecoveryRatio, readingGapLimit, selectedDurationMs } from './readingView'
import DeveloperNormalCollection from './DeveloperNormalCollection'
import NormalCollectionPreview from './NormalCollectionPreview'
import type { NormalCollectionController } from './useNormalCollection'
import DeveloperAutoCollection from './DeveloperAutoCollection'
import DeveloperTraining from './DeveloperTraining'
import type { AutoNormalCollectionController } from './useAutoNormalCollection'
import type { FaceTrackingController } from './face/useFaceTracking'

type View = 'live' | 'records' | 'settings' | 'collection'
const predictorNames: Record<LabPredictor, string> = { hold_last: '마지막 위치 유지', constant_velocity: '등속 움직임', lstm: '학습한 LSTM' }
const stateNames: Record<ForecastState, string> = {
  needs_reference: '기준 등록 대기', registering: '기준 자세 등록 중', warming: '관측을 모으는 중', near_reference: '자세 차이 · 기준 범위 안',
  deviation_pending: '자세 변화 확인 중', unexpected_motion_candidate: '예상 밖 움직임', persistent_deviation_candidate: '지속 이탈 후보',
  recovery_pending: '기준 복귀 확인 중', unmeasurable: '측정 불가',
}
const stateDetails: Record<ForecastState, string> = {
  needs_reference: '기준 자세를 등록하면 비교를 시작합니다.', registering: '현재 자세를 개인 기준으로 등록하고 있습니다.', warming: '연속된 입력이 모이면 다시 판단합니다.',
  near_reference: '양어깨를 기준으로 비교한 3D 자세 차이가 허용 범위 안입니다. 화면에서 같은 위치라는 뜻은 아닙니다.', deviation_pending: '기준에서 벗어난 움직임의 지속시간을 확인합니다.',
  unexpected_motion_candidate: '예측 오차가 커졌습니다. 복귀 여부를 확인합니다.', persistent_deviation_candidate: '설정된 거리·시간 조건을 채운 변화입니다.',
  recovery_pending: '기준 근처에서 유지하는 시간을 확인합니다.', unmeasurable: '이 구간은 기준 유지와 이탈 누적에서 제외합니다.',
}
const tone = (state?: ForecastState) => state === 'near_reference' ? 'good' : state === 'persistent_deviation_candidate' ? 'alert' : state === 'deviation_pending' || state === 'unexpected_motion_candidate' ? 'warning' : state === 'unmeasurable' ? 'unknown' : 'neutral'
const elapsed = (ms: number) => `${Math.floor(ms / 60000).toString().padStart(2, '0')}:${Math.floor(ms / 1000 % 60).toString().padStart(2, '0')}`
const percent = (value: number | null | undefined) => value == null ? '—' : `${(value * 100).toFixed(1)}%`
const recordedAt = (iso: string) => new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
const isActive = (session: DeveloperSession) => ['connecting', 'guiding', 'registering', 'measuring'].includes(session.phase)
const sourceName = (session: Pick<DeveloperSession, 'source'>) => session.source === 'synthetic' ? '합성 데모' : '웹캠'

function Source({ synthetic, live = false }: { synthetic: boolean; live?: boolean }) {
  return <span className={`lab-source ${synthetic ? 'lab-source-demo' : ''}`}><i className={live ? 'lab-live-dot' : ''} />{synthetic ? '합성 데모 · 실제 측정 아님' : live ? '웹캠 · 실험 중' : '웹캠'}</span>
}
function PanelHeading({ title, caption, aside }: { title: string; caption?: string; aside?: ReactNode }) {
  return <div className="lab-panel-heading"><div><h2>{title}</h2>{caption && <p>{caption}</p>}</div>{aside}</div>
}
function StateBadge({ state, ready = true }: { state?: ForecastState; ready?: boolean }) {
  return <span className={`lab-state lab-state-${tone(state)}`}><i />{!ready ? '측정 대기' : state ? stateNames[state] : '측정 대기'}</span>
}
function Stat({ label, value, detail, accent }: { label: string; value: ReactNode; detail: string; accent?: string }) {
  return <div className={`lab-stat ${accent ? `lab-stat-${accent}` : ''}`}><span>{label}</span><strong>{value}</strong><p>{detail}</p></div>
}

function Comparison({ session, onSettings }: { session: DeveloperSession; onSettings: () => void }) {
  const r = session.reading, model = session.predictor === 'lstm', differs = r != null && r.state !== r.ruleState
  return <section className="lab-comparison-section" aria-label="예측과 거리 규칙 비교">
    <PanelHeading title="같은 움직임, 두 가지 결과" caption="원본 관측은 같고, 판단에 사용하는 정보가 다릅니다." aside={<span className={`lab-agreement ${differs ? 'lab-agreement-different' : ''}`}><ArrowsLeftRight size={15} />{!r ? '입력 대기' : differs ? '현재 상태가 다름' : '현재 상태가 같음'}</span>} />
    <div className="lab-comparison-grid">
      <article className="lab-result lab-result-predictor"><div className="lab-result-heading"><span><Waveform size={18} />{model ? 'LSTM + 거리·시간' : '예측 비교군 + 거리·시간'}</span><button onClick={onSettings} className="lab-text-button">{predictorNames[session.predictor]}<GearSix size={14} /></button></div>
        <div key={r?.state ?? 'waiting'} className="lab-state-change"><StateBadge state={r?.state} /><p className="lab-state-description">{r ? stateDetails[r.state] : '기준 등록 뒤 예측 오차와 지속시간을 함께 관찰합니다.'}</p></div>
        <div className="lab-result-values"><div><span>0.3초 예측 오차</span><strong>{percent(r?.error)}</strong></div><div><span>적용 오차 한계</span><strong>{percent(r?.errorLimit)}</strong></div></div>
        <p className="lab-result-note">{model ? session.model?.schema_version === 'forecast-weights-v2' ? '같은 MediaPipe 좌표를 예측합니다. 자세 판정 성능은 별도 검증이 필요합니다.' : '학습 데이터와 웹캠 좌표를 근사 연결한 실험입니다.' : '학습 모델이 아닌 단순 예측 비교군입니다.'}</p>
      </article>
      <article className="lab-result lab-result-rule"><div className="lab-result-heading"><span><Pulse size={18} />{r?.normalProfileId ? '개인 정상 범위 + 시간' : '거리·시간 규칙'}</span><span className="lab-muted-label">규칙 비교군</span></div>
        <div key={r?.ruleState ?? 'waiting'} className="lab-state-change"><StateBadge state={r?.ruleState} /><p className="lab-state-description">{r ? stateDetails[r.ruleState] : '기준에서 벗어난 거리와 지속시간만 관찰합니다.'}</p></div>
        <div className="lab-result-values"><div><span>3D 자세 차이 · 어깨폭 대비</span><strong>{percent(r?.deviation)}</strong></div><div><span>연속 이탈</span><strong>{r?.deviation != null ? `${(selectedDurationMs(r, 'rule') / 1000).toFixed(1)}초` : '—'}</strong></div></div>
        <p className="lab-result-note">{r?.imagePosture ? `종합 ${r.postureScore?.toFixed(2) ?? '—'}배 · ${postureEntryRatio(r)}배 진입 / ${postureRecoveryRatio(r).toFixed(2)}배 복귀` : r?.normalProfileId ? `정상 범위 경계 ${r.normalScore?.toFixed(2) ?? '—'}배 · 1배 진입 / 0.67배 복귀` : `거리 ${LAB_SETTINGS.deviation * 100}% 진입 · ${LAB_SETTINGS.recovery * 100}% 복귀`} · 최초 {LAB_SETTINGS.sustained_ms / 1000}초 관찰</p>
      </article>
    </div>
  </section>
}

function Timeline({ readings, predictor }: { readings: ForecastReading[]; predictor: LabPredictor }) {
  const [windowMs, setWindowMs] = useState(60000)
  const [showError, setShowError] = useState(false)
  const latest = readings.at(-1)?.timeMs ?? 0, first = readings[0]?.timeMs ?? 0
  const start = Math.max(first, latest - windowMs), end = Math.max(start + 10000, latest)
  const data = readings.filter(r => r.timeMs >= start)
  const valid = data.filter(r => r.deviation != null && !['needs_reference', 'registering', 'unmeasurable'].includes(r.state))
  const combined = data.some(r => r.imagePosture != null)
  const normal = combined || data.some(r => r.normalProfileId != null)
  const field = combined ? 'postureScore' : normal ? 'normalScore' : 'deviation'
  const threshold = combined ? postureEntryRatio(data.at(-1)) : normal ? 1 : LAB_SETTINGS.deviation
  const unit = normal ? '배' : '%'
  const factor = normal ? 1 : 100
  const max = Math.max(threshold * 1.5, ...data.map(r => r[field] ?? 0), ...data.map(r => showError && !normal ? r.error ?? 0 : 0), ...data.map(r => showError && !normal ? r.errorLimit ?? 0 : 0)) * 1.15
  const width = 900, top = 13, bottom = 160, chartHeight = 177
  const x = (time: number) => (time - start) / (end - start) * width
  const y = (value: number) => bottom - value / max * (bottom - top)
  const path = (field: 'deviation' | 'error' | 'normalScore' | 'postureScore') => {
    let open = false, previous = 0
    return data.map(r => {
      const value = r[field]
      if (value == null || ['unmeasurable', 'registering', 'needs_reference'].includes(r.state)) { open = false; return '' }
      const command = !open || r.timeMs - previous > readingGapLimit(r) ? 'M' : 'L'
      open = true; previous = r.timeMs
      return `${command}${x(r.timeMs).toFixed(1)},${y(value).toFixed(1)}`
    }).join(' ')
  }
  const segments = (key: 'state' | 'ruleState') => {
    const result: { left: number; width: number; state: ForecastState; endMs: number }[] = []
    for (let i = 1; i < data.length; i++) {
      const r = data[i], previous = data[i - 1]
      if (r.timeMs - previous.timeMs > readingGapLimit(r)) continue
      const state = previous[key], last = result.at(-1)
      const segmentWidth = (x(r.timeMs) - x(previous.timeMs)) / width * 100
      if (last && last.state === state && last.endMs === previous.timeMs) {
        last.width += segmentWidth; last.endMs = r.timeMs
      } else result.push({ left: x(previous.timeMs) / width * 100, width: segmentWidth, state, endMs: r.timeMs })
    }
    return result
  }
  const errorLimit = data.at(-1)?.errorLimit
  return <section className="lab-panel lab-timeline">
    <PanelHeading title="자세 변화 추이" caption="선이 높을수록 기준 자세와 차이가 큽니다. 점선은 이탈 진입 기준입니다." aside={<div className="lab-segmented" aria-label="그래프 시간 범위">{[[60000, '1분'], [180000, '3분']].map(([n, label]) => <button key={n} aria-pressed={windowMs === n} onClick={() => setWindowMs(Number(n))}>{label}</button>)}</div>} />
    <div className="lab-tracks" aria-label="예측과 규칙 상태 타임라인">{(['state', 'ruleState'] as const).map(key => <div className="lab-track" key={key}><span>{key === 'state' ? predictor === 'lstm' ? 'LSTM 보조' : '예측 비교군' : combined ? '종합 이탈' : normal ? '정상 범위' : '거리·시간'}</span><div className="lab-track-bar" role="img" aria-label={`${key === 'state' ? '예측' : '규칙'}의 관측된 상태 구간; 누락은 빈 구간으로 표시`}>{segments(key).map((part, i) => <i key={i} className={`lab-track-${tone(part.state)}`} title={stateNames[part.state]} style={{ left: `${part.left}%`, width: `${part.width}%` }} />)}{!data.length && <small>기준 등록 후 상태가 표시됩니다</small>}</div></div>)}</div>
    <div className="lab-chart-legend"><span><i className="lab-line-teal" />{combined ? '종합 이탈 기준 대비' : normal ? '정상 범위 경계 대비' : '기준 대비 거리'}</span>{showError && !normal && <span><i className="lab-line-purple" />예측 오차</span>}<span><i className="lab-line-dashed" />{combined ? `종합 이탈 경계 ${threshold}배` : normal ? '정상 범위 경계 1배' : `거리 진입 ${LAB_SETTINGS.deviation * 100}%`}</span>{!normal && <button className="lab-chart-toggle" aria-pressed={showError} onClick={() => setShowError(!showError)}>예측 오차 함께 보기</button>}<span>{combined && data.at(-1)?.postureEntryRatio !== undefined ? '등록 허용폭 대비 점수 · 확률 아님' : normal ? '경계 대비 배수 · 확률 아님' : '어깨 너비 대비 %'}</span></div>
    <div className="lab-chart"><div className="lab-chart-scale"><span>{(max * factor).toFixed(normal ? 1 : 0)}{unit}</span><span>{(max * factor / 2).toFixed(normal ? 1 : 0)}{unit}</span><span>0{unit}</span></div><div className="lab-chart-plot">
      <svg viewBox={`0 0 ${width} ${chartHeight}`} preserveAspectRatio="none" role="img" aria-label={valid.length ? `${combined ? '종합 이탈 기준 대비 배수' : normal ? '정상 범위 경계 대비 배수' : showError ? '기준 대비 거리와 예측 오차' : '기준 대비 거리'}. 시간 누락과 측정 불가는 연결하지 않습니다.` : '관측한 수치가 없어 비어 있는 그래프'}>
        {[top, (top + bottom) / 2, bottom].map(value => <line key={value} x1="0" x2={width} y1={value} y2={value} className="lab-chart-grid" />)}
        <line x1="0" x2={width} y1={y(threshold)} y2={y(threshold)} className="lab-threshold" />
        {showError && !normal && errorLimit != null && <line x1="0" x2={width} y1={y(errorLimit)} y2={y(errorLimit)} className="lab-error-threshold" />}
        <path data-series="deviation" d={path(field)} className="lab-series-deviation" vectorEffect="non-scaling-stroke" />
        {showError && !normal && <path data-series="error" d={path('error')} className="lab-series-error" vectorEffect="non-scaling-stroke" />}
      </svg>
      {!valid.length && <div className="lab-chart-empty"><Waveform size={25} /><strong>측정을 기다리는 중</strong><p>관측한 데이터만 표시합니다.</p></div>}
      <div className="lab-chart-times"><span>{elapsed(start)}</span><span>{elapsed((start + end) / 2)}</span><span>{elapsed(end)}</span></div>
    </div></div>
    <div className="lab-chart-footer"><div className="lab-state-legend"><span><i className="lab-legend-good" />기준 근처</span><span><i className="lab-legend-warning" />변화 확인</span><span><i className="lab-legend-alert" />지속 이탈</span><span><i className="lab-legend-unknown" />측정 불가</span></div><p>{showError && !normal && errorLimit != null ? `적용 오차 한계 ${percent(errorLimit)} · ` : ''}누락 구간은 연결하지 않음</p></div>
  </section>
}

function LiveResults({ session, camera, onSettings }: { session: DeveloperSession; camera: CameraController; onSettings: () => void }) {
  const hasValid = session.summary.validMs > 0
  return <>
    <div className="lab-summary-grid lab-live-summary"><Stat label="기준 범위 유지" value={session.summary.nearPercent == null ? '—' : `${Math.round(session.summary.nearPercent)}%`} detail={`비교 가능한 ${elapsed(session.summary.validMs)} 중`} accent="teal" /><Stat label="보낸 알림" value={hasValid || session.alertCount > 0 ? `${session.alertCount}회` : '—'} detail="선택한 판단 방식 · 재알림 포함" /><Stat label="비교 가능한 시간" value={elapsed(session.summary.validMs)} detail={`관측 끊김 ${elapsed(session.summary.unavailableMs)} 제외`} /></div>
    <Timeline readings={session.readings} predictor={session.predictor} />
    <DeveloperAlerts session={session} />
    <details className="lab-disclosure"><summary>모델과 규칙 비교<span>판단이 다른 이유와 예측 오차</span></summary><Comparison session={session} onSettings={onSettings} /></details>
    <details className="lab-disclosure"><summary>측정 상세<span>상태 변화 기록 · 카메라 입력 품질</span></summary>
    <div className="lab-bottom-grid"><section className="lab-panel"><PanelHeading title="이벤트" caption="등록, 상태 변화, 측정 중단을 자동으로 기록합니다." aside={<span className="lab-count">최근 {Math.min(session.events.length, 6)}개</span>} />{session.events.length ? <ol className="lab-events">{session.events.slice(-6).reverse().map(event => <li key={event.id}><i className={`lab-event-${event.tone}`} /><span>{event.label}</span><time>{elapsed(event.timeMs)}</time></li>)}</ol> : <div className="lab-empty-events"><Clock size={23} /><span>아직 기록된 이벤트가 없습니다.</span></div>}</section>
      <section className="lab-panel"><PanelHeading title="입력 품질" caption="판단보다 먼저 확인하는 관측 상태" /><dl className="lab-quality-list"><div><dt>입력 소스</dt><dd>{sourceName(session)}</dd></div><div><dt>관측 지점</dt><dd>{session.source === 'camera' && camera.state === 'on' ? `${session.visiblePoints} / 13` : '—'}</dd></div><div><dt>카메라 처리 속도</dt><dd>{session.source === 'camera' && camera.state === 'on' ? `${camera.metrics.fps.toFixed(1)} FPS` : '—'}</dd></div><div><dt>기준 자세</dt><dd>{session.readings.some(value => value.errorLimit != null) ? '등록됨' : '등록 전'}</dd></div></dl><p className="lab-info-note"><Info size={15} />화면의 비율과 거리는 건강 점수나 정상 확률이 아닙니다.</p></section></div>
    </details>
  </>
}

function Records({ session, onLive }: { session: DeveloperSession; onLive: () => void }) {
  const [selected, setSelected] = useState<string | null>(null)
  const record = session.records.find(value => value.id === selected)
  return <div className="lab-view-content"><div className="lab-page-heading"><div><h1>실험 기록</h1><p>이 탭에서 종료한 실험을 비교하고 내보내세요.</p></div><span className="lab-count">{session.records.length}개 세션</span></div><p className="lab-notice"><Info size={17} />새로고침하면 기록이 사라집니다. 필요한 결과는 먼저 내려받아 주세요.</p>
    {session.records.length ? <div className="lab-records">{session.records.map((item, index) => <RecordItem key={item.id} record={item} number={session.records.length - index} selected={item.id === selected} onSelect={() => setSelected(item.id === selected ? null : item.id)} onDownload={() => session.download(item)} />)}</div> : <section className="lab-panel lab-empty-records"><Stack size={35} weight="light" /><h2>저장된 실험이 없습니다.</h2><p>실험을 종료하면 입력 소스, 유지 비율, 타임라인을 확인할 수 있습니다.</p><button className="lab-button" onClick={onLive}>실험실로 돌아가기<ArrowRight size={16} /></button></section>}
    {record && <section className="lab-record-detail" aria-label="선택한 실험 상세"><div className="lab-detail-heading"><h2>{recordedAt(record.startedAt)}의 결과</h2><button className="lab-text-button" onClick={() => setSelected(null)}>상세 닫기</button></div><div className="lab-summary-grid"><Stat label="기준 근처 비율" value={record.summary.nearPercent == null ? '—' : `${Math.round(record.summary.nearPercent)}%`} detail={`유효 측정 ${elapsed(record.summary.validMs)}`} /><Stat label="평균 예측 오차" value={percent(record.summary.meanError)} detail={predictorNames[record.predictor]} /><Stat label="지속 이탈 후보" value={`${record.summary.deviations}회`} detail={record.alertSettings?.basis === 'rule' ? record.normalProfileId ? '개인 정상 범위 + 지속시간' : '거리 + 지속시간' : '예측 + 거리·시간 기준'} /><Stat label="측정 불가" value={elapsed(record.summary.unavailableMs)} detail="판정 누적에서 제외" /></div><Timeline readings={record.readings} predictor={record.predictor} /><p className="lab-record-provenance">실행 식별자 <code>{record.modelId}</code>{record.modelSha256 && <> · SHA-256 <code>{record.modelSha256}</code></>}</p></section>}
  </div>
}
function RecordItem({ record, number, selected, onSelect, onDownload }: { record: LabRecord; number: number; selected: boolean; onSelect: () => void; onDownload: () => void }) {
  return <article className={`lab-record ${selected ? 'lab-record-selected' : ''}`}><div className="lab-record-name"><h2>실험 {String(number).padStart(2, '0')}</h2><p>{recordedAt(record.startedAt)}</p><Source synthetic={record.source === 'synthetic'} /></div><div className="lab-record-value"><span>유지 비율</span><strong>{record.summary.nearPercent == null ? '—' : `${Math.round(record.summary.nearPercent)}%`}</strong></div><div className="lab-record-value"><span>실험 시간</span><strong>{elapsed(record.summary.elapsedMs)}</strong></div><div className="lab-record-actions"><button className="lab-button" aria-expanded={selected} onClick={onSelect}>{selected ? '상세 접기' : '결과 보기'}</button><button className="lab-icon-button" aria-label={`실험 ${number} 결과 내려받기`} onClick={onDownload}><DownloadSimple size={19} /></button></div></article>
}

function Settings({ session, normalReady = false }: { session: DeveloperSession; normalReady?: boolean }) {
  const input = useRef<HTMLInputElement>(null), active = isActive(session), modelReady = session.modelStatus === 'ready' && session.model != null
  return <div className="lab-view-content lab-settings"><div className="lab-page-heading"><div><h1>실험 설정</h1><p>예측 방식과 로컬 모델을 관리합니다.</p></div></div>{active && <p className="lab-notice"><Info size={17} />실험 중에는 설정이 고정됩니다. 종료 후 변경할 수 있습니다.</p>}
    <section className="lab-panel"><PanelHeading title="예측 방식" caption="선택한 예측 방식의 결과를 거리·시간 규칙과 비교합니다." /><fieldset className="lab-predictors" disabled={active}><legend className="lab-sr-only">예측 방식</legend>{([
      { id: 'hold_last', title: '마지막 위치 유지', description: '마지막 관측 위치가 0.3초 뒤에도 유지된다고 가정합니다.', badge: '비교군' },
      { id: 'constant_velocity', title: '등속 움직임', description: '최근 움직임의 방향과 속도를 그대로 연장합니다.', badge: '비교군' },
      { id: 'lstm', title: '학습한 LSTM', description: modelReady ? '최근 3초의 얼굴·어깨 위치로 0.3초 뒤를 예측하고, 기준 거리·지속시간 규칙과 함께 판단합니다.' : 'forecast.json을 불러온 뒤 선택할 수 있습니다.', badge: modelReady ? '모델 준비됨' : '모델 대기' },
    ] as const).map(option => <label key={option.id} className={`lab-predictor ${session.predictor === option.id ? 'lab-predictor-selected' : ''} ${option.id === 'lstm' && !modelReady ? 'lab-predictor-disabled' : ''}`}><input type="radio" name="predictor" value={option.id} checked={session.predictor === option.id} disabled={active || option.id === 'lstm' && !modelReady} onChange={() => session.setPredictor(option.id)} /><span className="lab-radio">{session.predictor === option.id && <Check size={13} weight="bold" />}</span><span className="lab-predictor-copy"><strong>{option.title}</strong><span>{option.description}</span></span><small>{option.badge}</small></label>)}</fieldset></section>
    <section className="lab-panel"><PanelHeading title="학습 모델" caption="이 기기에서 JSON을 읽고, 이 탭의 실험에만 사용합니다." aside={<span className={`lab-model-status ${modelReady ? 'lab-model-ready' : ''}`}>{modelReady ? '준비됨' : session.modelStatus === 'loading' ? '읽는 중' : '미연결'}</span>} /><div className="lab-model-file"><UploadSimple size={27} /><div><h3>{modelReady ? session.model!.model_id : 'forecast.json 파일을 선택하세요'}</h3><p>forecast-weights-v1 / v2 · 최대 1MB · 파일을 연결하면 LSTM을 선택합니다.</p></div><input ref={input} className="lab-sr-only" type="file" accept=".json,application/json" aria-label="예측 모델 JSON 파일" disabled={active} onChange={event => { const file = event.target.files?.[0]; if (file) void session.loadModel(file); event.target.value = '' }} /><button className="lab-button" disabled={active || session.modelStatus === 'loading'} onClick={() => input.current?.click()}>파일 선택</button></div>{session.modelError && <p className="lab-error" role="alert">{session.modelError}</p>}{session.model?.schema_version === 'forecast-weights-v2' && <div className="lab-info-note"><div><strong>{session.model.training.mode === 'pilot' ? '개인 시험 학습 · 독립 평가 없음' : '참여자 분리 평가 · 좌표 예측만 평가'}</strong><p>추출기 <code>{session.model.pose_model_id}</code></p><p>학습 {session.model.training.split_window_counts.train.toLocaleString()}창 · 수동 확인 {session.model.training.labels_used.manual_confirmed_windows.toLocaleString()}창 · 자동 약라벨 {session.model.training.labels_used.automatic_weak_windows.toLocaleString()}창</p></div></div>}<p className="lab-info-note"><Info size={16} />{session.model?.schema_version === 'forecast-weights-v2' ? 'MediaPipe로 수집한 13점의 0.3초 뒤 좌표를 예측합니다. 같은 카메라 추출 모델에서만 실행합니다.' : 'Panoptic v1은 웹캠 좌표와 근사 대응입니다.'} LSTM의 실제 자세 판정 성능은 검증되지 않았습니다.</p></section>
    <section className="lab-panel"><PanelHeading title="적용된 실험 조건" caption={`새 측정은 ${normalReady ? '개인 정상 범위' : '등록 상대 모양'}와 몸 전체 변화를 함께 비교합니다.`} /><dl className="lab-policy-grid"><div><dt>기준 등록</dt><dd>{LAB_SETTINGS.baseline_ms / 1000}초</dd></div><div><dt>예측 시점</dt><dd>{LAB_SETTINGS.horizon_ms / 1000}초 뒤</dd></div><div><dt>새 종합 진입 / 복귀</dt><dd>{`${DEV_POSTURE_DECISION.entryRatio}배 / ${DEV_POSTURE_DECISION.recoveryRatio.toFixed(2)}배`}</dd></div><div><dt>최초 이탈 / 복귀 확인</dt><dd>{LAB_SETTINGS.sustained_ms / 1000}초 / {LAB_SETTINGS.recovery_ms / 1000}초</dd></div></dl><p className="lab-info-note">카메라를 움직였다면 실험을 종료하고 다시 시작해 기준을 등록하세요.</p></section>
  </div>
}

export default function DeveloperLab({ camera, session, collection, automatic, face, performancePanel, normalProfileNotice, benchmarkBusy = false }: {
  performancePanel?: ReactNode; normalProfileNotice?: string; benchmarkBusy?: boolean; face?: FaceTrackingController
  camera: CameraController; session: DeveloperSession; collection?: NormalCollectionController; automatic?: AutoNormalCollectionController
}) {
  const [view, setView] = useState<View>('live'), [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [collectionMode, setCollectionMode] = useState<'automatic' | 'manual'>(automatic ? 'automatic' : 'manual')
  const active = isActive(session)
  const [cameraExpanded, setCameraExpanded] = useState(false)
  const hasResults = session.phase === 'measuring' || session.phase === 'finished'
  const dashboard = hasResults && !cameraExpanded
  const changeView = (next: View) => {
    if (view === 'collection' && next !== 'collection' && collection) {
      collection.interrupt()
      if (!active) camera.stop()
    }
    setView(next)
  }
  return <div className="dev-lab" data-theme={theme}>
    <a className="lab-skip" href="#developer-main">본문으로 이동</a>
    <fieldset className="lab-interaction-boundary" disabled={benchmarkBusy}><header className="lab-header"><a className="lab-brand" href="/dev"><span><Flask size={22} weight="bold" /></span><strong>Posture<span>Lab</span></strong></a><nav aria-label="개발자 공간 메뉴">{([{ id: 'live', text: '실험실', icon: <Pulse size={17} /> }, { id: 'collection', text: '정상 자세 수집', icon: <Flask size={17} /> }, { id: 'records', text: '기록', icon: <Stack size={17} /> }, { id: 'settings', text: '설정', icon: <GearSix size={17} /> }] as const).map(item => <button key={item.id} className={view === item.id ? 'lab-nav-active' : ''} aria-current={view === item.id ? 'page' : undefined} disabled={item.id === 'collection' && active} onClick={() => changeView(item.id)}>{item.icon}{item.text}{item.id === 'records' && session.records.length > 0 && <small>{session.records.length}</small>}</button>)}</nav><div className="lab-header-actions"><a href="/dev" className="lab-user-link">2D · 상대 z 비교</a><a href="/" className="lab-user-link"><ArrowLeft size={15} />사용자 화면</a><button className="lab-icon-button" aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}</button></div></header></fieldset>
    <main className="lab-main" id="developer-main"><fieldset className="lab-interaction-boundary" disabled={benchmarkBusy}>
      {view !== 'live' && active && <button className="lab-running" onClick={() => setView('live')}><i />{sourceName(session)} 실험 진행 중 <span>{elapsed(session.summary.elapsedMs)}</span><ArrowRight size={16} /></button>}
      {view === 'collection' && collection ? <div className="lab-view-content">
        <div className="lab-page-heading"><div><h1>정상 자세 데이터 수집</h1><p>자동으로 모은 실험 자료와 직접 촬영한 정상 구간을 구분해 보관합니다.</p></div></div>
        {automatic && <div className="lab-collection-modes" aria-label="정상 데이터 수집 방식">{([
          ['automatic', '자동 수집', '선택한 기준 이하일 때 자동으로 행 추가 · 기본 6%'],
          ['manual', '수동 · 30초 측정', '직접 정상 자세를 취하고 구간 확인'],
        ] as const).map(([mode, title, detail]) => <button key={mode} type="button" aria-pressed={collectionMode === mode} onClick={() => {
          if (collectionMode === 'manual' && mode !== collectionMode) { collection.interrupt('수집 방식을 전환해 수동 촬영을 중단했습니다.'); if (!active) camera.stop() }
          setCollectionMode(mode)
        }}><strong>{title}</strong><span>{detail}</span></button>)}</div>}
        {collectionMode === 'automatic' && automatic ? <>
          <DeveloperAutoCollection collection={automatic} />
          <div className="lab-auto-start"><p>자세 측정을 시작하면 기준 등록 뒤부터 자동으로 수집합니다. 선택한 선별 기준을 벗어나면 건너뛰고, 범위 안으로 돌아오면 다시 쌓입니다.</p>
            <button type="button" className="lab-button" disabled={active || session.modelStatus === 'loading' || session.predictor === 'lstm' && !session.model} onClick={() => {
              changeView('live'); automatic.setEnabled(true); session.start()
            }}>자동 수집 측정 시작<ArrowRight size={16} /></button></div>
        </> : <div className="lab-collection-grid"><NormalCollectionPreview camera={camera} /><DeveloperNormalCollection collection={collection} cameraState={camera.state} disabled={active} participantCodeDefault={automatic?.snapshot.participantCode} /></div>}
        <p className="lab-notice">자료와 개인 범위는 이 탭에만 남습니다. 필요한 자료는 내려받아 보관하세요. 수동으로 확인해 적용한 개인 범위는 다음 웹캠 측정부터 사용합니다.</p><DeveloperTraining onOpenSettings={() => changeView('settings')} /><button className="lab-button" onClick={() => changeView('live')}>실험실로 돌아가기<ArrowRight size={16} /></button>
      </div> : view === 'records' ? <Records session={session} onLive={() => setView('live')} /> : view === 'settings' ? <Settings session={session} normalReady={active ? session.reading?.normalProfileId != null : !!collection?.profile && !normalProfileNotice} /> : <div className="lab-view-content">
        <div className="lab-page-heading"><div><h1>실시간 자세 실험</h1><p>기준 자세와 지금의 움직임을 직접 비교하세요.</p></div><div className="lab-session-meta"><Source synthetic={session.source === 'synthetic'} live={active} /><span className="lab-elapsed"><Clock size={15} />{elapsed(session.summary.elapsedMs)}</span></div></div>
        <DeveloperDecisionNumbers session={session} />
        <div className="lab-monitor" data-layout={dashboard ? 'dashboard' : 'focus'}>
          <div className="lab-monitor-camera">
            {hasResults && <div className="lab-camera-toolbar"><span>카메라 미리보기</span><button type="button" aria-expanded={cameraExpanded} aria-controls="lab-camera-preview" onClick={() => setCameraExpanded(!cameraExpanded)}>{cameraExpanded ? '작게 보기' : '크게 보기'}</button></div>}
            <div id="lab-camera-preview"><DeveloperCameraStage camera={camera} session={session} compact={dashboard} face={face} /></div>
          </div>
          {hasResults && <DeveloperLiveStatus session={session} />}
        </div>
        <div className="lab-normal-strip"><span>{collection?.profile && !normalProfileNotice ? active && session.reading?.normalProfileId ? '개인 정상 범위 적용 중 · LSTM은 예측 보조' : '개인 정상 범위 준비됨 · 다음 측정에 적용' : '정상 자료 미등록 · 등록 자세는 검증되지 않음 · 거리·시간 규칙 사용'}</span><button type="button" disabled={active} className="lab-text-button" onClick={() => changeView('collection')}>정상 자세 수집<ArrowRight size={14} /></button></div>
        <div className={`lab-model-strip ${session.predictor === 'lstm' ? 'lab-model-strip-active' : ''}`}><span><Waveform size={16} />{session.predictor === 'lstm' ? 'LSTM 예측 보조 선택됨' : session.model ? 'LSTM 모델 준비됨' : '학습 모델 미연결'}</span><p>{session.predictor === 'lstm' ? session.model?.model_id : `현재 예측 비교군: ${predictorNames[session.predictor]}`}</p><button className="lab-text-button" onClick={() => setView('settings')}>{session.model ? '방식 선택' : '모델 연결'}<ArrowRight size={14} /></button></div>
        {automatic && <DeveloperAutoCollection collection={automatic} compact />}
        <LiveResults session={session} camera={camera} onSettings={() => setView('settings')} />
      </div>}
      </fieldset>{normalProfileNotice && <p className="lab-notice" role="status">{normalProfileNotice}</p>}{performancePanel}
      <footer className="lab-footer"><span>Posture Lab · 연구용 개발 공간</span><span>비의료용 · 실제 환경 판정 성능 미검증</span></footer>
    </main>
  </div>
}
