import { useState } from 'react'
import type { CameraController } from '../../../hooks/useCamera'
import { CameraStage } from '../../../components/CameraStage'
import { VisualControls } from '../../../components/VisualControls'
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
  const {
    camera,
    service,
    session,
    onFinish,
    onDashboard,
    onPrepare,
    alertsOn = true,
    accountMode = false,
  } = props
  const screen = useServerSessionScreen(props)
  const [archiveConfirm, setArchiveConfirm] = useState(false)
  const { live, view } = screen
  const result = screen.phase === 'ended' || screen.archived
  const score = postureScore(
    screen.phase === 'running' && live.state !== 'unknown' ? live.collapseProb : null,
  )
  const label =
    screen.phase === 'running'
      ? live.state === 'unknown'
        ? '판정 불가'
        : live.state === 'collapse'
          ? live.collapse
            ? COLLAPSE_LABEL[live.collapse]
            : '기준 자세 변화'
          : '바른 자세'
      : screen.phase === 'creating'
        ? '서버 연결 중'
        : screen.phase === 'restoring'
          ? '서버 기록 확인 중'
          : screen.phase === 'ending'
            ? '서버 종료 확인 중'
            : screen.phase === 'lost'
              ? '서버 세션 유실'
              : '휴식 중'
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{result ? '측정 결과' : '실시간 측정'}</h1>
          <p className="page-desc">
            {screen.archived
              ? `서버 종료를 확인하지 못했습니다. 마지막 확인 요약만 ${accountMode ? '계정에' : '이 브라우저에'} 보관합니다. ${service.saveMessage}`
              : result
                ? service.saveMessage
                : '서버 연결 · 확정, 복귀, 재알림과 통계는 서버 사건을 표시합니다.'}
          </p>
        </div>
      </div>
      {!result && (
        <>
          <div className="session-grid">
            <div className="stack">
              <div className="stage">
                {service.active && (
                  <CameraStage camera={camera} showSkeleton={screen.showSkeleton} />
                )}
                <div className="stage-overlay">
                  <div className="stage-top">
                    <span className="stage-tag">
                      서버 측정 · <span className="num">{formatClock(live.totalSeconds)}</span>
                    </span>
                  </div>
                  <div className="stage-bottom">
                    <div
                      className={`alert-banner ${live.alerting && screen.phase === 'running' && alertsOn ? '' : 'notice'}`}
                    >
                      <div>
                        <div className="alert-title">{label}</div>
                        <div className="alert-desc">
                          {screen.phase === 'running' && live.state === 'unknown'
                            ? '유효한 서버 입력이 없습니다. 관측 공백·측정 불가 시간은 유효 집계에서 제외합니다.'
                            : live.alerting
                              ? '서버에서 확정한 사건입니다. 정상 복귀 또는 중단 사건이 도착하면 갱신합니다.'
                              : '진행률은 서버 계약에서 제공하지 않아 표시하지 않습니다.'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <p role="status">
                {screen.message ||
                  '기준 대비 변화량만 서버로 전송합니다. 영상·원본 좌표는 전송하지 않습니다.'}
              </p>
              <p className="card-note">
                전송 대기 {screen.queued}개 · 관측된 인접 프레임 구간을 끝 프레임 특징으로 근사하는
                실험용 측정입니다.
              </p>
              {session.server.checkpoint && screen.phase === 'paused' && (
                <label>
                  <input
                    type="checkbox"
                    checked={screen.positionConfirmed}
                    onChange={(event) => screen.setPositionConfirmed(event.target.checked)}
                  />{' '}
                  카메라 장치와 위치가 측정 시작 때와 같은지 확인했습니다.
                </label>
              )}
              <div className="controls">
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <button className="btn" onClick={screen.toggleSound}>
                    {screen.soundOn ? '소리 켜짐 · 음소거' : '소리 꺼짐 · 켜기'}
                  </button>
                  {screen.phase === 'running' ? (
                    <button className="btn" onClick={screen.pause}>
                      일시정지
                    </button>
                  ) : (
                    <button className="btn" disabled={!screen.canResume} onClick={screen.resume}>
                      측정 재개
                    </button>
                  )}
                  <button
                    className="btn btn-danger"
                    disabled={screen.phase === 'ending' || screen.phase === 'lost'}
                    onClick={screen.end}
                  >
                    측정 종료
                  </button>
                  <button className="btn" onClick={onFinish}>
                    홈으로
                  </button>
                  <button className="btn" onClick={onPrepare}>
                    카메라 준비 다시 확인
                  </button>
                </div>
              </div>
              {screen.retryable && (
                <button className="btn" onClick={screen.retry}>
                  같은 서버 요청 다시 시도
                </button>
              )}
              {service.onArchive && (screen.retryable || screen.phase === 'lost') && (
                <>
                  <button className="btn" onClick={() => setArchiveConfirm(true)}>
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
                        서버 종료는 확인되지 않았습니다. 마지막 확인 요약만 보관하고 이 브라우저의
                        재전송을 중단합니다. 미확정 요청과 이후 시간은 유효 통계에 넣지 않습니다.
                      </p>
                    </ConfirmDialog>
                  )}
                </>
              )}
              {screen.soundError && <p role="status">{screen.soundError}</p>}
              <button
                className="chip"
                aria-pressed={screen.showSkeleton}
                onClick={() => screen.setShowSkeleton(!screen.showSkeleton)}
              >
                키포인트 표시
              </button>
              <VisualControls camera={camera} />
            </div>
            <Card title="현재 서버 판정">
              <div className="verdict">
                <span className={`verdict-word ${live.state}`}>{label}</span>
              </div>
              <Stat
                label="자세 점수"
                value={score === null ? '—' : `${score.toFixed(1)}점`}
                sub="개인 기준 변화 규칙 · 의학적 점수나 정확도가 아닙니다"
              />
              <p className="card-note">
                {session.rules.holdSeconds}초 지속 시 확정 · {session.rules.recoverSeconds}초 정상
                복귀 · 같은 사건 {session.rules.realertSeconds}초 재알림. 프론트에서 시간 판정을
                추가하지 않습니다.
              </p>
              <p className="card-note">
                {accountMode
                  ? '기록은 계정에 보관합니다.'
                  : '개발용 메모리 서버입니다. 서버 재시작 시 세션이 사라집니다.'}{' '}
                관측은 최대 10,000개이며 한도 전 측정을 종료하도록 안내합니다.
              </p>
            </Card>
          </div>
        </>
      )}
      <div className="gap-top">
        <Ledger cols={4}>
          <Stat
            label="유효 측정 시간"
            value={formatDuration(live.validSeconds)}
            sub={`전체 ${formatDuration(live.totalSeconds)}`}
          />
          <Stat label="기준 자세 유지율" value={formatPercent(view?.summary.keep_rate ?? null)} />
          <Stat
            label="붕괴 이벤트"
            value={`${view?.summary.collapse_count ?? 0}건`}
            sub={`확정·재알림 ${view?.summary.alert_count ?? 0}회`}
          />
          <Stat
            label="시간당 붕괴 횟수"
            value={formatRate(view?.summary.events_per_hour ?? null, '회')}
          />
        </Ledger>
      </div>
      <div className="gap-top">
        <Ledger cols={4}>
          <Stat
            label="발생 간격 평균"
            value={formatDuration(
              view?.summary.mean_interval_ms == null ? null : view.summary.mean_interval_ms / 1000,
            )}
          />
          <Stat
            label="최초 알림부터 복귀"
            value={formatDuration(
              view?.summary.mean_recovery_ms == null ? null : view.summary.mean_recovery_ms / 1000,
            )}
          />
          <Stat
            label="집계 제외"
            value={formatDuration(live.unknownSeconds + live.pausedSeconds)}
            sub="휴식·자리 비움·측정 불가·관측 공백"
          />
          <Stat label="추론 모델" value={live.modelVersion ?? '확인 전'} small />
        </Ledger>
      </div>
      <Card
        title="서버 확정 사건"
        note="확정과 재알림 횟수는 CEP 결정 수이며 실제 소리 전달 횟수와 다릅니다."
      >
        <EventTable events={live.events} muted={new Set()} />
      </Card>
      {result && (
        <div className="controls">
          <div className="row">
            <button className="btn" onClick={service.onRetry}>
              저장 다시 시도
            </button>
            <button className="btn" onClick={onPrepare}>
              다시 측정
            </button>
            <button className="btn btn-primary" onClick={onDashboard}>
              대시보드 보기
            </button>
          </div>
        </div>
      )}
      {screen.toast && screen.phase === 'running' && alertsOn && (
        <div className="toast" role="status">
          <div className="alert-title">자세 교정 알림</div>
          <div className="alert-desc">{screen.toast}</div>
        </div>
      )}
    </>
  )
}
