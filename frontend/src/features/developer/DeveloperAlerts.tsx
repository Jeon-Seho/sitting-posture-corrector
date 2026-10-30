import { Bell, BellRinging, Info, SpeakerHigh, SpeakerSlash, Waveform } from '@phosphor-icons/react'
import type { ForecastState } from '../../../../model/prototype/forecast'
import { ALERT_SETTINGS } from './alerts'
import { LAB_SETTINGS } from './session'
import type { DeveloperSession } from './types'
import './alerts.css'
import { postureEntryRatio, postureRecoveryRatio, selectedDurationMs, selectedLabState } from './readingView'

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
  const selectedState = r ? selectedLabState(r, session.alertBasis) : undefined
  const normal = r?.normalProfileId != null
  const combined = r?.imagePosture != null
  const ended = session.phase === 'finished' || session.phase === 'error'
  const deviation = r?.deviation ?? null
  const gaugeMax = Math.max(LAB_SETTINGS.deviation * 2, Math.ceil(Math.max(deviation ?? 0, session.alertPeakDeviation ?? 0) * 10) / 10)
  const ratio = combined ? r?.postureScore ?? null : normal ? r?.normalScore ?? null : deviation == null ? null : deviation / LAB_SETTINGS.deviation
  const last = session.alerts.at(-1)
  const predictionLabel = session.predictor === 'lstm' ? '학습 모델 + 거리·시간' : '예측 비교군 + 거리·시간'
  return <section className="dev-alerts" aria-label="이탈 알림과 판정 기준">
    <div className="da-heading"><div><h2><Bell size={19} />알림 설정과 기록</h2><p>{ended ? r ? '종료된 실험의 마지막 관측입니다.' : '종료된 실험에 관측한 수치가 없습니다.' : '알림 방식과 소리를 설정하고, 발생한 알림을 확인하세요.'}</p></div><span className={`da-current-state da-tone-${stateTone(selectedState)}`}><i />{selectedState ? labels[selectedState] : '측정 대기'}</span></div>
    <div className="da-controls"><label htmlFor="developer-alert-basis">알림 방식<select id="developer-alert-basis" value={session.alertBasis} disabled={active} onChange={event => session.setAlertBasis(event.target.value as 'predictor' | 'rule')}><option value="predictor">{predictionLabel}</option><option value="rule">{combined ? '상대 자세·몸 전체 변화 + 지속시간' : normal ? '개인 정상 범위 + 지속시간' : '기준 이탈 + 지속시간 (기본)'}</option></select></label><div className="da-audio-controls"><button className={`da-sound-toggle ${session.soundEnabled ? 'da-sound-on' : ''}`} type="button" aria-pressed={session.soundEnabled} onClick={() => session.setSoundEnabled(!session.soundEnabled)}>{session.soundEnabled ? <SpeakerHigh size={17} /> : <SpeakerSlash size={17} />}{session.soundEnabled ? '알림 소리 켜짐' : '알림 소리 꺼짐'}</button><button className="da-test-sound" type="button" disabled={!session.soundEnabled || session.audioStatus === 'unsupported'} onClick={session.testAlertSound}>소리 테스트</button></div></div>
    <div className="da-control-notes"><span>{active ? '알림 방식은 다음 측정부터 바꿀 수 있어요. 소리는 언제든 끌 수 있어요.' : '기본 판단은 기준 이탈 + 지속시간입니다. 예측은 선택 가능한 비교 실험입니다.'}</span><span className={session.audioStatus === 'blocked' ? 'da-audio-blocked' : ''}>{session.soundEnabled ? audioLabels[session.audioStatus] : '소리가 꺼져 있습니다. 소리를 켜면 테스트할 수 있습니다.'}</span></div>
    {last && <div className={`da-alert-notice ${last.source === 'synthetic' ? 'da-alert-synthetic' : ''}`} role="alert" aria-atomic="true" key={last.id}><span className="da-alert-icon"><BellRinging size={22} /></span><div><strong>{last.source === 'synthetic' ? '합성 데모 알림 · ' : ''}{last.kind === 'reminder' ? '지속 이탈 후보가 이어지고 있습니다' : '지속 이탈 후보를 관찰했습니다'}</strong><p>{last.postureScore != null ? <>종합 이탈 {last.postureScore.toFixed(2)}배 · 몸 전체 변화 {last.imagePosture?.score?.toFixed(2) ?? '—'}배 · </> : last.normalScore != null && <>정상 범위 경계의 {last.normalScore.toFixed(2)}배 · </>}알림 시점 거리 {percent(last.deviation)} · 최대 {percent(last.peakDeviation)} · 연속 {(last.durationMs / 1000).toFixed(1)}초 · {last.basis === 'predictor' ? '예측 + 거리·시간' : last.imagePosture ? '상대 자세·몸 전체 변화 + 지속시간' : last.normalProfileId ? '개인 정상 범위 + 지속시간' : '거리·시간만'}</p></div><time>{elapsed(last.timeMs)}</time></div>}
    {session.alerts.length > 1 && <div className="da-recent-alerts"><h3>최근 알림</h3><ol>{session.alerts.slice(-3).reverse().map(alert => <li key={alert.id}><time>{elapsed(alert.timeMs)}</time><span>{alert.source === 'synthetic' ? '합성 · ' : ''}{alert.kind === 'reminder' ? '같은 사건 재알림' : '첫 알림'}</span><strong>{alert.postureScore != null ? `종합 ${alert.postureScore.toFixed(2)}배` : `거리 ${percent(alert.deviation)}`}</strong><span>{alert.peakPostureScore != null ? `최대 ${alert.peakPostureScore.toFixed(2)}배` : `최대 거리 ${percent(alert.peakDeviation)}`}</span></li>)}</ol></div>}
    {!last && <p className="da-empty-history">아직 발생한 알림이 없습니다.</p>}
    <details className="da-criteria da-measurement-details"><summary><span><Waveform size={17} />측정 수치 자세히</span><span>기준과의 차이 · 예측 오차</span></summary>
    <div className="da-live-panel">
      <div className="da-distance"><div className="da-distance-label">{ended ? '마지막 관측 거리' : '기준 자세와의 차이'}{session.source === 'synthetic' && <span className="da-synthetic">합성 데모</span>}</div><div className="da-distance-value"><strong>{deviation == null ? '—' : (deviation * 100).toFixed(1)}</strong>{deviation != null && <span>%</span>}<small>어깨 너비 대비</small></div>
        {!normal && r?.postureEntryRatio === undefined && <><div className="da-meter" role="img" aria-label={deviation == null ? '아직 측정 거리가 없습니다. 거리 진입 기준 12%, 복귀 시작 기준 8%.' : `현재 상대 모양 거리 ${percent(deviation)}, 거리 기준의 ${(deviation / LAB_SETTINGS.deviation).toFixed(2)}배. 거리 진입 기준 12%, 복귀 시작 기준 8%.`}>
          <div className="da-meter-track"><span className={`da-meter-value da-tone-${stateTone(selectedState)}`} style={{ width: `${deviation == null ? 0 : Math.min(100, deviation / gaugeMax * 100)}%` }} /><i className="da-meter-recovery" style={{ left: `${LAB_SETTINGS.recovery / gaugeMax * 100}%` }} /><i className="da-meter-entry" style={{ left: `${LAB_SETTINGS.deviation / gaugeMax * 100}%` }} /></div><div className="da-meter-scale"><span>0%</span><span>{Math.round(gaugeMax * 100)}%</span></div>
        </div>
        <div className="da-threshold-key"><span><i />복귀 시작 {LAB_SETTINGS.recovery * 100}%</span><span><i />이탈 진입 {LAB_SETTINGS.deviation * 100}%</span></div></>}<p className="da-distance-explanation">어깨 너비로 정규화한 3D 얼굴·귀·어깨 변화량의 평균입니다. 자세가 나쁜 정도를 뜻하지 않습니다.</p>
      </div>
      <div className="da-metrics"><div><span>이탈 기준의 몇 배인가요</span><strong>{ratio == null ? '—' : `${ratio.toFixed(2)}배`}</strong><small>{combined ? `상대 모양과 몸 전체 변화 중 큰 값 · 이탈 ${postureEntryRatio(r)}배 초과` : normal ? '확인한 정상 변동 범위의 경계 = 1배' : `거리 ÷ ${LAB_SETTINGS.deviation * 100}%`}</small></div><div><span>연속 이탈 시간</span><strong>{deviation == null ? '—' : `${(selectedDurationMs(r!, session.alertBasis) / 1000).toFixed(1)}초`}</strong><small>측정 누락 시 연속성 중단</small></div><div><span>{combined ? '상대 모양의 최대 거리' : '가장 크게 벗어난 정도'}</span><strong>{percent(session.alertPeakDeviation)}</strong><small>복귀·측정 불가 시 초기화</small></div><div><span>예측과 실제의 차이 / 오차 한계</span><strong className="da-error-values">{percent(r?.error)}<em>/</em>{percent(r?.errorLimit)}</strong><small>{LAB_SETTINGS.horizon_ms / 1000}초 뒤 예측과 관측의 차이</small></div><div className="da-alert-count"><span>발생한 알림</span><strong>{session.alertCount}<b>회</b></strong><small>첫 알림과 재알림 포함</small></div></div>
    </div>
    </details>
    <details className="da-criteria"><summary><span><Waveform size={17} />알림이 울리는 기준</span><span>거리와 지속 시간 · 세부 조건</span></summary><div className="da-criteria-body"><dl className="da-policy-list"><div><dt>{combined ? '종합 이탈 조건' : normal ? '개인 정상 범위 조건' : '거리 조건'}</dt><dd>{combined ? <>상대 자세와 등록 당시 몸 위치·크기 변화 중 큰 점수가 <strong>{postureEntryRatio(r)}배 초과</strong>면 이탈, <strong>{postureRecoveryRatio(r).toFixed(2)}배 이하</strong>면 복귀 확인</> : normal ? <>학습한 허용 변동 경계의 <strong>1배 이상</strong>에서 이탈, <strong>0.67배 이하</strong>에서 복귀 확인</> : <><strong>{LAB_SETTINGS.deviation * 100}% 이상</strong>에서 이탈 시작, <strong>{LAB_SETTINGS.recovery * 100}% 이하</strong>에서 복귀 확인 시작</>}</dd></div><div><dt>거리·시간 규칙</dt><dd>이탈이 <strong>{LAB_SETTINGS.sustained_ms / 1000}초</strong> 이어지면 지속 이탈 후보</dd></div><div><dt>예측 오차 한계</dt><dd><strong>8초·65표본 등록</strong> 중 대응 오차가 20개 이상이면 <strong>99백분위</strong>, 부족하면 <strong>최소 기준 2%</strong>를 사용합니다.</dd></div><div><dt>예측 + 거리·시간</dt><dd>이탈 <strong>{LAB_SETTINGS.sustained_ms / 1000}초</strong> + 최근 <strong>1초</strong> 동안 예측 오차가 적용 한계 이하</dd></div><div><dt>예측 경로의 보완 조건</dt><dd>이탈이 <strong>{LAB_SETTINGS.fallback_ms / 1000}초</strong> 이어지면 예측 오차가 커도 지속 이탈 후보</dd></div><div><dt>복귀 확인</dt><dd>기준 범위 안에서 <strong>{LAB_SETTINGS.recovery_ms / 1000}초</strong> 유지하면 사건 종료</dd></div><div><dt>동일 사건의 재알림</dt><dd>같은 이탈이 이어지면 <strong>{ALERT_SETTINGS.reminder_ms / 1000}초</strong> 간격으로 재알림</dd></div></dl><div className="da-stretch-note"><Info size={17} /><div><strong>스트레칭과 자세 붕괴의 의도를 구분하지 않습니다.</strong><p>예측 오차가 크다는 이유만으로 일시 동작이나 스트레칭으로 확정하지 않습니다. 기준으로 돌아오는지 확인하며, 오래 유지한 스트레칭도 지속 이탈 후보가 될 수 있습니다.</p></div></div><p className="da-quality-note">가림·낮은 관측 품질·시간 누락은 측정 불가입니다. 유지·이탈 누적과 정상 복귀로 취급하지 않습니다.</p></div></details>

  </section>
}
