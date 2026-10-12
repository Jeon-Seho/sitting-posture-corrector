import { useEffect, useRef } from 'react'
import { ArrowCounterClockwise, Check, Leaf, Play, Square, VideoCamera, User } from '@phosphor-icons/react'
import { CameraStage } from '../components/CameraStage'
import { PoseGuide } from '../components/PoseGuide'
import { Ring } from '../components/Ring'
import type { CameraController } from '../hooks/useCamera'
import { usePostureRegistration } from '../features/camera/usePostureRegistration'
import { CALIBRATION_MS } from '../../../model/prototype/calibration'

/** Seconds of steady upper-body input needed for the baseline (see calibration.ts). */
const CALIBRATION_SECONDS = CALIBRATION_MS / 1000

/**
 * Registers the personal baseline (plan 0024). On this tab only: when the face and both
 * shoulders are visible it counts down 3·2·1, captures 3 s and ends by itself. It never
 * starts a measurement; "측정하기" then uses the registered baseline. A running measurement
 * keeps its baseline, so registering is blocked.
 */
export function PosturePage({
  camera,
  measuring,
  onMeasure,
}: {
  camera: CameraController
  measuring: boolean
  onMeasure: () => void
}) {
  const on = camera.state === 'on'
  const calibrating = camera.progress !== null
  const registered = !!camera.baseline
  const flow = usePostureRegistration(camera, measuring)
  const counting = flow.phase === 'countdown'
  const capturing = flow.phase === 'capturing' && calibrating
  const step = !on ? 0 : !camera.quality ? 1 : capturing || counting || !registered ? 2 : 3
  const left = Math.max(1, Math.ceil(CALIBRATION_SECONDS * (1 - (camera.progress ?? 0))))

  // Leaving this screen cancels an unfinished registration; other screens never calibrate.
  const latest = useRef(camera)
  latest.current = camera
  useEffect(() => () => latest.current.cancelCalibration(), [])

  const title = measuring
    ? '측정 중에는 자세를 다시 등록할 수 없어요'
    : capturing
      ? '그대로 편하게 있어 주세요'
      : counting
        ? '곧 자세를 기억해요'
        : flow.phase === 'failed'
          ? '자세를 인식하기 어려워요'
          : registered && !flow.armed
            ? '자세가 등록되어 있어요'
            : '평소 바른 자세를 등록해요'
  const desc = measuring
    ? '진행 중인 측정을 마친 뒤 다시 등록해 주세요.'
    : flow.phase === 'failed'
      ? '어깨와 얼굴이 화면 안쪽에 오도록 앉고 움직이지 않은 채 다시 시작해 주세요.'
      : registered && !flow.armed
        ? '측정하기에서 바로 측정을 시작할 수 있어요. 카메라 위치나 의자를 바꿨다면 다시 등록해 주세요.'
        : `얼굴과 양쪽 어깨가 보이면 3초 뒤 자동으로 시작해 ${CALIBRATION_SECONDS}초 동안 자세를 기억해요. 영상은 저장하지 않아요.`
  const pill = !on
    ? null
    : !camera.quality
      ? { tone: 'unknown', text: '얼굴과 양쪽 어깨를 찾고 있어요' }
      : registered && !flow.armed
        ? { tone: 'good', text: '자세가 등록되어 있어요' }
        : { tone: 'good', text: '얼굴과 양쪽 어깨가 잘 보여요' }

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
              disabled={calibrating || counting || measuring}
              onChange={(e) => void camera.connect(e.target.value)}
            >
              {camera.devices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `카메라 ${i + 1}`}
                </option>
              ))}
            </select>
          )}
          {on && !measuring && (
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
          {on && flow.armed && !capturing && <PoseGuide camera={camera} />}
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
              ) : counting ? (
                <div className="calibrate-card" role="status">
                  <span className="ring-value" style={{ fontSize: 40, minWidth: 64, textAlign: 'center' }}>
                    {flow.countdownLeft}
                  </span>
                  <div>
                    <div className="nudge-title">3초 뒤 측정이 시작돼요</div>
                    <div className="nudge-desc">편하게 바로 앉아 화면을 봐 주세요</div>
                  </div>
                  <button className="btn" onClick={flow.stop}>
                    측정 종료
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
                    <div className="nudge-title">측정 중</div>
                    <div className="nudge-desc">
                      {camera.quality
                        ? `${left}초 남았어요 · 움직이면 처음부터 다시 해요`
                        : '어깨가 보이면 처음부터 다시 해요'}
                    </div>
                  </div>
                  <button className="btn" onClick={flow.stop}>
                    측정 종료
                  </button>
                </div>
              ) : !flow.armed && on && !measuring && !registered ? (
                <button className="btn btn-primary btn-lg" onClick={flow.start}>
                  다시 시작
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="measure-panel">
          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 16 }}>
              등록 단계
            </h3>
            <ol className="steps" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {[
                ['카메라 연결', '권한을 허용하면 영상은 이 기기 안에서만 처리돼요'],
                ['얼굴·어깨 확인', '가림 없이 정면을 바라봐 주세요'],
                ['자세 기억하기', `${CALIBRATION_SECONDS}초 동안 편하게 바로 앉아 있어 주세요`],
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
                카메라를 옮겼다면 자세를 다시 등록해요
              </div>
              <div className="tip">
                <span className="tip-icon">
                  <Leaf size={20} weight="bold" />
                </span>
                억지로 펴지 말고 평소의 편한 자세로
              </div>
            </div>
          </section>

          {registered && !flow.armed && on && !measuring && (
            <button className="btn btn-block" onClick={flow.start}>
              <ArrowCounterClockwise size={17} weight="bold" className="icon" />
              다시 등록
            </button>
          )}
          {registered && !flow.armed && (
            <button className="btn btn-primary btn-lg btn-block" onClick={onMeasure}>
              <Play size={18} weight="fill" className="icon" />
              {measuring ? '측정 화면으로' : '측정하러 가기'}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
