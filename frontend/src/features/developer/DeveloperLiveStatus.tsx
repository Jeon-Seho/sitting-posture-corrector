import { Bell, SpeakerHigh, SpeakerSlash } from '@phosphor-icons/react'
import type { ForecastState } from '../../../../model/prototype/forecast'
import { LAB_SETTINGS } from './session'
import type { DeveloperSession } from './types'
import './live-status.css'
import { postureEntryRatio, selectedDurationMs, selectedLabState } from './readingView'

const unavailableStates: ForecastState[] = ['needs_reference', 'registering', 'warming', 'unmeasurable']
const copy: Record<ForecastState, { title: string; detail: string; tone: string }> = {
  needs_reference: { title: '기준 자세가 필요해요', detail: '기준을 등록하면 지금 자세와의 차이를 볼 수 있어요.', tone: 'neutral' },
  registering: { title: '내 기준을 모으고 있어요', detail: '편하게 앉아 주세요. 등록이 끝나면 자동으로 측정해요.', tone: 'neutral' },
  warming: { title: '아직 판단할 수 없어요', detail: '연속 관측을 다시 모으고 있어요. 얼굴과 어깨를 보여 주세요.', tone: 'neutral' },
  near_reference: { title: '기준 범위 안이에요', detail: '등록한 자세와 가까워요. 지금처럼 편하게 앉아 주세요.', tone: 'good' },
  deviation_pending: { title: '자세가 달라졌어요', detail: '잠깐 움직인 건지, 변화가 이어지는지 확인하고 있어요.', tone: 'warning' },
  unexpected_motion_candidate: { title: '움직임을 확인하고 있어요', detail: '예측과 다른 움직임이에요. 기준으로 돌아오는지 지켜봐요.', tone: 'warning' },
  persistent_deviation_candidate: { title: '자세 변화가 이어져요', detail: '지속 이탈 후보예요. 등록한 자세를 다시 확인해 주세요.', tone: 'alert' },
  recovery_pending: { title: '기준으로 돌아오고 있어요', detail: `잠시 유지해 주세요. ${LAB_SETTINGS.recovery_ms / 1000}초 동안 확인하면 복귀가 완료돼요.`, tone: 'neutral' },
  unmeasurable: { title: '지금은 측정이 어려워요', detail: '얼굴과 양쪽 어깨가 화면에 보이는지 확인해 주세요.', tone: 'neutral' },
}
const finiteNonnegative = (value: number | null | undefined) => value != null && Number.isFinite(value) && value >= 0 ? value : null

/** A compact view of the session's chosen result; this component never classifies posture. */
export default function DeveloperLiveStatus({ session }: { session: DeveloperSession }) {
  const reading = session.reading
  const state = reading ? selectedLabState(reading, session.alertBasis) : undefined
  const unavailable = state == null || unavailableStates.includes(state)
  const ended = session.phase === 'finished' || session.phase === 'error'
  const message = state ? copy[state] : {
    title: session.phase === 'error' ? '측정을 시작하지 못했어요' : ended ? '측정한 결과가 없어요' : '시작하면 여기에 보여요',
    detail: session.phase === 'error' ? session.error || '카메라 연결 상태를 확인해 주세요.' : ended ? '다시 시작해 기준 자세를 등록해 주세요.' : '기준을 등록한 뒤 자세가 얼마나 달라졌는지 보여드려요.',
    tone: 'neutral',
  }
  const deviation = unavailable ? null : finiteNonnegative(reading?.deviation)
  const duration = unavailable || !reading ? null : finiteNonnegative(selectedDurationMs(reading, session.alertBasis))
  const normal = reading?.normalProfileId != null
  const combined = reading?.imagePosture != null
  const ratioBased = normal || combined
  const score = unavailable ? null : finiteNonnegative(combined ? reading?.postureScore : reading?.normalScore)
  const value = ratioBased ? score : deviation
  const threshold = combined ? postureEntryRatio(reading) : ratioBased ? 1 : LAB_SETTINGS.deviation
  const maximum = Math.max(threshold * 2, Math.ceil((value ?? 0) / threshold) * threshold)
  const basis = session.alertBasis === 'rule' ? combined ? '상대 자세·몸 전체 변화 + 지속시간' : normal ? '개인 정상 범위 + 지속시간' : '거리 + 지속시간' : session.predictor === 'lstm' ? 'LSTM + 거리·시간' : '예측 비교군 + 거리·시간'
  const percent = value == null ? '—' : (value * (ratioBased ? 1 : 100)).toFixed(1)
  const unit = ratioBased ? '배' : '%'
  const boundary = combined ? `종합 이탈 경계 ${threshold.toFixed(1)}배` : normal ? '정상 범위 경계 1.0배' : `거리 기준 ${LAB_SETTINGS.deviation * 100}%`

  return <section className={`dev-live-status dls-tone-${message.tone}`} aria-label="현재 자세 요약">
    <div className="dls-heading"><span>{ended ? '마지막 측정 결과' : '지금 내 자세'}</span>{session.source === 'synthetic' && <span className="dls-demo">합성 데모</span>}</div>
    <div className="dls-message" role="status" aria-live="polite" aria-atomic="true">
      <h2><i aria-hidden="true" />{message.title}</h2>
      <p>{ended && state ? '실험 종료 시점의 결과입니다. 현재 자세는 측정하지 않아요.' : message.detail}</p>
    </div>
    <div className="dls-values">
      <div className="dls-distance"><span>{combined ? reading?.postureEntryRatio !== undefined ? '종합 이탈 점수' : '종합 이탈 기준 대비' : normal ? '정상 범위 경계 대비' : '기준과의 차이'}</span><strong>{percent}{value != null && <small>{unit}</small>}</strong></div>
      <div className="dls-duration"><span>연속 이탈 시간</span><strong>{duration == null ? '—' : `${(duration / 1000).toFixed(1)}`}<small>{duration == null ? '' : '초'}</small></strong></div>
    </div>
    <div className="dls-meter" role="img" aria-label={`${value == null ? '측정값 없음' : `${ended ? '마지막' : '현재'} 기준 차이 ${percent}${unit}`}. ${boundary}. 이 거리가 이어지는 시간을 함께 봅니다.`}>
      <div className="dls-meter-track"><span style={{ width: `${value == null ? 0 : Math.min(100, value / maximum * 100)}%` }} /><i style={{ left: `${threshold / maximum * 100}%` }} /><b style={{ left: `clamp(44px, ${threshold / maximum * 100}%, calc(100% - 44px))` }}>{boundary}</b></div>
      <div className="dls-meter-scale"><span>0{unit}</span><span>{ratioBased ? maximum.toFixed(1) : Math.round(maximum * 100)}{unit}</span></div>
    </div>
    <p className="dls-explanation">{combined ? <>상대적인 모양과 몸 전체 위치·크기를 함께 비교해요.<br />{session.alertBasis === 'rule' ? `${threshold}배 초과가 3초 이어지면 시각 알림을 보냅니다.` : `${threshold}배 초과 3초와 예측 오차 조건을 함께 확인하며, 이탈이 5초 이어지면 알립니다.`}</> : normal ? <>확인한 목표 자세의 흔들림 범위와 비교해요.<br />1배 이상이 이어지면 알림을 보냅니다. 정상 확률은 아니에요.</> : <>어깨 너비를 100%로 본 변화 거리예요.<br />건강 점수가 아니며, 지속시간과 함께 판단해요.</>}</p>
    {combined && !unavailable && <p className="dls-auxiliary">상대 모양 {normal ? reading?.normalScore?.toFixed(2) ?? '—' : deviation == null ? '—' : (deviation / LAB_SETTINGS.deviation).toFixed(2)}배 · 몸 전체 변화 {reading?.imagePosture?.score?.toFixed(2) ?? '—'}배</p>}
    {reading?.imagePosture?.status === 'needs_reference' && <p className="dls-auxiliary">영상 비율이 바뀌었습니다. 새 측정으로 기준을 다시 등록해 주세요.</p>}
    {normal && deviation != null && <p className="dls-auxiliary">어깨폭 대비 거리 {(deviation * 100).toFixed(1)}% · 별도 참고값</p>}
    {!ended && reading?.evaluationMode === 'observed-v2' && reading.error == null && !unavailable && <p className="dls-auxiliary">예측 보조 준비 중 · 자세 비교와 알림은 계속됩니다.</p>}
    <div className="dls-footer"><span><Bell size={15} aria-hidden="true" />알림 <strong>{session.alertCount}회</strong></span><button type="button" aria-pressed={session.soundEnabled} aria-label={session.soundEnabled ? '알림 소리 끄기' : '알림 소리 켜기'} onClick={() => session.setSoundEnabled(!session.soundEnabled)}>{session.soundEnabled ? <SpeakerHigh size={16} /> : <SpeakerSlash size={16} />}{session.soundEnabled ? '소리 켜짐' : '소리 꺼짐'}</button></div>
    <div className="dls-basis"><span>판단 기준</span><strong>{basis}</strong>{session.soundEnabled && (session.audioStatus === 'blocked' || session.audioStatus === 'unsupported') && <small>{session.audioStatus === 'blocked' ? '소리 차단됨' : '소리 미지원'}</small>}</div>
  </section>
}
