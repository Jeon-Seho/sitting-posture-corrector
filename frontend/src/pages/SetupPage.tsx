import { useEffect, useRef } from 'react'
import { ArrowCounterClockwise, ArrowLeft, Check, Leaf, Play, Square, VideoCamera, User } from '@phosphor-icons/react'
import { CameraStage } from '../components/CameraStage'
import { PoseGuide } from '../components/PoseGuide'
import { Ring } from '../components/Ring'
import type { CameraController } from '../hooks/useCamera'
import { usePostureRegistration } from '../features/camera/usePostureRegistration'
import { useAutoStart } from '../features/camera/useAutoStart'
import { cameraName } from '../features/camera/mainCamera'
import { SelectMenu } from '../components/SelectMenu'
import { CALIBRATION_MS } from '../../../model/prototype/calibration'

/** Seconds of steady upper-body input needed for the baseline (see calibration.ts). */
const CALIBRATION_SECONDS = CALIBRATION_MS / 1000

/**
 * 「측정하기」 (2026-10-13: registration and measuring are one flow again).
 * - No registered posture: once the face and both shoulders are visible it counts down 3·2·1,
 *   remembers the posture for 3 s and then starts measuring by itself.
 * - A registered posture: 「측정 시작」 on the camera view starts measuring at once.
 * 「다시 등록」 (here or from settings via `registerAgain`) runs the registration again.
 */
export function SetupPage({
  camera,
  onStart,
  onCollect,
  measuring = false,
  registerAgain = false,
  onBack,
  onOpenSession,
  serverMode = false,
  onServerMode,
  serverModeDisabled = false,
  accountMode = false,
}: {
  camera: CameraController
  onStart: () => void
  onCollect: () => void
  measuring?: boolean
  /** Re-registration from settings: back button, no automatic measurement afterwards. */
  registerAgain?: boolean
  onBack?: () => void
  onOpenSession?: () => void
  serverMode?: boolean
  onServerMode?: (enabled: boolean) => void
  serverModeDisabled?: boolean
  accountMode?: boolean
}) {
  const on = camera.state === 'on'
  const registered = !!camera.baseline
  const flow = usePostureRegistration(camera, measuring)
  const calibrating = camera.progress !== null
  const counting = flow.phase === 'countdown'
  const capturing = flow.phase === 'capturing' && calibrating
  const registering = flow.armed
  const ready = registered && !registering && on && camera.quality && !calibrating
  const left = Math.max(1, Math.ceil(CALIBRATION_SECONDS * (1 - (camera.progress ?? 0))))

  // No posture yet (first run, or a different camera) or a request from settings: register.
  const latest = useRef({ flow, onStart })
  latest.current = { flow, onStart }
  useEffect(() => {
    if ((!registered || registerAgain) && !measuring && !latest.current.flow.armed) latest.current.flow.start()
    // Only when the posture goes missing or the page opens for a new registration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registered, registerAgain])
  // A registration that finished here starts the measurement right away.
  useEffect(() => {
    if (flow.phase === 'done' && !measuring && !registerAgain) latest.current.onStart()
  }, [flow.phase, measuring, registerAgain])
  const finished = registerAgain && flow.phase === 'done'
  // With a registered posture, 「카메라 켜기」 starts measuring once the person stays in view.
  const auto = useAutoStart({
    cameraOn: on,
    ready,
    enabled: registered && !registering && !measuring && !registerAgain,
    onStart,
  })
  // Leaving this screen cancels an unfinished registration.
  const cameraRef = useRef(camera)
  cameraRef.current = camera
  useEffect(() => () => cameraRef.current.cancelCalibration(), [])

  const step = !on ? 0 : !camera.quality ? 1 : registering || !registered ? 2 : 3
  const [title, desc] = headline({
    registerAgain,
    measuring,
    finished,
    on,
    quality: camera.quality,
    failed: flow.phase === 'failed',
    capturing,
    counting,
    registering: registering || !registered,
    registered,
    autoStarting: auto.left !== null,
  })
  const pill = !on
    ? null
    : !camera.quality
      ? { tone: 'unknown', text: '얼굴과 양쪽 어깨를 찾고 있어요' }
      : registered && !registering
        ? { tone: 'good', text: '기준 자세와 비교할 준비가 됐어요' }
        : { tone: 'good', text: '얼굴과 양쪽 어깨가 잘 보여요' }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-desc">{desc}</p>
          {camera.baselineOtherCamera && !registered && (
            <p className="fine">다른 카메라로 등록한 기준 자세라서 이 카메라로 다시 등록해요.</p>
          )}
        </div>
        <div className="page-actions">
          {onBack && (
            <button className="chip" onClick={onBack}>
              <ArrowLeft size={14} weight="bold" className="icon" />
              설정으로
            </button>
          )}
          {on && camera.devices.length > 1 && !camera.devices.some((d) => !d.deviceId) && (
            <SelectMenu
              label="카메라"
              icon={<VideoCamera size={15} weight="bold" className="icon" />}
              value={camera.deviceId}
              disabled={calibrating || counting || measuring}
              onChange={(id) => void camera.connect(id)}
              options={camera.devices.map((d, i) => ({ value: d.deviceId, label: cameraName(d, i) }))}
            />
          )}
          {registered && !registering && !measuring && (
            <button className="chip" disabled={!on} onClick={flow.start}>
              <ArrowCounterClockwise size={14} weight="bold" className="icon" />
              다시 등록
            </button>
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
          {on && !ready && !capturing && <PoseGuide camera={camera} />}
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
              {on && <span className="pill small num">{camera.metrics.fps.toFixed(0)} FPS</span>}
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
              ) : counting ? (
                <div className="calibrate-card" role="status">
                  <span className="ring-value" style={{ fontSize: 40, minWidth: 64, textAlign: 'center' }}>
                    {flow.countdownLeft}
                  </span>
                  <div>
                    <div className="nudge-title">3초 뒤 기준 자세를 등록해요</div>
                    <div className="nudge-desc">편하게 바로 앉아 화면을 봐 주세요</div>
                  </div>
                  <button className="btn" onClick={flow.stop}>
                    등록 취소
                  </button>
                </div>
              ) : capturing ? (
                <div className="calibrate-card" role="status">
                  <Ring value={camera.progress} size={64} stroke={7}>
                    <span className="ring-value" style={{ fontSize: 22 }}>
                      {left}
                    </span>
                  </Ring>
                  <div>
                    <div className="nudge-title">기준 자세를 기억하는 중</div>
                    <div className="nudge-desc">
                      {camera.quality
                        ? `${left}초 남았어요${registerAgain ? '' : ' · 끝나면 바로 측정을 시작해요'}`
                        : '어깨가 다시 보이면 처음부터 시작해요'}
                    </div>
                  </div>
                  <button className="btn" onClick={flow.stop}>
                    등록 취소
                  </button>
                </div>
              ) : registerAgain && measuring ? (
                onOpenSession && (
                  <button className="btn btn-primary btn-lg" onClick={onOpenSession}>
                    측정 화면으로
                  </button>
                )
              ) : finished ? (
                <div className="calibrate-card" role="status">
                  <span className="step-mark done" aria-hidden="true">
                    <Check size={18} weight="bold" />
                  </span>
                  <div>
                    <div className="nudge-title">새 기준 자세를 등록했어요</div>
                    <div className="nudge-desc">다음 측정부터 이 자세와 비교해요</div>
                  </div>
                  <button className="btn btn-primary" disabled={!ready} onClick={onStart}>
                    측정 시작
                  </button>
                  {onBack && (
                    <button className="btn" onClick={onBack}>
                      설정으로
                    </button>
                  )}
                </div>
              ) : auto.left !== null ? (
                <div className="calibrate-card" role="status">
                  <Ring value={auto.progress} size={64} stroke={7}>
                    <span className="ring-value" style={{ fontSize: 22 }}>
                      {auto.left}
                    </span>
                  </Ring>
                  <div>
                    <div className="nudge-title">곧 측정을 시작해요</div>
                    <div className="nudge-desc">기준 자세와 비교할 준비를 하고 있어요</div>
                  </div>
                  <button className="btn btn-primary" onClick={onStart}>
                    지금 시작
                  </button>
                  <button className="btn" onClick={auto.cancel}>
                    취소
                  </button>
                </div>
              ) : ready && !measuring ? (
                <button className="btn btn-primary btn-lg" onClick={onStart}>
                  <Play size={20} weight="fill" className="icon" />
                  측정 시작
                </button>
              ) : !registering && !registered && on && !measuring ? (
                <button className="btn btn-primary btn-lg" onClick={flow.start}>
                  기준 자세 등록 다시 시작
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
                [
                  registered && !registering ? '기준 자세 등록됨' : '기준 자세 등록',
                  registered && !registering
                    ? '카메라 위치나 의자를 바꿨다면 다시 등록해 주세요'
                    : `${CALIBRATION_SECONDS}초 동안 편하게 앉아 있으면 돼요`,
                ],
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
                카메라를 옮겼다면 기준 자세를 다시 등록해요
              </div>
              <div className="tip">
                <span className="tip-icon">
                  <Leaf size={20} weight="bold" />
                </span>
                억지로 펴지 말고 평소의 편한 자세로
              </div>
            </div>
          </section>

          <button className="btn btn-primary btn-lg btn-block" disabled={!ready || measuring} onClick={onStart}>
            <Play size={18} weight="fill" className="icon" />
            측정 시작
          </button>
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
                <button className="btn btn-sm" disabled={!camera.baseline || !on} onClick={onCollect}>
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

/** Page title and description, in the order the user meets each state. */
function headline(s: {
  registerAgain: boolean
  measuring: boolean
  finished: boolean
  on: boolean
  quality: boolean
  failed: boolean
  capturing: boolean
  counting: boolean
  registering: boolean
  registered: boolean
  autoStarting: boolean
}): [string, string] {
  if (s.registerAgain && s.measuring)
    return ['측정 중에는 기준 자세를 바꿀 수 없어요', '진행 중인 측정을 마친 뒤 다시 등록해 주세요.']
  if (s.finished) return ['새 기준 자세를 등록했어요', '이제 이 자세와 비교해서 알려드려요.']
  if (!s.on)
    return s.registered && !s.registerAgain
      ? ['카메라를 켜 주세요', '등록한 기준 자세로 바로 측정할 수 있어요.']
      : ['카메라를 켜 주세요', '평소 편하게 바로 앉은 자세를 기준 자세로 등록하고, 그 자세에서 멀어질 때만 알려드려요.']
  if (s.failed)
    return ['자세를 알아보기 어려워요', '얼굴과 양쪽 어깨가 화면 안에 들어오게 앉고, 잠시 움직이지 말아 주세요.']
  if (s.capturing) return ['그대로 편하게 있어 주세요', '기준 자세를 기억하고 있어요. 영상은 저장하지 않아요.']
  if (s.counting) return ['편하게 바로 앉아 주세요', '곧 기준 자세 등록을 시작해요.']
  if (!s.quality)
    return ['얼굴과 양쪽 어깨가 보이게 앉아 주세요', '점선은 거리에 맞춰 따라오니 억지로 맞추지 않아도 돼요.']
  if (s.registering)
    return s.registerAgain
      ? ['기준 자세 다시 등록', `3초 뒤 자동으로 시작해 ${CALIBRATION_SECONDS}초 동안 기억해요.`]
      : ['기준 자세를 등록해요', `3초 뒤 자동으로 시작해 ${CALIBRATION_SECONDS}초 동안 기억하고, 끝나면 바로 측정을 시작해요.`]
  if (s.autoStarting) return ['곧 측정을 시작해요', '그대로 편하게 앉아 있으면 측정이 바로 시작돼요.']
  return ['준비됐어요', '측정을 시작하면 기준 자세에서 멀어질 때 알려드려요.']
}
