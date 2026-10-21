import { ChartBar, Pause, Play, SpeakerHigh, SpeakerSlash, Stop, WarningCircle } from '@phosphor-icons/react'
import type { CameraController } from '../../../hooks/useCamera'
import { CameraStage } from '../../../components/CameraStage'
import { Ring } from '../../../components/Ring'
import { Card, Ledger, Stat } from '../../../components/ui'
import { postureScore } from '../../../lib/postureScore'
import { formatClock, formatDuration, formatPercent, formatRate } from '../../../lib/stats'
import { EventTable } from '../SessionEvents'
import { collapseEvents } from './events'
import type { LiveState } from './LiveSession'
import type { SocketLike } from './LiveSession'
import { INPUT_PAUSED_NOTICE, useLiveSession, type LiveSessionDescriptor, type LiveSessionService } from './useLiveSession'

export type LiveSessionPageProps = {
  session: LiveSessionDescriptor
  camera: CameraController
  service: LiveSessionService
  alertsOn?: boolean
  onDashboard: () => void
  onPrepare: () => void
  openSocket?: (url: string) => SocketLike
}

function headline(state: LiveState | null, phase: string) {
  if (!state || phase === 'creating' || phase === 'connecting') return '서버에 연결하고 있어요'
  if (phase === 'ending') return '측정을 마무리하고 있어요'
  if (phase === 'failed') return '측정을 시작하지 못했어요'
  if (phase === 'paused') return state.sending === 'away' ? '카메라 영상을 기다리고 있어요' : '쉬는 중'
  if (!state.observation?.valid) return '자세를 확인할 수 없어요'
  return state.alerting ? '자세가 흐트러졌어요' : '바른 자세예요'
}

/**
 * The measurement screen. Every number and state here is what the server sent (ADR 0021,
 * 2026-10-21): the score is 100 × (1 − collapse_probability), the alert is the server's
 * confirmed collapse, the statistics are its summary.
 */
export function LiveSessionPage(props: LiveSessionPageProps) {
  const { camera, service, session, onDashboard, onPrepare, alertsOn = true } = props
  const screen = useLiveSession(props)
  const { state, phase } = screen
  const summary = state?.summary
  const running = phase === 'running'
  const measurable = running && !!state?.observation?.valid
  const score = postureScore(measurable ? state!.observation!.collapse_probability : null)
  const label = headline(state, phase)
  const tone = !measurable ? 'unknown' : state!.alerting ? 'collapse' : 'good'
  const keepRate = summary?.keep_rate ?? null
  const totalSeconds = (summary?.total_ms ?? 0) / 1000
  const validSeconds = (summary?.valid_ms ?? 0) / 1000
  const excludedSeconds = ((summary?.rest_ms ?? 0) + (summary?.away_ms ?? 0) + (summary?.unknown_ms ?? 0) + (summary?.missing_ms ?? 0)) / 1000
  const events = collapseEvents(state?.events ?? [])

  const details = (
    <details className="more">
      <summary>자세히 보기 · 서버 사건과 통계</summary>
      <div className="more-body">
        <Ledger cols={4}>
          <Stat label="유효 측정 시간" value={formatDuration(validSeconds)} sub={`전체 ${formatDuration(totalSeconds)}`} small />
          <Stat label="기준 자세 유지율" value={formatPercent(keepRate)} small />
          <Stat
            label="자세 이탈"
            value={`${summary?.collapse_count ?? 0}건`}
            sub={`확정·재알림 ${summary?.alert_count ?? 0}회`}
            small
          />
          <Stat label="시간당 이탈" value={formatRate(summary?.events_per_hour ?? null, '회')} small />
        </Ledger>
        <Ledger cols={4}>
          <Stat
            label="발생 간격 평균"
            value={formatDuration(summary?.mean_interval_ms == null ? null : summary.mean_interval_ms / 1000)}
            small
          />
          <Stat
            label="최초 알림부터 복귀"
            value={formatDuration(summary?.mean_recovery_ms == null ? null : summary.mean_recovery_ms / 1000)}
            small
          />
          <Stat label="집계 제외" value={formatDuration(excludedSeconds)} sub="휴식·자리 비움·측정 불가·관측 공백" small />
          <Stat label="추론 모델" value={state?.observation?.model_version ?? '확인 전'} small />
        </Ledger>
        <Card title="서버 확정 사건" note="확정과 재알림 횟수는 서버 판정 수이며 실제 소리 전달 횟수와 다릅니다.">
          <EventTable events={events} muted={new Set()} />
        </Card>
      </div>
    </details>
  )

  if (phase === 'failed')
    return (
      <section className="result" aria-labelledby="live-failed-title">
        <div>
          <div className="result-eyebrow">측정</div>
          <h1 className="result-title" id="live-failed-title">
            {label}
          </h1>
          <p className="fine result-note" style={{ marginTop: 8 }} role="status">
            {state?.message}
          </p>
        </div>
        <div className="result-actions">
          <button className="btn btn-primary" onClick={onPrepare}>
            다시 준비하기
          </button>
        </div>
      </section>
    )

  if (phase === 'ended')
    return (
      <>
        <section className="result" aria-labelledby="live-result-title">
          <div className="result-head">
            <Ring value={keepRate} label="바른 자세 비율">
              <span className="ring-value" style={{ fontSize: 34 }}>
                {keepRate === null ? '—' : `${Math.round(keepRate * 100)}%`}
              </span>
              <span className="ring-label">바른 자세</span>
            </Ring>
            <div>
              <div className="result-eyebrow">측정 결과</div>
              <h1 className="result-title" id="live-result-title">
                {formatDuration(validSeconds)} 측정했어요
              </h1>
              <p className="fine result-note" style={{ marginTop: 8 }}>
                {screen.note || state?.message || '서버에 저장했어요.'}
              </p>
            </div>
          </div>
          <div className="result-tiles">
            <div className="result-tile">
              <span>자세 이탈</span>
              <b>{summary?.collapse_count ?? 0}건</b>
            </div>
            <div className="result-tile">
              <span>알림</span>
              <b>{summary?.alert_count ?? 0}회</b>
            </div>
            <div className="result-tile">
              <span>집계 제외</span>
              <b>{formatDuration(excludedSeconds)}</b>
            </div>
          </div>
          <div className="result-actions">
            <button className="btn" onClick={onDashboard}>
              <ChartBar size={18} weight="bold" className="icon" />
              기록 보기
            </button>
            <button className="btn btn-primary" onClick={onPrepare}>
              다시 측정
            </button>
          </div>
        </section>
        {details}
      </>
    )

  const waitingInput = phase === 'paused' && state?.sending === 'away'
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{label}</h1>
          <p className="page-desc">
            {waitingInput ? INPUT_PAUSED_NOTICE : '자세는 서버가 판정해요. 영상은 보내지 않고 관절 좌표만 보내요.'}
          </p>
        </div>
        <div className="page-actions">
          <button
            className="chip"
            aria-pressed={screen.showSkeleton}
            onClick={() => screen.setShowSkeleton(!screen.showSkeleton)}
          >
            관절 표시
          </button>
        </div>
      </div>

      <div className="measure">
        <div className={`stage ${state?.alerting && running && alertsOn ? 'is-alert' : ''}`}>
          {service.active && <CameraStage camera={camera} showSkeleton={screen.showSkeleton} />}
          <div className="stage-overlay">
            <div className="stage-top">
              <span className={`pill ${tone}`} role="status">
                <span className="dot" />
                {label}
              </span>
              <span className="pill small">
                {running && <span className="rec-dot" />}
                측정 · <span className="num">{formatClock(totalSeconds)}</span>
              </span>
            </div>
            <div className="stage-bottom">
              {running && (!measurable || state?.alerting) && (
                <div className={`nudge ${!measurable || !alertsOn ? 'quiet' : ''}`}>
                  <div className="nudge-icon">
                    <WarningCircle size={24} weight="bold" />
                  </div>
                  <div className="nudge-body">
                    <div className="nudge-title">{!measurable ? '자세를 확인할 수 없어요' : '자세를 살짝 고쳐볼까요?'}</div>
                    <div className="nudge-desc">
                      {!measurable
                        ? state?.observation?.invalid_reason === 'head_turn'
                          ? '고개를 돌린 동안은 판정하지 않아요. 이 시간은 집계에서 빠져요.'
                          : '얼굴과 어깨가 보이지 않아요. 이 시간은 집계에서 빠져요.'
                        : '바른 자세로 돌아오면 사라져요.'}
                    </div>
                  </div>
                </div>
              )}
              <div className="dock">
                {running ? (
                  <button className="btn dock-main" onClick={screen.pause}>
                    <Pause size={18} weight="fill" className="icon" />
                    잠시 쉬기
                  </button>
                ) : (
                  <button className="btn dock-main" disabled={!screen.canResume} onClick={screen.resume}>
                    <Play size={18} weight="fill" className="icon" />
                    측정 재개
                  </button>
                )}
                <button className="btn" disabled={phase === 'ending'} onClick={screen.end}>
                  <Stop size={18} weight="fill" className="icon" />
                  측정 종료
                </button>
                <button
                  className="btn btn-icon"
                  aria-pressed={screen.soundOn}
                  aria-label={screen.soundOn ? '알림 소리 끄기' : '알림 소리 켜기'}
                  onClick={screen.toggleSound}
                >
                  {screen.soundOn ? <SpeakerHigh size={20} weight="bold" /> : <SpeakerSlash size={20} weight="bold" />}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="measure-panel">
          <section className="card score-card" aria-label="자세 점수">
            <Ring value={score === null ? null : score / 100}>
              <span className="ring-value" style={{ fontSize: 40 }}>
                {score === null ? '—' : Math.round(score)}
              </span>
              <span className="ring-label">자세 점수</span>
            </Ring>
            <div>
              <div className="score-title">서버 판정</div>
              <p className="score-desc">개인 기준 변화 규칙이에요. 의학적 점수나 정확도가 아니에요.</p>
            </div>
          </section>
          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 14 }}>
              이번 측정
            </h3>
            <div className="kv">
              바른 자세 유지<b>{formatPercent(keepRate, 0)}</b>
            </div>
            <div className="kv">
              측정한 시간<b>{formatDuration(validSeconds)}</b>
            </div>
            <div className="kv">
              알림<b>{summary?.alert_count ?? 0}회</b>
            </div>
          </section>
          <section className="card panel-fill">
            <h3 className="card-title" style={{ marginBottom: 10 }}>
              연결 상태
            </h3>
            <p className="fine" role="status">
              {state?.stalled
                ? '분석이 잠시 멈췄어요. 측정은 계속돼요.'
                : '0.5초마다 관절 좌표를 서버로 보내요. 영상은 보내지 않아요.'}
            </p>
            <p className="fine" style={{ marginTop: 8 }}>
              {session.rules.holdSeconds}초 지속 시 확정 · {session.rules.recoverSeconds}초 정상 복귀 · 같은 사건{' '}
              {session.rules.realertSeconds}초 재알림
            </p>
          </section>
        </div>
      </div>

      <div className="controls">
        <button className="btn btn-sm" onClick={onPrepare}>
          카메라 준비 다시 확인
        </button>
      </div>
      {screen.soundError && <p role="status" className="notice">{screen.soundError}</p>}
      {details}

      {screen.toast && running && alertsOn && (
        <div className="toast" role="status">
          <WarningCircle size={22} weight="fill" className="icon" />
          <div>
            <div className="alert-title">자세를 확인해 주세요</div>
            <div className="alert-desc">{screen.toast}</div>
          </div>
        </div>
      )}
    </>
  )
}
