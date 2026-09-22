import { VisualControls } from '../components/VisualControls'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Play, VideoCameraSlash, WarningCircle } from '@phosphor-icons/react'
import { POSES } from '../data/posture'
import { PoseStage } from '../components/PoseStage'
import { CameraStage } from '../components/CameraStage'
import type { CameraController } from '../hooks/useCamera'
import { Card, DemoNote, Meter } from '../components/ui'

type Permission = 'granted' | 'denied' | 'nodevice'

const CAMERAS = [
  { id: 'cam-builtin', name: '내장 웹캠 (720p)' },
  { id: 'cam-usb', name: 'USB 웹캠 (1080p)' },
]

const CALIBRATE_SECONDS = 3

function DemoSetupPage({ onStart, onCancel }: { onStart: () => void; onCancel: () => void }) {
  const [permission, setPermission] = useState<Permission>('granted')
  const [camera, setCamera] = useState(CAMERAS[0].id)
  const [progress, setProgress] = useState(0)
  const [calibrated, setCalibrated] = useState(false)
  const [running, setRunning] = useState(false)
  const raf = useRef(0)

  // 기준 자세 보정. 실제 캡처 대신 3초 동안 진행률만 채운다.
  useEffect(() => {
    if (!running) return
    let start = 0
    const tick = (ts: number) => {
      if (!start) start = ts
      const p = Math.min((ts - start) / 1000 / CALIBRATE_SECONDS, 1)
      setProgress(p)
      if (p >= 1) {
        setCalibrated(true)
        setRunning(false)
        return
      }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [running])

  useEffect(() => {
    // 권한이 바뀌면 보정 결과를 버린다
    setCalibrated(false)
    setProgress(0)
    setRunning(false)
  }, [permission, camera])

  const ok = permission === 'granted'
  const steps = [
    {
      title: '카메라 권한 확인',
      desc:
        permission === 'granted'
          ? '브라우저에서 카메라 사용이 허용되었습니다.'
          : permission === 'denied'
            ? '카메라 권한이 거부되었습니다. 주소창 옆 자물쇠 아이콘에서 카메라 권한을 허용해 주세요.'
            : '연결된 카메라를 찾지 못했습니다. 카메라를 연결한 뒤 다시 시도해 주세요.',
      state: ok ? 'done' : 'fail',
    },
    {
      title: '카메라 선택',
      desc: ok
        ? `${CAMERAS.find((c) => c.id === camera)?.name} 사용`
        : '권한 확인 후 선택할 수 있습니다.',
      state: ok ? 'done' : 'idle',
    },
    {
      title: '촬영 안내',
      desc: '상반신이 모두 보이도록 앉고, 얼굴에 역광이 생기지 않게 조명을 조정해 주세요.',
      state: ok ? 'done' : 'idle',
    },
    {
      title: '기준 자세 보정',
      desc: calibrated
        ? '기준 자세가 저장되었습니다. 이후 판정은 이 자세를 기준으로 계산됩니다.'
        : '바르게 앉은 상태에서 3초간 유지하면 개인별 기준 자세를 저장합니다.',
      state: calibrated ? 'done' : running ? 'active' : 'idle',
    },
  ] as const

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">측정 준비</h1>
          <p className="page-desc">
            체격과 카메라 거리 차이를 보정하기 위해 측정 전에 기준 자세를 한 번 저장합니다.
          </p>
        </div>
        <button className="btn" onClick={onCancel}>
          <ArrowLeft size={17} weight="bold" className="icon" />
          홈으로
        </button>
      </div>

      <div className="grid split">
        <Card title="미리보기" note="시연용 화면이라 실제 카메라를 켜지 않습니다.">
          <div className="stage">
            <PoseStage
              keypoints={POSES.upright.keypoints}
              state="good"
              confidence={ok ? 0.96 : 0}
              showSkeleton={ok}
            />
            {!ok && (
              <div
                className="stage-overlay"
                style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}
              >
                <div className="preview-block">
                  <VideoCameraSlash size={40} weight="bold" className="icon" />
                  <div className="preview-title">
                    {permission === 'denied' ? '카메라 권한 없음' : '카메라를 찾을 수 없음'}
                  </div>
                  <div style={{ fontSize: 14, color: 'var(--panel-muted)' }}>
                    {permission === 'denied'
                      ? '브라우저 설정에서 권한을 허용해 주세요.'
                      : '카메라 연결 상태를 확인해 주세요.'}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="divider" />
          <div className="stat-label" style={{ marginBottom: 10 }}>
            권한 상태 전환 (시연용)
          </div>
          <div className="segmented" role="group" aria-label="권한 상태 전환">
            {(
              [
                ['granted', '권한 허용'],
                ['denied', '권한 거부'],
                ['nodevice', '장치 없음'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                className="chip"
                aria-pressed={permission === v}
                onClick={() => setPermission(v)}
              >
                {label}
              </button>
            ))}
          </div>
        </Card>

        <div className="stack">
          <Card title="준비 단계">
            {steps.map((s, i) => (
              <div className="step" key={s.title}>
                <span
                  className={`step-mark ${s.state === 'idle' ? '' : s.state}`}
                >
                  {s.state === 'done' ? (
                    <Check size={26} weight="bold" aria-label="완료" />
                  ) : s.state === 'fail' ? (
                    <WarningCircle size={28} weight="bold" aria-label="실패" />
                  ) : (
                    i + 1
                  )}
                </span>
                <div>
                  <div className="step-title">{s.title}</div>
                  <div className="step-desc">{s.desc}</div>
                </div>
              </div>
            ))}
          </Card>

          <Card title="카메라">
            <select
              className="input"
              value={camera}
              disabled={!ok}
              onChange={(e) => setCamera(e.target.value)}
            >
              {CAMERAS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Card>

          <Card title="기준 자세 보정">
            <div className="row spread" style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>
                {calibrated
                  ? '보정 완료'
                  : running
                    ? '자세를 유지해 주세요...'
                    : `바르게 앉은 뒤 ${CALIBRATE_SECONDS}초간 유지`}
              </span>
              <span className="figure" style={{ fontSize: 26 }}>
                {Math.round(progress * 100)}%
              </span>
            </div>
            <Meter
              value={progress}
              color={calibrated ? 'var(--good-fill)' : 'var(--accent)'}
            />
            <button
              className="btn"
              style={{ width: '100%', marginTop: 12 }}
              disabled={!ok || running}
              onClick={() => {
                setProgress(0)
                setCalibrated(false)
                setRunning(true)
              }}
            >
              {calibrated ? '다시 보정' : '보정 시작'}
            </button>
          </Card>

          <button
            className="btn btn-primary btn-lg"
            disabled={!ok || !calibrated}
            onClick={onStart}
          >
            <Play size={18} weight="fill" className="icon" />
            측정 시작
          </button>

          <DemoNote>
            발표용 UI 데모입니다. 카메라를 실제로 켜지 않고 미리 정해둔 시나리오를 재생합니다.
          </DemoNote>
        </div>
      </div>
    </>
  )
}


export function SetupPage({ camera, mode, onMode, onStart, onCollect, onCancel }: {
  camera: CameraController; mode: 'camera' | 'demo'; onMode: (mode: 'camera' | 'demo') => void;
  onStart: () => void; onCollect: () => void; onCancel: () => void;
}) {
  return <>
    <div className="controls" style={{ marginBottom: 24 }}>
      <div className="segmented" role="group" aria-label="측정 입력 선택">
        <button className="chip" aria-pressed={mode === 'camera'} onClick={() => onMode('camera')}>실제 웹캠</button>
        <button className="chip" aria-pressed={mode === 'demo'} onClick={() => onMode('demo')}>발표용 시연</button>
      </div>
      <span className="stat-label">{mode === 'camera' ? 'MediaPipe + 개인 기준 비교 · LSTM 미연결' : '합성 시나리오 · 실제 카메라 미사용'}</span>
    </div>
    {mode === 'demo' ? <DemoSetupPage onStart={onStart} onCancel={onCancel} /> : <>
      <div className="page-head"><div><h1 className="page-title">측정 준비</h1><p className="page-desc">얼굴과 양쪽 어깨가 보이도록 앉고, 편안한 기준 자세를 등록하세요.</p></div><button className="btn" onClick={onCancel}><ArrowLeft size={17} weight="bold" />홈으로</button></div>
      <div className="grid split">
        <Card title="실제 웹캠 미리보기" note="MediaPipe Lite · 준비 중에는 저장하지 않습니다. 라벨 수집에서 시작하면 좌표만 기기에 저장합니다.">
          <div className="stage"><CameraStage camera={camera} /></div>
          <VisualControls camera={camera} />
          <p className="capture-note">{camera.state === 'on' ? `실제 추적 ${camera.metrics.fps.toFixed(0)} FPS · 추론 ${camera.metrics.inferenceMs.toFixed(0)}ms · ${camera.metrics.delegate}` : '연결 후 실제 추적 속도가 표시됩니다'}</p>
          <div className="controls"><span className="badge unknown">{camera.state === 'on' ? camera.quality ? '상체 감지됨' : '얼굴·양쪽 어깨 확인 필요' : '카메라 연결 필요'}</span>
            {camera.state === 'on' ? <button className="btn" onClick={camera.stop}>카메라 끄기</button> : <button className="btn btn-primary" disabled={camera.state === 'loading'} onClick={() => void camera.connect()}>{camera.state === 'loading' ? '준비 중…' : camera.state === 'error' ? '다시 연결' : '카메라 켜기'}</button>}
          </div>
          <p className="capture-note">정면 카메라용 체험 규칙입니다. 깊이 방향 자세나 거북목을 진단하지 않습니다. 카메라를 움직였다면 다시 보정하세요.</p>
        </Card>
        <div className="stack">
          <Card title="준비 단계">
            {[
              ['카메라 연결', camera.state === 'on', '권한을 허용하면 영상은 브라우저 안에서만 처리됩니다.'],
              ['얼굴과 양쪽 어깨 확인', camera.quality, '가림 없이 정면을 바라보고 편안하게 앉아주세요.'],
              ['개인 기준 등록', !!camera.baseline, '연속 5초간 상체가 감지되어야 기준 등록이 완료됩니다.'],
            ].map(([title, done, desc], i) => <div className="step" key={String(title)}><span className={`step-mark ${done ? 'done' : ''}`}>{done ? <Check size={26} weight="bold" /> : i + 1}</span><div><div className="step-title">{title}</div><div className="step-desc">{desc}</div></div></div>)}
          </Card>
          <Card title="카메라 선택"><select className="input" aria-label="실제 카메라 선택" disabled={camera.state !== 'on'} value={camera.deviceId} onChange={e => void camera.connect(e.target.value)}>{camera.devices.length ? camera.devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `카메라 ${i + 1}`}</option>) : <option value="">연결 후 장치를 확인할 수 있습니다</option>}</select></Card>
          <Card title="5초 간편 기준 등록" note="체험용 등록입니다. 연구용 20~30초 등록은 후속 단계입니다.">
            <div className="row spread"><span>{camera.baseline ? '기준 등록 완료' : camera.progress !== null ? camera.quality ? '편안한 자세를 유지해 주세요' : '상체가 보이면 처음부터 다시 등록합니다' : '등록 준비'}</span><strong className="figure">{camera.baseline ? 100 : Math.round((camera.progress ?? 0) * 100)}%</strong></div>
            <Meter value={camera.baseline ? 1 : camera.progress ?? 0} />
            <button className="btn" style={{ width: '100%', marginTop: 12 }} disabled={camera.state !== 'on' || !camera.quality || camera.progress !== null} onClick={camera.calibrate}>{camera.baseline ? '다시 보정' : '기준 등록 시작'}</button>
          </Card>
          <button className="btn btn-primary btn-lg" disabled={!camera.baseline || camera.state !== 'on'} onClick={onStart}><Play size={18} weight="fill" />측정 시작</button>
          <button className="btn btn-lg" disabled={!camera.baseline || camera.state !== 'on'} onClick={onCollect}>라벨 수집으로 이동</button>
          <DemoNote>실제 웹캠은 학습된 LSTM 대신 개인 기준과의 위치 차이를 비교합니다. 알림 기본값은 3초 지속·60초 재알림이며 설정에서 변경할 수 있습니다.</DemoNote>
        </div>
      </div>
    </>}
  </>
}
