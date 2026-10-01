import {
  BellSlash,
  FastForward,
  House,
  Pause,
  Play,
  Question,
  Stop,
  WarningOctagon,
} from '@phosphor-icons/react'
import type { CameraController } from '../../hooks/useCamera'
import type { CollectionController } from '../../hooks/useCollection'
import { COLLAPSE_LABEL } from '../../data/posture'
import { VisualControls } from '../../components/VisualControls'
import { CollectionPanel } from '../../components/CollectionPanel'
import { CameraStage } from '../../components/CameraStage'
import { PoseStage } from '../../components/PoseStage'
import { Meter } from '../../components/ui'
import { formatClock } from '../../lib/stats'
import { SessionVerdict } from './SessionVerdict'
import type { SessionService } from './types'
import type { SessionScreen } from './useSessionScreen'

const SPEEDS = [1, 2, 4, 8]

type Props = {
  screen: SessionScreen
  camera: CameraController
  collection: CollectionController
  service?: SessionService
  alertsOn: boolean
  onPrepare: () => void
  onFinish: () => void
}

export function SessionLive({
  screen,
  camera,
  collection,
  service,
  alertsOn,
  onPrepare,
  onFinish,
}: Props) {
  const {
    rules,
    phase,
    setPhase,
    speed,
    setSpeed,
    showSkeleton,
    setShowSkeleton,
    soundOn,
    soundError,
    pauseReason,
    isCamera,
    live,
    seekNext,
    toast,
    warningScore,
    toggleSound,
    togglePause,
  } = screen
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">실시간 측정</h1>
          <p className="page-desc">
            자세 점수가 {warningScore}점 이하로 {rules.holdSeconds}초 이상 이어질 때만 이벤트로
            확정합니다.
          </p>
        </div>
        {!isCamera && (
          <div className="row" role="group" aria-label="시연 배속">
            <span className="stat-label">시연 배속</span>
            <div className="segmented">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  className="chip num"
                  aria-pressed={speed === s}
                  onClick={() => setSpeed(s)}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="session-grid">
        <div className="stack">
          <div className="stage">
            {isCamera ? (
              (!service || service.active) && (
                <CameraStage camera={camera} showSkeleton={showSkeleton} />
              )
            ) : (
              <PoseStage
                keypoints={live.keypoints}
                state={live.state}
                confidence={live.confidence}
                showSkeleton={showSkeleton}
              />
            )}
            <div className="stage-overlay">
              <div className="stage-top">
                <span className="stage-tag">
                  {phase === 'running' ? (
                    <i className="rec-dot" />
                  ) : (
                    <Pause size={13} weight="fill" />
                  )}
                  {phase === 'running' ? (isCamera ? '웹캠 측정 중' : '합성 시연 중') : '일시정지'}
                  <span className="num muted">{formatClock(live.totalSeconds)}</span>
                </span>
                <span className="stage-tag">
                  {isCamera && (
                    <span>
                      {camera.metrics.fps.toFixed(0)} FPS · {camera.metrics.inferenceMs.toFixed(0)}
                      ms · {camera.metrics.delegate}
                    </span>
                  )}
                </span>
              </div>

              <div className="stage-bottom" aria-live="polite">
                {phase === 'running' && live.state === 'collapse' && !live.alerting && (
                  <div className="hold-bar">
                    <div className="label">
                      <span>
                        붕괴 지속 확인 중 · {live.collapse ? COLLAPSE_LABEL[live.collapse] : ''}
                      </span>
                      <span className="num">
                        {(live.holdProgress * rules.holdSeconds).toFixed(1)} /{' '}
                        {rules.holdSeconds.toFixed(1)}초
                      </span>
                    </div>
                    <Meter value={live.holdProgress} color="var(--warn-hi)" />
                  </div>
                )}

                {phase === 'running' && live.state === 'unknown' && (
                  <div className="alert-banner notice">
                    <Question size={22} weight="bold" className="icon alert-icon gray" />
                    <div>
                      <div className="alert-title">판정 불가 구간</div>
                      <div className="alert-desc">
                        {live.notice} 이 구간은 유효 측정 시간에서 제외됩니다.
                      </div>
                    </div>
                  </div>
                )}

                {phase === 'running' && live.state !== 'unknown' && live.alerting && alertsOn && (
                  <div className="alert-banner">
                    <WarningOctagon size={22} weight="fill" className="icon alert-icon" />
                    <div style={{ flex: 1 }}>
                      <div className="alert-title">
                        자세를 교정해 주세요
                        {live.collapse ? ` · ${COLLAPSE_LABEL[live.collapse]}` : ''}
                      </div>
                      <div className="alert-desc">
                        등록한 기준에서 자세 변화가 이어지고 있어요. 편안하게 앉아 자세를 확인해
                        주세요.
                      </div>
                      <div className="event-meta" style={{ marginTop: 6 }}>
                        <span>
                          복귀 확인 {(live.recoverProgress * rules.recoverSeconds).toFixed(1)}/
                          {rules.recoverSeconds}초
                        </span>
                        {live.nextAlertIn !== null && (
                          <span>재알림까지 {Math.ceil(live.nextAlertIn)}초</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {phase === 'running' && live.state !== 'unknown' && live.alerting && !alertsOn && (
                  <div className="alert-banner notice">
                    <BellSlash size={22} weight="bold" className="icon alert-icon gray" />
                    <div>
                      <div className="alert-title">알림이 꺼져 있습니다</div>
                      <div className="alert-desc">
                        붕괴 이벤트는 계속 기록되지만 알림은 표시하지 않습니다.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {pauseReason && <p role="status">{pauseReason}</p>}
          {phase === 'paused' && isCamera && (!camera.baseline || camera.state !== 'on') && (
            <button className="btn" onClick={onPrepare}>
              카메라 준비 다시 확인
            </button>
          )}
          <div className="controls">
            <div className="row">
              <button className="btn" aria-pressed={soundOn} onClick={toggleSound}>
                {soundOn ? '소리 켜짐 · 음소거' : '소리 꺼짐 · 켜기'}
              </button>
              <button
                className="btn"
                disabled={
                  phase === 'paused' &&
                  isCamera &&
                  (!camera.baseline || camera.state !== 'on' || !camera.quality)
                }
                onClick={togglePause}
              >
                {phase === 'paused' ? (
                  <Play size={17} weight="fill" className="icon" />
                ) : (
                  <Pause size={17} weight="fill" className="icon" />
                )}
                {phase === 'paused' ? '측정 재개' : '일시정지'}
              </button>
              <button className="btn btn-danger" onClick={() => setPhase('ended')}>
                <Stop size={17} weight="fill" className="icon" />
                측정 종료
              </button>
            </div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button
                className="chip"
                aria-pressed={showSkeleton}
                onClick={() => setShowSkeleton(!showSkeleton)}
              >
                키포인트 표시
              </button>
              {!isCamera && (
                <button className="btn btn-sm" onClick={seekNext}>
                  <FastForward size={15} weight="fill" className="icon" />
                  다음 구간으로
                </button>
              )}
              <button className="btn btn-sm" onClick={onFinish}>
                <House size={15} weight="bold" className="icon" />
                홈으로
              </button>
            </div>
          </div>
          {soundError && <p role="status">{soundError}</p>}
          {isCamera && <VisualControls camera={camera} />}
          {isCamera && !service && <CollectionPanel collection={collection} />}
        </div>

        <SessionVerdict screen={screen} camera={camera} />
      </div>

      {toast && phase === 'running' && live.state !== 'unknown' && alertsOn && (
        <div className="toast" role="status">
          <WarningOctagon size={22} weight="fill" className="icon" />
          <div>
            <div className="alert-title">자세 교정 알림</div>
            <div className="alert-desc">{toast}</div>
          </div>
        </div>
      )}
    </>
  )
}
