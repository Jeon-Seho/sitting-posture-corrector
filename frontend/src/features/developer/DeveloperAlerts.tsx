import { Bell, BellRinging, Info, SpeakerHigh, SpeakerSlash, Waveform } from '@phosphor-icons/react'
import type { ForecastState } from '../../../../model/prototype/forecast'
import { ALERT_SETTINGS } from './alerts'
import { LAB_SETTINGS } from './session'
import type { DeveloperSession } from './types'
import './alerts.css'

const percent = (value: number | null | undefined) => value == null ? '—' : `${(value * 100).toFixed(1)}%`
const elapsed = (ms: number) => `${Math.floor(ms / 60000).toString().padStart(2, '0')}:${Math.floor(ms / 1000 % 60).toString().padStart(2, '0')}`
const labels: Record<ForecastState, string> = {
  needs_reference: '기준 등록 대기', registering: '기준 자세 등록 중', warming: '연속 관측 수집 중', near_reference: '기준 범위 안',
  deviation_pending: '자세 변화 · 지속 확인', unexpected_motion_candidate: '예상 밖 움직임 · 복귀 확인',
  persistent_deviation_candidate: '지속 이탈 후보', recovery_pending: '기준 복귀 · 유지 확인', unmeasurable: '측정 불가',
}
const stateTone = (state?: ForecastState) => state === 'persistent_deviation_candidate' ? 'alert' : state === 'near_reference' ? 'good' : state === 'deviation_pending' || state === 'unexpected_motion_candidate' ? 'warning' : 'neutral'
const audioLabels = {
  inactive: '시작 또는 소리 테스트로 오디오를 준비합니다.',
  ready: '이 브라우저에서 소리를 재생할 수 있습니다.',
  blocked: '브라우저가 소리를 차단했습니다. 소리 테스트를 눌러 다시 확인하세요.',
  unsupported: '이 브라우저는 알림 소리를 지원하지 않습니다.',
} as const

/** Presentation only. Alarm decisions and audio are owned by the session adapter. */
export default function DeveloperAlerts({ session }: { session: DeveloperSession }) {
  const active = ['connecting', 'guiding', 'registering', 'measuring'].includes(session.phase)
  const r = session.reading
  const observationBlocked = r != null && ['needs_reference', 'registering', 'warming', 'unmeasurable'].includes(r.state)
  const selectedState = observationBlocked ? r.state : session.alertBasis === 'predictor' ? r?.state : r?.ruleState
  const ended = session.phase === 'finished' || session.phase === 'error'
  const deviation = r?.deviation ?? null
  const gaugeMax = Math.max(LAB_SETTINGS.deviation * 2, Math.ceil(Math.max(deviation ?? 0, session.alertPeakDeviation ?? 0) * 10) / 10)
  const ratio = deviation == null ? null : deviation / LAB_SETTINGS.deviation
  const last = session.alerts.at(-1)
  const predictionLabel = session.predictor === 'lstm' ? 'LSTM + 거리·시간' : '예측 비교군 + 거리·시간'
  return <section className="dev-alerts" aria-label="이탈 알림과 판정 기준">
    <div className="da-heading"><div><h2><Bell size={19} />이탈 알림</h2><p>{ended ? r ? '종료된 실험의 마지막 관측입니다.' : '종료된 실험에 관측한 수치가 없습니다.' : '얼마나 벗어났고, 얼마나 이어졌는지 확인하세요.'}</p></div><span className={`da-current-state da-tone-${stateTone(selectedState)}`}><i />{selectedState ? labels[selectedState] : '측정 대기'}</span></div>
    <div className="da-live-panel">
      <div className="da-distance"><div className="da-distance-label">{ended ? '마지막 관측 거리' : '개인 기준에서 벗어난 거리'}{session.source === 'synthetic' && <span className="da-synthetic">합성 데모</span>}</div><div className="da-distance-value"><strong>{deviation == null ? '—' : (deviation * 100).toFixed(1)}</strong>{deviation != null && <span>%</span>}<small>어깨 너비 대비</small></div>
        <div className="da-meter" role="img" aria-label={deviation == null ? '아직 측정 거리가 없습니다. 거리 진입 기준 12%, 복귀 시작 기준 8%.' : `현재 거리 ${percent(deviation)}, 진입 기준의 ${ratio!.toFixed(2)}배. 거리 진입 기준 12%, 복귀 시작 기준 8%.`}>
          <div className="da-meter-track"><span className={`da-meter-value da-tone-${stateTone(selectedState)}`} style={{ width: `${deviation == null ? 0 : Math.min(100, deviation / gaugeMax * 100)}%` }} /><i className="da-meter-recovery" style={{ left: `${LAB_SETTINGS.recovery / gaugeMax * 100}%` }} /><i className="da-meter-entry" style={{ left: `${LAB_SETTINGS.deviation / gaugeMax * 100}%` }} /></div><div className="da-meter-scale"><span>0%</span><span>{Math.round(gaugeMax * 100)}%</span></div>
        </div>
        <div className="da-threshold-key"><span><i />복귀 시작 {LAB_SETTINGS.recovery * 100}%</span><span><i />이탈 진입 {LAB_SETTINGS.deviation * 100}%</span></div><p className="da-distance-explanation">어깨 너비로 정규화한 3D 얼굴·귀·어깨 변화량의 평균입니다. 자세가 나쁜 정도를 뜻하지 않습니다.</p>
      </div>
      <div className="da-metrics"><div><span>진입 기준 대비</span><strong>{ratio == null ? '—' : `${ratio.toFixed(2)}배`}</strong><small>거리 ÷ {LAB_SETTINGS.deviation * 100}%</small></div><div><span>연속 이탈 시간</span><strong>{deviation == null ? '—' : `${(r!.durationMs / 1000).toFixed(1)}초`}</strong><small>측정 누락 시 연속성 중단</small></div><div><span>이번 변화의 최대 거리</span><strong>{percent(session.alertPeakDeviation)}</strong><small>복귀·측정 불가 시 초기화</small></div><div><span>예측 오차 / 개인 한계</span><strong className="da-error-values">{percent(r?.error)}<em>/</em>{percent(r?.errorLimit)}</strong><small>{LAB_SETTINGS.horizon_ms / 1000}초 뒤 예측과 관측의 차이</small></div><div className="da-alert-count"><span>발생한 알림</span><strong>{session.alertCount}<b>회</b></strong><small>첫 알림과 재알림 포함</small></div></div>
    </div>
    <div className="da-controls"><label htmlFor="developer-alert-basis">알림 판단 기준<select id="developer-alert-basis" value={session.alertBasis} disabled={active} onChange={event => session.setAlertBasis(event.target.value as 'predictor' | 'rule')}><option value="predictor">{predictionLabel}</option><option value="rule">거리·시간만</option></select></label><div className="da-audio-controls"><button className={`da-sound-toggle ${session.soundEnabled ? 'da-sound-on' : ''}`} type="button" aria-pressed={session.soundEnabled} onClick={() => session.setSoundEnabled(!session.soundEnabled)}>{session.soundEnabled ? <SpeakerHigh size={17} /> : <SpeakerSlash size={17} />}{session.soundEnabled ? '알림 소리 켜짐' : '알림 소리 꺼짐'}</button><button className="da-test-sound" type="button" disabled={!session.soundEnabled || session.audioStatus === 'unsupported'} onClick={session.testAlertSound}>소리 테스트</button></div></div>
    <div className="da-control-notes"><span>{active ? '실험 중에는 판단 기준이 고정됩니다. 음소거는 언제든 바꿀 수 있습니다.' : '선택한 기준의 지속 이탈 후보 상태에서 알림을 만듭니다.'}</span><span className={session.audioStatus === 'blocked' ? 'da-audio-blocked' : ''}>{session.soundEnabled ? audioLabels[session.audioStatus] : '소리가 꺼져 있습니다. 소리를 켜면 테스트할 수 있습니다.'}</span></div>
    {last && <div className={`da-alert-notice ${last.source === 'synthetic' ? 'da-alert-synthetic' : ''}`} role="alert" aria-atomic="true" key={last.id}><span className="da-alert-icon"><BellRinging size={22} /></span><div><strong>{last.source === 'synthetic' ? '합성 데모 알림 · ' : ''}{last.kind === 'reminder' ? '지속 이탈 후보가 이어지고 있습니다' : '지속 이탈 후보를 관찰했습니다'}</strong><p>알림 시점 거리 {percent(last.deviation)} · 최대 {percent(last.peakDeviation)} · 연속 {(last.durationMs / 1000).toFixed(1)}초 · {last.basis === 'predictor' ? '예측 + 거리·시간' : '거리·시간만'}</p></div><time>{elapsed(last.timeMs)}</time></div>}
    <details className="da-criteria" open><summary><span><Waveform size={17} />현재 적용된 판정 기준</span><span>거리 · 시간 · 예측 오차</span></summary><div className="da-criteria-body"><dl className="da-policy-list"><div><dt>거리 조건</dt><dd><strong>{LAB_SETTINGS.deviation * 100}% 이상</strong>에서 이탈 시작, <strong>{LAB_SETTINGS.recovery * 100}% 이하</strong>에서 복귀 확인 시작</dd></div><div><dt>거리·시간 규칙</dt><dd>이탈이 <strong>{LAB_SETTINGS.sustained_ms / 1000}초</strong> 이어지면 지속 이탈 후보</dd></div><div><dt>개인 오차 한계</dt><dd><strong>8초 등록</strong> 중 예측 오차의 <strong>99백분위</strong>를 사용하며, 최솟값은 <strong>2%</strong></dd></div><div><dt>예측 + 거리·시간</dt><dd>이탈 <strong>{LAB_SETTINGS.sustained_ms / 1000}초</strong> + 최근 <strong>1초</strong> 동안 예측 오차가 개인 한계 이하</dd></div><div><dt>예측 경로의 보완 조건</dt><dd>이탈이 <strong>{LAB_SETTINGS.fallback_ms / 1000}초</strong> 이어지면 예측 오차가 커도 지속 이탈 후보</dd></div><div><dt>복귀 확인</dt><dd>기준 범위 안에서 <strong>{LAB_SETTINGS.recovery_ms / 1000}초</strong> 유지하면 사건 종료</dd></div><div><dt>동일 사건의 재알림</dt><dd>같은 이탈이 이어지면 <strong>{ALERT_SETTINGS.reminder_ms / 1000}초</strong> 간격으로 재알림</dd></div></dl><div className="da-stretch-note"><Info size={17} /><div><strong>스트레칭과 자세 붕괴의 의도를 구분하지 않습니다.</strong><p>예측 오차가 크다는 이유만으로 일시 동작이나 스트레칭으로 확정하지 않습니다. 기준으로 돌아오는지 확인하며, 오래 유지한 스트레칭도 지속 이탈 후보가 될 수 있습니다.</p></div></div><p className="da-quality-note">가림·낮은 관측 품질·시간 누락은 측정 불가입니다. 유지·이탈 누적과 정상 복귀로 취급하지 않습니다.</p></div></details>
    {session.alerts.length > 1 && <div className="da-recent-alerts"><h3>최근 알림</h3><ol>{session.alerts.slice(-3).reverse().map(alert => <li key={alert.id}><time>{elapsed(alert.timeMs)}</time><span>{alert.source === 'synthetic' ? '합성 · ' : ''}{alert.kind === 'reminder' ? '같은 사건 재알림' : '첫 알림'}</span><strong>거리 {percent(alert.deviation)}</strong><span>최대 {percent(alert.peakDeviation)}</span></li>)}</ol></div>}
  </section>
}
