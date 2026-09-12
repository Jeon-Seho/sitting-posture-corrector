import { useEffect, useRef, useState } from 'react'
import { POSES } from '../data/posture'
import { PoseStage } from '../components/PoseStage'
import { Card, DemoNote, Meter } from '../components/ui'

type Permission = 'granted' | 'denied' | 'nodevice'

const CAMERAS = [
  { id: 'cam-builtin', name: '내장 웹캠 (720p)' },
  { id: 'cam-usb', name: 'USB 웹캠 (1080p)' },
]

const CALIBRATE_SECONDS = 3

export function SetupPage({ onStart, onCancel }: { onStart: () => void; onCancel: () => void }) {
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
          홈으로
        </button>
      </div>

      <div className="grid g2" style={{ alignItems: 'start' }}>
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
                <div>
                  <div style={{ fontWeight: 650, marginBottom: 4 }}>
                    {permission === 'denied' ? '카메라 권한 없음' : '카메라를 찾을 수 없음'}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {permission === 'denied'
                      ? '브라우저 설정에서 권한을 허용해 주세요.'
                      : '카메라 연결 상태를 확인해 주세요.'}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="divider" />
          <div className="stat-label" style={{ marginBottom: 6 }}>
            권한 상태 전환 (시연용)
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
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

        <div style={{ display: 'grid', gap: 14 }}>
          <Card title="준비 단계">
            {steps.map((s, i) => (
              <div className="step" key={s.title}>
                <span
                  className={`step-mark ${s.state === 'idle' ? '' : s.state}`}
                >
                  {s.state === 'done' ? '✓' : s.state === 'fail' ? '!' : i + 1}
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
              <span className="muted" style={{ fontSize: 12 }}>
                {calibrated
                  ? '보정 완료'
                  : running
                    ? '자세를 유지해 주세요...'
                    : `바르게 앉은 뒤 ${CALIBRATE_SECONDS}초간 유지`}
              </span>
              <span className="num" style={{ fontSize: 12 }}>
                {Math.round(progress * 100)}%
              </span>
            </div>
            <Meter
              value={progress}
              color={calibrated ? 'var(--good)' : 'var(--accent)'}
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
