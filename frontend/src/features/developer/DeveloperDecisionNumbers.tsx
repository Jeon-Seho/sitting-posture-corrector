import { DEV_POSTURE_DECISION, type ForecastState } from '../../../../model/prototype/forecast'
import { IMAGE_POSTURE_SPEC } from '../../../../model/prototype/imagePosture'
import { postureEntryRatio, selectedDurationMs, selectedLabState, selectedReturnedExcursions } from './readingView'
import { LAB_SETTINGS } from './session'
import type { DeveloperSession, LabGuideFrame } from './types'
import './decision-numbers.css'

const names: Record<ForecastState, string> = {
  needs_reference: '등록 전', registering: '등록 중', warming: '예측 준비 중', near_reference: '범위 안',
  deviation_pending: '이탈 시간 확인', unexpected_motion_candidate: '예측 밖 움직임',
  persistent_deviation_candidate: '지속 이탈 후보', recovery_pending: '복귀 확인', unmeasurable: '측정 불가',
}
const blocked = new Set(['needs_reference', 'registering', 'warming', 'unmeasurable'])
const number = (v: number | null | undefined) => v != null && Number.isFinite(v) && v >= 0 ? v : null
const seconds = (v: number | null | undefined) => number(v) == null ? '—' : `${(v! / 1000).toFixed(1)}초`
const signed = (v: number | null | undefined, unit: string) => v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}${unit}`
const stamp = (ms: number) => `${Math.floor(ms / 60000).toString().padStart(2, '0')}:${(ms / 1000 % 60).toFixed(1).padStart(4, '0')}`

/** Screen projection only; deliberately not an alarm or a new posture score. */
export function screenWidthChange(live: LabGuideFrame | null, reference: LabGuideFrame | null): number | null {
  if (!live || !reference || [live, reference].some(f => !Number.isFinite(f.width) || !Number.isFinite(f.height) || f.width <= 0 || f.height <= 0) ||
    Math.abs(live.width / live.height - reference.width / reference.height) > .01) return null
  const span = (f: LabGuideFrame) => {
    const l = f.points[11], r = f.points[12]
    if (!l || !r || [l, r].some(p => ![p.x, p.y, p.visibility].every(Number.isFinite) || p.visibility < .5 || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return null
    return Math.hypot(l.x - r.x, (l.y - r.y) * f.height / f.width)
  }
  const a = span(live), b = span(reference)
  return a != null && b != null && b > 0 ? (a / b - 1) * 100 : null
}

/** Read-only projection of the chosen engine policy and actual delivery events. */
export default function DeveloperDecisionNumbers({ session }: { session: DeveloperSession }) {
  const r = session.reading, state = r ? selectedLabState(r, session.alertBasis) : undefined
  const valid = state != null && !blocked.has(state)
  const ended = session.phase === 'finished' || session.phase === 'error'
  const duration = valid && r ? number(selectedDurationMs(r, session.alertBasis)) : null
  const returned = r ? number(selectedReturnedExcursions(r, session.alertBasis)) : null
  const last = session.alerts.at(-1)
  const recent = valid && !ended && r && last && r.timeMs >= last.timeMs && r.timeMs - last.timeMs < 1000 ? 1 : 0
  const pending = state === 'deviation_pending' || state === 'unexpected_motion_candidate'
  const recovery = valid && r ? session.alertBasis === 'rule' ? r.ruleRecoveryMs : r.predictionRecoveryMs : null
  const normal = r?.normalProfileId != null
  const combined = r?.imagePosture != null
  const metric = combined ? number(r?.postureScore) : normal ? number(r?.normalScore) : number(r?.deviation)
  const observed = r && !['needs_reference', 'registering', 'unmeasurable'].includes(r.state) && r.deviation != null
  const width = observed ? screenWidthChange(session.guidance.live, session.guidance.reference) : null
  const geometry = width != null
  const flag = (active: boolean) => valid ? active ? '1' : '0' : '—'
  const cells = [
    { key: 'pending', label: '이탈 확인 중', value: flag(pending), detail: '1 확인 중 · 0 해당 없음' },
    { key: 'returned', label: '짧은 이탈 후 복귀', value: returned == null ? '—' : `${returned}회`, detail: '복귀를 관측한 뒤 누적' },
    { key: 'persistent', label: '지속 이탈 판정', value: flag(state === 'persistent_deviation_candidate'), detail: '1 지속 이탈 후보' },
    { key: 'duration', label: '연속 이탈 시간', value: seconds(duration), detail: session.alertBasis === 'rule' ? `알림 기준 ${LAB_SETTINGS.sustained_ms / 1000}.0초` : '3초 + 예측 조건 · 최대 5초' },
    { key: 'alert', label: '최근 1초 알림 발생', value: valid ? String(recent) : '—', detail: '실제 시각 알림 발생 기준' },
    { key: 'count', label: '누적 알림', value: `${session.alertCount}회`, detail: '첫 알림 + 재알림' },
  ]
  return <section className={`dev-decision-numbers ${recent ? 'ddn-delivered' : ''}`} aria-label="실시간 판정 숫자">
    <div className="ddn-heading"><strong>{ended ? '마지막 관측 판정' : '실시간 판정 숫자'}</strong><span>{session.source === 'synthetic' ? '합성 데모 · ' : ''}{session.soundEnabled ? '소리 켜짐' : '무음 테스트'} · {session.alertBasis === 'rule' ? '실측 룰' : '예측 보조'} 기준</span></div>
    {(r?.imagePosture?.policy !== IMAGE_POSTURE_SPEC.policy || r?.postureEntryRatio !== DEV_POSTURE_DECISION.entryRatio) && <p className="ddn-note">{combined ? '이전 기준의 측정입니다. ' : ''}새 측정은 {DEV_POSTURE_DECISION.entryRatio}배 초과에서 이탈을 확인합니다. 몸 변화 하한: 이동 {IMAGE_POSTURE_SPEC.translationFloor * 100}% · 축소 {IMAGE_POSTURE_SPEC.shrinkFloor * 100}%. 등록 흔들림이 크면 허용폭을 넓힙니다.</p>}
    <div className="ddn-grid">{cells.map(cell => <div className={`ddn-cell ddn-${cell.key}`} key={cell.key}><span>{cell.label}</span><strong data-testid={`decision-${cell.key}`}>{cell.value}</strong><small>{cell.detail}</small></div>)}</div>
    <div className="ddn-state-line"><span>실측 룰 <b>{r ? names[selectedLabState(r, 'rule')] : '대기'}</b></span><span>예측 보조 <b>{r ? names[r.state] : '대기'}</b></span><span>{combined ? '종합 이탈 기준' : normal ? '정상 범위' : '등록 기준 거리'} <b>{valid && metric != null ? normal || combined ? `${metric.toFixed(2)} / ${(combined ? postureEntryRatio(r) : 1).toFixed(2)}배` : `${(metric * 100).toFixed(1)} / 12.0%` : '—'}</b></span><span>복귀 확인 <b>{state === 'recovery_pending' ? `${seconds(recovery)} / 3.0초` : '—'}</b></span><span>예측 오차 / 한계 <b>{observed && number(r?.error) != null && number(r?.errorLimit) != null ? `${(r!.error! * 100).toFixed(2)} / ${(r!.errorLimit! * 100).toFixed(2)}%` : '—'}</b></span></div>
    {combined && <div className="ddn-state-line"><span>상대 모양 <b>{observed ? (normal ? r?.normalScore : (r?.deviation ?? 0) / LAB_SETTINGS.deviation)?.toFixed(2) ?? '—' : '—'}배</b></span><span>몸 전체 변화 <b>{observed ? r?.imagePosture?.score?.toFixed(2) ?? '—' : '—'}배</b></span><span>몸 공통 이동 <b>{observed && r?.imagePosture?.translation != null ? `${(r.imagePosture.translation * 100).toFixed(1)} / ${((r.imagePosture.translationLimit ?? 0) * 100).toFixed(1)}%` : '—'}</b></span><span>어깨폭 축소 <b>{observed && r?.imagePosture?.shrink != null ? `${(r.imagePosture.shrink * 100).toFixed(1)} / ${((r.imagePosture.shrinkLimit ?? 0) * 100).toFixed(1)}%` : '—'}</b></span></div>}
    <div className="ddn-screen-line"><span>화면 좌우 <b>{signed(geometry ? -(session.guidance.lateralPercent ?? NaN) : null, '%')}</b></span><span>화면 상하 <b>{signed(geometry ? session.guidance.verticalPercent : null, '%')}</b></span><span>화면 어깨폭 변화 <b>{signed(width, '%')}</b></span><span>어깨선 기울기 <b>{signed(geometry ? -(session.guidance.shoulderDegrees ?? NaN) : null, '°')}</b></span></div>
    <details className="ddn-help"><summary>수치 해석과 놓칠 수 있는 움직임</summary><p className="ddn-note">좌우·상하는 화면 너비·높이 대비 변화입니다. 상대 모양의 정규화로 빠지는 큰 이동·축소는 등록 기준에 고정한 몸 전체 변화 점수로 보완합니다. 몸 공통 이동의 100%는 등록 당시 어깨폭입니다. 카메라를 옮겼다면 새 기준이 필요합니다. 짧은 이탈 후 복귀는 스트레칭 의도를 판정한 값이 아닙니다.</p></details>
    <div className="ddn-last-alert">{last ? `마지막 알림 ${stamp(last.timeMs)} · ${last.kind === 'first' ? '첫 알림' : '재알림'} · 이탈 ${seconds(last.durationMs)}` : '마지막 알림 없음'}{ended && ' · 종료된 측정의 기록입니다.'}</div>
  </section>
}
