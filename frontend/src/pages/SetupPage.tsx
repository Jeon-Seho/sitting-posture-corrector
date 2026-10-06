import { ArrowCounterClockwise, Check, Leaf, Play, Square, VideoCamera, User } from '@phosphor-icons/react'
import { CameraStage } from '../components/CameraStage'
import { PoseGuide } from '../components/PoseGuide'
import { Ring } from '../components/Ring'
import type { CameraController } from '../hooks/useCamera'

/** Seconds of steady upper-body input needed for the quick baseline (see useCamera). */
const CALIBRATION_SECONDS = 5

export function SetupPage({
  camera,
  onStart,
  onCollect,
  onCancel,
  startLabel = '측정 시작',
  serverMode = false,
  onServerMode,
  serverModeDisabled = false,
  accountMode = false,
}: {
  startLabel?: string
  camera: CameraController
  onStart: () => void
  onCollect: () => void
  onCancel: () => void
  serverMode?: boolean
  onServerMode?: (enabled: boolean) => void
  serverModeDisabled?: boolean
  accountMode?: boolean
}) {
  const on = camera.state === 'on'
  const calibrating = camera.progress !== null
  const ready = on && camera.quality && !!camera.baseline && !calibrating
  const step = !on ? 0 : !camera.quality ? 1 : !camera.baseline || calibrating ? 2 : 3
  const title = ['카메라를 켜 볼까요?', '화면 안으로 들어와 주세요', '편하게 앉아볼까요?', '준비가 끝났어요'][step]
  const desc = [
    '평소 바르게 앉은 모습을 기억해 두고, 그 자세에서 멀어질 때만 알려드려요.',
    '얼굴과 양쪽 어깨가 모두 보이면 다음 단계로 넘어가요. 점선은 거리에 맞춰 따라오니 억지로 맞추지 않아도 돼요.',
    `평소 편한 자세를 ${CALIBRATION_SECONDS}초 동안 기억해 둘게요. 영상은 저장하거나 보내지 않아요.`,
    '이제 측정을 시작하면 자세가 흐트러질 때 알려드려요.',
  ][step]
  const pill = !on
    ? null
    : !camera.quality
      ? { tone: 'unknown', text: '얼굴과 양쪽 어깨를 찾고 있어요' }
      : camera.baseline && !calibrating
        ? { tone: 'good', text: '기준 자세를 기억했어요' }
        : { tone: 'good', text: '얼굴과 양쪽 어깨가 잘 보여요' }
  const left = Math.max(1, Math.ceil(CALIBRATION_SECONDS * (1 - (camera.progress ?? 0))))

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-desc">{desc}</p>
        </div>
        <div className="page-actions">
          {on && camera.devices.length > 1 && (
            <select
              className="input"
              style={{ height: 36, width: 'auto', borderRadius: 999, fontSize: 13 }}
              aria-label="실제 카메라 선택"
              value={camera.deviceId}
              disabled={calibrating}
              onChange={(e) => void camera.connect(e.target.value)}
            >
              {camera.devices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `카메라 ${i + 1}`}
                </option>
              ))}
            </select>
          )}
          {on && (
            <button className="chip" onClick={camera.stop}>
              <Square size={14} weight="bold" className="icon" />
              카메라 끄기
            </button>
          )}
        </div>
      </div>

      <div className="measure">
        <div className="stage">
          <CameraStage camera={camera} />
          {on && !ready && <PoseGuide camera={camera} />}
          <div className="stage-overlay">
            <div className="stage-top">
              {pill ? (
                <span className={`pill ${pill.tone}`} role="status">
                  <span className="dot" />
                  {pill.text}
                </span>
              ) : (
                <span />
              )}
              {on && (
                <span className="pill small num">
                  {camera.metrics.fps.toFixed(0)} FPS
                </span>
              )}
            </div>
            <div className="stage-bottom">
              {camera.state === 'off' || camera.state === 'error' ? (
                <button className="btn btn-primary btn-lg" onClick={() => void camera.connect()}>
                  <VideoCamera size={20} weight="fill" className="icon" />
                  {camera.state === 'error' ? '다시 연결' : '카메라 켜기'}
                </button>
              ) : camera.state === 'loading' ? (
                <button className="btn btn-lg" onClick={camera.stop}>
                  카메라 준비 취소
                </button>
              ) : calibrating ? (
                <div className="calibrate-card" role="status">
                  <Ring value={camera.progress} size={64} stroke={7}>
                    <span className="ring-value" style={{ fontSize: 22 }}>
                      {left}
                    </span>
                  </Ring>
                  <div>
                    <div className="nudge-title">
                      {camera.quality ? '그대로 편하게 있어 주세요' : '어깨가 보이면 다시 시작해요'}
                    </div>
                    <div className="nudge-desc">
                      {camera.baseline
                        ? '새 기준이 완성될 때까지 기존 기준을 유지해요.'
                        : `${left}초 남았어요 · 움직이면 처음부터 다시 해요`}
                    </div>
                  </div>
                  <button className="btn" onClick={camera.cancelCalibration}>
                    보정 취소
                  </button>
                </div>
              ) : on && camera.quality && !camera.baseline ? (
                <button className="btn btn-primary btn-lg" onClick={camera.calibrate}>
                  편하게 앉아서 기준 등록 시작
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="measure-panel">
          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 16 }}>
              준비 단계
            </h3>
            <ol className="steps" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {[
                ['카메라 연결', '권한을 허용하면 영상은 이 기기 안에서만 처리돼요'],
                ['얼굴·어깨 확인', '가림 없이 정면을 바라봐 주세요'],
                ['기준 자세 기억하기', `${CALIBRATION_SECONDS}초 동안 편하게 앉아 있기`],
              ].map(([name, hint], i) => (
                <li className="step" key={name}>
                  <span className={`step-mark ${step > i ? 'done' : step === i ? 'active' : ''}`}>
                    {step > i ? <Check size={16} weight="bold" /> : i + 1}
                  </span>
                  <div>
                    <div className="step-title">{name}</div>
                    <div className="step-desc">{hint}</div>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="card tips-card">
            <h3 className="card-title" style={{ marginBottom: 14 }}>
              이렇게 앉으면 좋아요
            </h3>
            <div className="tips">
              <div className="tip">
                <span className="tip-icon">
                  <User size={20} weight="bold" />
                </span>
                화면 가운데에 앉아 점선 안에 머리를 맞춰요
              </div>
              <div className="tip">
                <span className="tip-icon">
                  <VideoCamera size={20} weight="bold" />
                </span>
                카메라를 옮겼다면 기준을 다시 등록해요
              </div>
              <div className="tip">
                <span className="tip-icon">
                  <Leaf size={20} weight="bold" />
                </span>
                억지로 펴지 말고 평소의 편한 자세로
              </div>
            </div>
          </section>

          {camera.baseline && on && !calibrating && (
            <button className="btn btn-block" disabled={!camera.quality} onClick={camera.calibrate}>
              <ArrowCounterClockwise size={17} weight="bold" className="icon" />
              다시 보정
            </button>
          )}
          <button className="btn btn-primary btn-lg btn-block" disabled={!ready} onClick={onStart}>
            <Play size={18} weight="fill" className="icon" />
            {startLabel}
          </button>
          {step < 3 && (
            <button className="btn btn-quiet btn-sm" onClick={onCancel}>
              나중에 할게요
            </button>
          )}
          <details className="more">
            <summary>개발자 옵션</summary>
            <div className="more-body">
              {accountMode ? (
                <p className="fine">
                  확인된 측정 요약과 사건을 내 계정에 보관합니다. 영상과 관절 좌표는 전송하지 않습니다.
                </p>
              ) : (
                onServerMode && (
                  <>
                    <label className="row">
                      <input
                        type="checkbox"
                        checked={serverMode}
                        disabled={serverModeDisabled}
                        onChange={(event) => onServerMode(event.target.checked)}
                      />
                      서버 판정 사용 · 개발 연결
                    </label>
                    <p className="fine">
                      개인 기준 대비 변화량과 품질값만 로컬 개발 서버로 보냅니다. 영상과 관절 좌표는
                      보내지 않습니다.
                      {serverMode && ' 서버 기록은 메모리에 보관되어 서버를 다시 켜면 사라집니다.'}
                    </p>
                  </>
                )
              )}
              <div className="row">
                <button
                  className="btn btn-sm"
                  disabled={!camera.baseline || !on || calibrating}
                  onClick={onCollect}
                >
                  자세 데이터 수집으로 이동
                </button>
                <span className="fine">연구용 라벨 촬영 화면입니다.</span>
              </div>
            </div>
          </details>
        </div>
      </div>

    </>
  )
}
