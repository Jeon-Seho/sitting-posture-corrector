import { ThemeIllustration } from '../features/appearance/ThemeIllustration'
import { useEffect, useRef } from 'react'
import { ArrowCounterClockwise, ArrowLeft, Check, Play, Square, VideoCamera } from '../components/icons'
import { CameraStage } from '../components/CameraStage'
import { PoseGuide } from '../components/PoseGuide'
import { Ring } from '../components/Ring'
import { PreparationSteps } from '../components/PreparationSteps'
import type { CameraController } from '../hooks/useCamera'
import { usePostureRegistration } from '../features/camera/usePostureRegistration'
import { useAutoStart } from '../features/camera/useAutoStart'
import { CameraPicker } from '../features/camera/CameraPicker'
import { CAPTURE_MS } from '../features/baseline/landmarkCapture'

/** Seconds of steady upper-body input needed for the baseline (see calibration.ts). */
const CALIBRATION_SECONDS = CAPTURE_MS / 1000

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
  measuring = false,
  registerAgain = false,
  onBack,
  onOpenSession,
  startLabel = '측정 시작',
}: {
  camera: CameraController
  onStart: () => void
  onCollect: () => void
  measuring?: boolean
  /** Re-registration from settings: back button, no automatic measurement afterwards. */
  registerAgain?: boolean
  onBack?: () => void
  onOpenSession?: () => void
  /** Text of the start buttons; sign-up step 3 says 「앱 시작」. */
  startLabel?: string
}) {
  const on = camera.state === 'on'
  const registered = !!camera.baseline
  const flow = usePostureRegistration(camera, measuring)
  const calibrating = camera.progress !== null
  const counting = flow.phase === 'countdown'
  const capturing = flow.phase === 'capturing' && calibrating
  const saving = flow.phase === 'saving'
  const registering = flow.armed
  const ready = registered && !registering && on && camera.quality && !calibrating
  const left = Math.max(1, Math.ceil(CALIBRATION_SECONDS * (1 - (camera.progress ?? 0))))

  // No posture yet (first run, or a different camera) or a request from settings: register.
  const latest = useRef({ flow, onStart })
  latest.current = { flow, onStart }
  useEffect(() => {
    // Wait for B2 first: the server may already have a posture. If B2 failed, the user chooses.
    if ((camera.baselineLoading || camera.baselineError) && !registerAgain) return
    if ((!registered || registerAgain) && !measuring && !latest.current.flow.armed) latest.current.flow.start()
    // Only when the posture goes missing or the page opens for a new registration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registered, registerAgain, camera.baselineLoading, camera.baselineError])
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

  const loadFailed = !registered && !registering && !registerAgain && !measuring ? camera.baselineError : null
  const step = !on ? 0 : !camera.quality ? 1 : registering || !registered ? 2 : 3
  const [title, desc] = headline({
    registerAgain,
    measuring,
    finished,
    loadFailed,
    on,
    quality: camera.quality,
    failed: flow.phase === 'failed',
    failure: flow.error,
    saving,
    capturing,
    counting,
    registering: registering || !registered,
    registered,
    autoStarting: auto.left !== null,
    framingLow: camera.framing === 'low',
  })
  const pill = !on
    ? null
    : !camera.quality
      ? { tone: 'unknown', text: '얼굴과 양쪽 어깨를 찾고 있어요' }
      : registering && camera.framing === 'low'
        ? { tone: 'unknown', text: '어깨가 화면 아래 끝에 가까워요' }
        : registered && !registering
        ? { tone: 'good', text: '기준 자세와 비교할 준비가 됐어요' }
        : { tone: 'good', text: '얼굴과 양쪽 어깨가 잘 보여요' }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-desc">{desc}</p>
        </div>
        <div className="page-actions">
          {onBack && (
            <button className="chip" onClick={onBack}>
              <ArrowLeft size={14} weight="bold" className="icon" />
              설정으로
            </button>
          )}
          {loadFailed && (
            <>
              <button className="chip" disabled={camera.baselineLoading} onClick={() => void camera.reloadBaseline()}>
                <ArrowCounterClockwise size={14} weight="bold" className="icon" />
                다시 불러오기
              </button>
              <button className="chip" disabled={!on} onClick={flow.start}>
                새로 등록
              </button>
            </>
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
        <div className="stage-col">
          {/* Same choice as settings, right above the camera view so it never covers the video, and
              shown even with the camera off (2026-10-16). Locked while registering or measuring,
              since the posture belongs to one camera. */}
          <div className="stage-bar">
            <CameraPicker camera={camera} disabled={calibrating || counting || measuring} />
          </div>
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
                ) : saving ? (
                  <div className="calibrate-card" role="status">
                    <div>
                      <div className="nudge-title">기준 자세를 저장하는 중</div>
                      <div className="nudge-desc">서버에 저장하고 있어요. 잠시만 기다려 주세요.</div>
                    </div>
                  </div>
                ) : measuring ? (
                  // A measurement is still open (also after 「카메라 준비 다시 확인」): go back to it.
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
                      {startLabel}
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
                    {startLabel}
                  </button>
                ) : !registering && !registered && on && !measuring ? (
                  <button className="btn btn-primary btn-lg" onClick={flow.start}>
                    기준 자세 등록 다시 시작
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="measure-panel">
          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 16 }}>
              준비 단계
            </h3>
            <PreparationSteps step={step} labels={['카메라 연결', '얼굴·어깨 확인', registered && !registering ? '기준 자세 등록됨' : '기준 자세 등록']} />
          </section>

          <div className="posture-note">
            <ThemeIllustration kind="baseline" />
            <span>편하게 앉은 자세를 기억해요.</span>
          </div>

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
  /** B2 failed (why); the user loads it again or registers a new posture. */
  loadFailed: string | null
  on: boolean
  quality: boolean
  failed: boolean
  /** Why the server did not save it (out of frame, signed out, server error). */
  failure: string | null
  saving: boolean
  capturing: boolean
  counting: boolean
  registering: boolean
  registered: boolean
  autoStarting: boolean
  framingLow: boolean
}): [string, string] {
  if (s.registerAgain && s.measuring)
    return ['측정 중에는 기준 자세를 바꿀 수 없어요', '진행 중인 측정을 마친 뒤 다시 등록해 주세요.']
  if (s.finished) return ['새 기준 자세를 등록했어요', '이제 이 자세와 비교해서 알려드려요.']
  if (s.loadFailed) return ['등록한 기준 자세를 불러오지 못했어요', s.loadFailed]
  if (!s.on)
    return s.registered && !s.registerAgain
      ? ['카메라를 켜 주세요', '등록한 기준 자세로 바로 측정할 수 있어요.']
      : ['카메라를 켜 주세요', '얼굴과 양쪽 어깨가 보이면 준비가 시작돼요.']
  if (s.saving) return ['기준 자세를 저장하고 있어요', '서버에 저장되면 바로 다음 단계로 넘어가요.']
  if (s.failed && s.failure) return ['기준 자세를 저장하지 못했어요', s.failure]
  if (s.failed)
    return ['자세를 알아보기 어려워요', '얼굴과 양쪽 어깨가 화면 안에 들어오게 앉고, 잠시 움직이지 말아 주세요.']
  if (s.capturing) return ['그대로 편하게 있어 주세요', '기준 자세를 기억하고 있어요. 영상은 저장하지 않아요.']
  if (s.counting) return ['편하게 바로 앉아 주세요', '곧 기준 자세 등록을 시작해요.']
  if (!s.quality)
    return ['얼굴과 양쪽 어깨가 보이게 앉아 주세요', '점선은 거리에 맞춰 따라오니 억지로 맞추지 않아도 돼요.']
  if (s.registering && s.framingLow)
    return ['조금 뒤로 앉아 주세요', '어깨가 화면 아래 끝에 걸려 있어요. 어깨가 화면 안쪽에 오면 등록을 시작해요.']
  if (s.registering)
    return s.registerAgain
      ? ['기준 자세 다시 등록', `3초 뒤 자동으로 시작해 ${CALIBRATION_SECONDS}초 동안 기억해요.`]
      : ['기준 자세를 등록해요', `3초 뒤 자동으로 시작해 ${CALIBRATION_SECONDS}초 동안 기억하고, 끝나면 바로 측정을 시작해요.`]
  if (s.autoStarting) return ['곧 측정을 시작해요', '그대로 편하게 앉아 있으면 측정이 바로 시작돼요.']
  return ['준비됐어요', '측정을 시작하면 기준 자세에서 멀어질 때 알려드려요.']
}
