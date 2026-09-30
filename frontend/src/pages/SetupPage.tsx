import { VisualControls } from '../components/VisualControls'
import { ArrowLeft, Check, Play } from '@phosphor-icons/react'
import { CameraStage } from '../components/CameraStage'
import type { CameraController } from '../hooks/useCamera'
import { Card, DemoNote, Meter } from '../components/ui'

export function SetupPage({ camera, onStart, onCollect, onCancel, startLabel = '측정 시작' }: {
  startLabel?: string
  camera: CameraController;
  onStart: () => void; onCollect: () => void; onCancel: () => void;
}) {
  return <>
    <div className="controls" style={{ marginBottom: 24 }}>
      <span className="stat-label">MediaPipe + 개인 기준 비교 · LSTM 미연결</span>
    </div>
    <>
      <div className="page-head"><div><h1 className="page-title">측정 준비</h1><p className="page-desc">얼굴과 양쪽 어깨가 보이도록 앉고, 편안한 기준 자세를 등록하세요.</p></div><button className="btn" onClick={onCancel}><ArrowLeft size={17} weight="bold" />홈으로</button></div>
      <div className="grid split">
        <Card title="실제 웹캠 미리보기" note="MediaPipe Lite · 영상은 저장하거나 전송하지 않습니다. 자세 등록에서 직접 촬영한 관절·라벨은 CSV로 내려받을 수 있습니다.">
          <div className="stage"><CameraStage camera={camera} /></div>
          <VisualControls camera={camera} />
          <p className="capture-note">{camera.state === 'on' ? `실제 추적 ${camera.metrics.fps.toFixed(0)} FPS · 추론 ${camera.metrics.inferenceMs.toFixed(0)}ms · ${camera.metrics.delegate}` : '연결 후 실제 추적 속도가 표시됩니다'}</p>
          <div className="controls"><span className="badge unknown">{camera.state === 'on' ? camera.quality ? '상체 감지됨' : '얼굴·양쪽 어깨 확인 필요' : '카메라 연결 필요'}</span>
            {camera.state === 'on' ? <button className="btn" onClick={camera.stop}>카메라 끄기</button> : camera.state === 'loading' ? <button className="btn" onClick={camera.stop}>카메라 준비 취소</button> : <button className="btn btn-primary" onClick={() => void camera.connect()}>{camera.state === 'error' ? '다시 연결' : '카메라 켜기'}</button>}
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
            <div className="row spread"><span>{camera.progress !== null ? camera.quality ? '편안한 자세를 유지해 주세요' : '상체가 보이면 처음부터 다시 등록합니다' : camera.baseline ? '기준 등록 완료' : '등록 준비'}</span><strong className="figure">{Math.round((camera.progress ?? (camera.baseline ? 1 : 0)) * 100)}%</strong></div>
            <Meter value={camera.progress ?? (camera.baseline ? 1 : 0)} />
            <button className="btn" style={{ width: '100%', marginTop: 12 }} disabled={camera.state !== 'on' || !camera.quality || camera.progress !== null} onClick={camera.calibrate}>{camera.baseline ? '다시 보정' : '기준 등록 시작'}</button>
            {camera.progress !== null && <><p className="fine">{camera.baseline ? '새 기준이 완성될 때까지 기존 기준을 유지합니다.' : '유효한 상체 입력을 연속으로 수집합니다.'}</p><button className="btn" onClick={camera.cancelCalibration}>보정 취소</button></>}
          </Card>
          <button className="btn btn-primary btn-lg" disabled={!camera.baseline || camera.state !== 'on' || !camera.quality || camera.progress !== null} onClick={onStart}><Play size={18} weight="fill" />{startLabel}</button>
          <button className="btn btn-lg" disabled={!camera.baseline || camera.state !== 'on' || camera.progress !== null} onClick={onCollect}>자세 등록으로 이동</button>
          <DemoNote>실제 웹캠은 학습된 LSTM 대신 개인 기준과의 위치 차이를 비교합니다. 알림 기본값은 3초 지속·60초 재알림이며 설정에서 변경할 수 있습니다.</DemoNote>
        </div>
      </div>
    </>
  </>
}
