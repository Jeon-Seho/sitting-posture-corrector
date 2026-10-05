import { FastForward, Pause, Play, SpeakerHigh, SpeakerSlash, Stop, WarningCircle } from '@phosphor-icons/react'
import { Segmented } from '../../components/Segmented'
import type { CameraController } from '../../hooks/useCamera'
import type { CollectionController } from '../../hooks/useCollection'
import { CollectionPanel } from '../../components/CollectionPanel'
import { CameraStage } from '../../components/CameraStage'
import { PoseStage } from '../../components/PoseStage'
import { fromLocalLive, statusCopy } from './liveView'
import {
  ClockPill,
  Nudge,
  ScoreCard,
  SessionSummaryCard,
  StatusPill,
  TimelineCard,
  useStatusTimeline,
} from './MeasureParts'
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

export function SessionLive({ screen, camera, collection, service, alertsOn, onPrepare }: Props) {
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
  const view = fromLocalLive(live, phase === 'paused')
  const runs = useStatusTimeline(view)
  const copy = statusCopy(view)
  const cannotResume =
    phase === 'paused' && isCamera && (!camera.baseline || camera.state !== 'on' || !camera.quality)
  const needsPrepare = phase === 'paused' && isCamera && (!camera.baseline || camera.state !== 'on')
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{copy.title}</h1>
          <p className="page-desc">
            {isCamera
              ? '등록한 내 기준 자세와 비교하고 있어요. 영상은 저장하거나 보내지 않아요.'
              : '저장된 합성 시연 기록을 이어서 보고 있어요.'}
          </p>
        </div>
        <div className="page-actions">
          {!isCamera && (
            <Segmented label="시연 배속">
              {SPEEDS.map((s) => (
                <button key={s} className="num" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                  {s}x
                </button>
              ))}
            </Segmented>
          )}
          {!isCamera && (
            <button className="chip" onClick={seekNext}>
              <FastForward size={15} weight="fill" className="icon" />
              다음 구간으로
            </button>
          )}
          <button
            className="chip"
            aria-pressed={showSkeleton}
            onClick={() => setShowSkeleton(!showSkeleton)}
          >
            관절 표시
          </button>
        </div>
      </div>

      <div className="measure">
        <div className={`stage ${view.status === 'bad' && alertsOn ? 'is-alert' : ''}`}>
          {isCamera ? (
            (!service || service.active) && <CameraStage camera={camera} showSkeleton={showSkeleton} />
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
              <StatusPill view={view} />
              <ClockPill seconds={live.totalSeconds} running={phase === 'running'} />
            </div>
            <div className="stage-bottom">
              {phase === 'running' && (
                <Nudge
                  view={view}
                  alertsOn={alertsOn}
                  holdSeconds={rules.holdSeconds}
                  recoverSeconds={rules.recoverSeconds}
                />
              )}
              <div className="dock">
                <button className="btn dock-main" disabled={cannotResume} onClick={togglePause}>
                  {phase === 'paused' ? (
                    <Play size={18} weight="fill" className="icon" />
                  ) : (
                    <Pause size={18} weight="fill" className="icon" />
                  )}
                  {phase === 'paused' ? '측정 재개' : '잠시 쉬기'}
                </button>
                <button className="btn" onClick={() => setPhase('ended')}>
                  <Stop size={18} weight="fill" className="icon" />
                  측정 종료
                </button>
                <button
                  className="btn btn-icon"
                  aria-pressed={soundOn}
                  aria-label={soundOn ? '알림 소리 끄기' : '알림 소리 켜기'}
                  title={soundOn ? '알림 소리 켜짐' : '알림 소리 꺼짐'}
                  onClick={toggleSound}
                >
                  {soundOn ? <SpeakerHigh size={20} weight="bold" /> : <SpeakerSlash size={20} weight="bold" />}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="measure-panel">
          <ScoreCard view={view} warningScore={warningScore} />
          <SessionSummaryCard view={view} />
          <TimelineCard runs={runs} />
        </div>
      </div>

      {(pauseReason || soundError || needsPrepare) && (
        <p role="status" className="notice">
          <WarningCircle size={20} weight="bold" className="icon" />
          {pauseReason || soundError || '카메라와 기준 자세를 다시 확인해야 이어서 측정할 수 있어요.'}
          {needsPrepare && (
            <button className="btn btn-sm" onClick={onPrepare}>
              카메라 준비 다시 확인
            </button>
          )}
        </p>
      )}
      {isCamera && !service && <CollectionPanel collection={collection} />}

      {toast && phase === 'running' && live.state !== 'unknown' && alertsOn && (
        <div className="toast" role="status">
          <WarningCircle size={22} weight="fill" className="icon" />
          <div>
            <div className="alert-title">자세를 확인해 주세요</div>
            <div className="alert-desc">{toast}</div>
          </div>
        </div>
      )}
    </>
  )
}
