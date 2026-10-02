import { useState } from 'react'
import { ChartBar, Pause, Play, SpeakerHigh, SpeakerSlash, Stop, WarningCircle } from '@phosphor-icons/react'
import type { CameraController } from '../../../hooks/useCamera'
import { CameraStage } from '../../../components/CameraStage'
import { Ring } from '../../../components/Ring'
import { Card, Ledger, Stat } from '../../../components/ui'
import { COLLAPSE_LABEL } from '../../../data/posture'
import { postureScore } from '../../../lib/postureScore'
import { formatClock, formatDuration, formatPercent, formatRate } from '../../../lib/stats'
import { EventTable } from '../SessionEvents'
import type { ServerSessionDescriptor } from './contracts'
import { useServerSessionScreen, type ServerSessionService } from './useServerSessionScreen'
import { ConfirmDialog } from '../../dialog/ConfirmDialog'

export type ServerSessionPageProps = {
  session: ServerSessionDescriptor
  camera: CameraController
  service: ServerSessionService
  alertsOn?: boolean
  onFinish: () => void
  onDashboard: () => void
  onPrepare: () => void
  accountMode?: boolean
}

/** Server mode deliberately displays only fields actually supplied by the service contracts. */
export function ServerSessionPage(props: ServerSessionPageProps) {
  const { camera, service, session, onDashboard, onPrepare, alertsOn = true, accountMode = false } = props
  const screen = useServerSessionScreen(props)
  const [archiveConfirm, setArchiveConfirm] = useState(false)
  const { live, view } = screen
  const result = screen.phase === 'ended' || screen.archived
  const running = screen.phase === 'running'
  const score = postureScore(running && live.state !== 'unknown' ? live.collapseProb : null)
  const label = running
    ? live.state === 'unknown'
      ? '자세를 확인할 수 없어요'
      : live.state === 'collapse'
        ? live.collapse
          ? COLLAPSE_LABEL[live.collapse]
          : '기준 자세 변화'
        : '바른 자세예요'
    : screen.phase === 'creating'
      ? '서버 연결 중'
      : screen.phase === 'restoring'
        ? '서버 기록 확인 중'
        : screen.phase === 'ending'
          ? '서버 종료 확인 중'
          : screen.phase === 'lost'
            ? '서버 세션 유실'
            : '쉬는 중'
  const tone = !running || live.state === 'unknown' ? 'unknown' : live.state === 'collapse' ? 'collapse' : 'good'
  const keepRate = view?.summary.keep_rate ?? null
  const saveNote = screen.archived
    ? `서버 종료를 확인하지 못했어요. 마지막으로 확인된 요약만 ${accountMode ? '계정에' : '이 기기에'} 보관해요. ${service.saveMessage}`
    : result
      ? service.saveMessage
      : '서버 판정 · 확정, 복귀, 재알림과 통계는 서버가 보낸 사건을 그대로 보여줘요.'

  const recovery = (
    <>
      {screen.retryable && (
        <button className="btn btn-sm" onClick={screen.retry}>
          같은 서버 요청 다시 시도
        </button>
      )}
      {service.onArchive && (screen.retryable || screen.phase === 'lost') && (
        <>
          <button className="btn btn-sm" onClick={() => setArchiveConfirm(true)}>
            서버 종료 미확인 · 확인된 요약만 보관
          </button>
          {archiveConfirm && (
            <ConfirmDialog
              title="확인된 요약만 보관"
              confirmLabel="확인된 요약 보관"
              onCancel={() => setArchiveConfirm(false)}
              onConfirm={screen.archive}
            >
              <p>
                서버 종료는 확인되지 않았습니다. 마지막 확인 요약만 보관하고 이 기기의 재전송을
                중단합니다. 미확정 요청과 이후 시간은 유효 통계에 넣지 않습니다.
              </p>
            </ConfirmDialog>
          )}
        </>
      )}
    </>
  )

  const details = (
    <details className="more">
      <summary>자세히 보기 · 서버 사건과 통계</summary>
      <div className="more-body">
        <Ledger cols={4}>
          <Stat label="유효 측정 시간" value={formatDuration(live.validSeconds)} sub={`전체 ${formatDuration(live.totalSeconds)}`} small />
          <Stat label="기준 자세 유지율" value={formatPercent(keepRate)} small />
          <Stat
            label="자세 이탈"
            value={`${view?.summary.collapse_count ?? 0}건`}
            sub={`확정·재알림 ${view?.summary.alert_count ?? 0}회`}
            small
          />
          <Stat label="시간당 이탈" value={formatRate(view?.summary.events_per_hour ?? null, '회')} small />
        </Ledger>
        <Ledger cols={4}>
          <Stat
            label="발생 간격 평균"
            value={formatDuration(view?.summary.mean_interval_ms == null ? null : view.summary.mean_interval_ms / 1000)}
            small
          />
          <Stat
            label="최초 알림부터 복귀"
            value={formatDuration(view?.summary.mean_recovery_ms == null ? null : view.summary.mean_recovery_ms / 1000)}
            small
          />
          <Stat
            label="집계 제외"
            value={formatDuration(live.unknownSeconds + live.pausedSeconds)}
            sub="휴식·자리 비움·측정 불가·관측 공백"
            small
          />
          <Stat label="추론 모델" value={live.modelVersion ?? '확인 전'} small />
        </Ledger>
        <Card title="서버 확정 사건" note="확정과 재알림 횟수는 CEP 결정 수이며 실제 소리 전달 횟수와 다릅니다.">
          <EventTable events={live.events} muted={new Set()} />
        </Card>
      </div>
    </details>
  )

  if (result)
    return (
      <>
        <section className="result" aria-labelledby="server-result-title">
          <div className="result-head">
            <Ring value={keepRate} label="바른 자세 비율">
              <span className="ring-value" style={{ fontSize: 34 }}>
                {keepRate === null ? '—' : `${Math.round(keepRate * 100)}%`}
              </span>
              <span className="ring-label">바른 자세</span>
            </Ring>
            <div>
              <div className="result-eyebrow">측정 결과</div>
              <h1 className="result-title" id="server-result-title">
                {formatDuration(live.validSeconds)} 측정했어요
              </h1>
              <p className="fine result-note" style={{ marginTop: 8 }}>
                {saveNote}
              </p>
            </div>
          </div>
          <div className="result-tiles">
            <div className="result-tile">
              <span>자세 이탈</span>
              <b>{view?.summary.collapse_count ?? 0}건</b>
            </div>
            <div className="result-tile">
              <span>알림</span>
              <b>{view?.summary.alert_count ?? 0}회</b>
            </div>
            <div className="result-tile">
              <span>집계 제외</span>
              <b>{formatDuration(live.unknownSeconds + live.pausedSeconds)}</b>
            </div>
          </div>
          <div className="result-actions">
            <button className="btn btn-quiet" onClick={service.onRetry}>
              저장 다시 시도
            </button>
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

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{label}</h1>
          <p className="page-desc">{saveNote}</p>
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
        <div className={`stage ${live.alerting && running && alertsOn ? 'is-alert' : ''}`}>
          {service.active && <CameraStage camera={camera} showSkeleton={screen.showSkeleton} />}
          <div className="stage-overlay">
            <div className="stage-top">
              <span className={`pill ${tone}`} role="status">
                <span className="dot" />
                {label}
              </span>
              <span className="pill small">
                {running && <span className="rec-dot" />}
                서버 측정 · <span className="num">{formatClock(live.totalSeconds)}</span>
              </span>
            </div>
            <div className="stage-bottom">
              {running && (live.state === 'unknown' || live.alerting) && (
                <div className={`nudge ${live.state === 'unknown' || !alertsOn ? 'quiet' : ''}`}>
                  <div className="nudge-icon">
                    <WarningCircle size={24} weight="bold" />
                  </div>
                  <div className="nudge-body">
                    <div className="nudge-title">
                      {live.state === 'unknown' ? '자세를 확인할 수 없어요' : '자세를 살짝 고쳐볼까요?'}
                    </div>
                    <div className="nudge-desc">
                      {live.state === 'unknown'
                        ? '유효한 서버 입력이 없어요. 이 시간은 집계에서 빠져요.'
                        : '서버가 확정한 사건이에요. 정상 복귀가 도착하면 사라져요.'}
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
                <button
                  className="btn"
                  disabled={screen.phase === 'ending' || screen.phase === 'lost'}
                  onClick={screen.end}
                >
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
              측정한 시간<b>{formatDuration(live.validSeconds)}</b>
            </div>
            <div className="kv">
              알림<b>{view?.summary.alert_count ?? 0}회</b>
            </div>
          </section>
          <section className="card panel-fill">
            <h3 className="card-title" style={{ marginBottom: 10 }}>
              연결 상태
            </h3>
            <p className="fine" role="status">
              {screen.message || '기준 대비 변화량만 서버로 보내요. 영상·원본 좌표는 보내지 않아요.'}
            </p>
            <p className="fine" style={{ marginTop: 8 }}>
              전송 대기 {screen.queued}개 · {session.rules.holdSeconds}초 지속 시 확정 ·{' '}
              {session.rules.recoverSeconds}초 정상 복귀 · 같은 사건 {session.rules.realertSeconds}초 재알림
            </p>
            <p className="fine" style={{ marginTop: 8 }}>
              {accountMode ? '기록은 계정에 보관해요.' : '개발용 메모리 서버라 서버를 다시 켜면 세션이 사라져요.'}
            </p>
          </section>
        </div>
      </div>

      {session.server.checkpoint && screen.phase === 'paused' && (
        <label className="notice info">
          <input
            type="checkbox"
            checked={screen.positionConfirmed}
            onChange={(event) => screen.setPositionConfirmed(event.target.checked)}
          />
          카메라 장치와 위치가 측정 시작 때와 같은지 확인했습니다.
        </label>
      )}
      <div className="controls">
        {recovery}
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
