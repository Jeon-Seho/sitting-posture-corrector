import { CameraFaultTests } from '../features/developer/CameraFaultTests'
import { useState } from 'react'
import { Switch } from '../components/ui'
import { AppearanceDiagnostics } from '../features/appearance/AppearanceSettings'
import { TrackingRateCheck } from '../features/camera/TrackingRateCheck'
import { reportConnectionLost } from '../features/connection/connectionLost'
import { CameraWindowTest } from '../features/developer/CameraWindowTest'
import { DeveloperGroup, InteractionPreview } from '../features/developer/DeveloperGroup'
import { AlertPreview } from '../features/desktop/AlertPreview'
import { checkCameraPerformance, reportPerformance } from '../features/camera/acceleration'
import { CAMERA_ERRORS } from '../features/camera/errors'
import { desktopBridge } from '../features/desktop/bridge'
import type { CameraController } from '../hooks/useCamera'
import type { ReactNode } from 'react'

function Row({ name, desc, children }: { name: string; desc: string; children: ReactNode }) {
  return <div className="setting-row"><div><div className="setting-name">{name}</div><p className="setting-desc">{desc}</p></div>{children}</div>
}

export function DeveloperToolsPage({ camera, hasHistory, onHasHistory, onCollect }: {
  camera: CameraController
  hasHistory: boolean
  onHasHistory: (enabled: boolean) => void
  onCollect: () => void
}) {
  const [errorPreview, setErrorPreview] = useState('')
  const errorLabels: Record<keyof typeof CAMERA_ERRORS, string> = { unsupported: '지원하지 않는 환경', preparationTimeout: '준비 시간 초과', videoUnavailable: '영상 준비 실패', disconnected: '연결 끊김', trackingFailed: '추적 실패', permissionDenied: '권한 거부', deviceMissing: '카메라 없음', deviceBusy: '다른 앱에서 사용 중', deviceUnavailable: '선택 카메라 사용 불가', preparationFailed: '모델·카메라 로드 실패' }
  return <>
    <div className="page-head"><div><h1 className="page-title">개발자 도구</h1><p className="page-desc">개발자 계정 전용 테스트와 진단입니다. 각 항목을 펼쳐 실행하세요.</p></div></div>
    <div className="dev-tools">
      <DeveloperGroup title="그래픽 가속·CPU 전환">
        <p className="fine">현재 카메라: {camera.state} · {camera.metrics.delegate} · {camera.metrics.fps.toFixed(1)} FPS · 추론 {camera.metrics.inferenceMs.toFixed(1)} ms</p>
        <p className="fine">안내 확인은 팝업만 재현합니다. 실제 GPU 오류를 발생시키거나 CPU로 강제 전환하지 않습니다.</p>
        {desktopBridge() ? <p>그래픽 가속 안내는 웹 브라우저에서 확인하세요.</p> : <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="chip" onClick={checkCameraPerformance}>웹 그래픽 가속 확인</button>
          <button className="chip" onClick={() => reportPerformance('limited', true)}>가속 제한 안내</button>
          <button className="chip" onClick={() => reportPerformance('cpu', true)}>CPU 전환 안내</button>
          <button className="chip" onClick={() => reportPerformance('unknown', true)}>가속 확인 불가 안내</button>
        </div>}
      </DeveloperGroup>
      <DeveloperGroup title="GPU·CPU 실패 흐름 재현"><CameraFaultTests /></DeveloperGroup>
      <DeveloperGroup title="카메라 오류 안내">
        <p className="fine">실제 오류 안내 문구를 미리 봅니다. 카메라 연결 상태는 바꾸지 않습니다.</p>
        <div className="row" style={{ flexWrap: 'wrap' }}>{Object.entries(CAMERA_ERRORS).map(([key, message]) => <button className="chip" key={key} onClick={() => setErrorPreview(message)}>{errorLabels[key as keyof typeof CAMERA_ERRORS]}</button>)}</div>
        {errorPreview && <p role="status">{errorPreview}</p>}
        <button className="chip" onClick={() => setErrorPreview('')}>안내 지우기</button>
      </DeveloperGroup>
              <DeveloperGroup title="기록·데이터">
                <Row
                  name="발표용 예시 기록 표시"
                  desc={`켜면 오늘·기록 화면에 발표용 예시 기록을, 끄면 이 기기에 저장된 실제 측정 기록을 보여줘요.`}
                >
                  <Switch checked={hasHistory} onChange={onHasHistory} label="발표용 예시 기록 표시" />
                </Row>
                {onCollect && (
                  <Row name="자세 데이터 수집" desc="연구용 라벨 촬영 화면이에요. 관절 위치만 CSV로 저장해요.">
                    <button className="chip" onClick={onCollect}>
                      자세 데이터 수집
                    </button>
                  </Row>
                )}
              </DeveloperGroup>
              <DeveloperGroup title="카메라·작은 창">
                <CameraWindowTest />
                {camera && (
                  <div className="setting-row setting-row-stack">
                    <div>
                      <div className="setting-name">추적 속도</div>
                      <div className="setting-desc">
                        스켈레톤이 떨리면 떨림 점검으로 이 PC에 맞는 속도를 찾아요. 카메라를 켜고 가만히 앉은 채로 눌러 주세요.
                      </div>
                    </div>
                    <TrackingRateCheck camera={camera} />
                  </div>
                )}
              </DeveloperGroup>
              <DeveloperGroup title="화면·모션·알림">
                  <AppearanceDiagnostics />
                  <InteractionPreview />
                  <AlertPreview />
              </DeveloperGroup>
              <DeveloperGroup title="연결·진단">
                <Row
                  name="서버 연결 끊김 화면"
                  desc="연결 끊김 안내를 미리 봅니다. 테스트 종료로 돌아올 수 있으며 실제 연결 상태는 바꾸지 않습니다."
                >
                  <button className="chip" onClick={() => reportConnectionLost({ reason: 'test' })}>
                    끊김 화면 확인
                  </button>
                </Row>
              </DeveloperGroup>
              <DeveloperGroup title="버전 정보">
                <div className="setting-row">
                  <div className="setting-name">판정 방식</div>
                  <span className="mono">서버 판정 · 기준 자세 REST 등록</span>
                </div>
                <div className="setting-row">
                  <div className="setting-name">전처리</div>
                  <span className="mono">관절 좌표 전송 · 서버에서 계산</span>
                </div>
                <div className="setting-row">
                  <div className="setting-name">관절 추출</div>
                  <span className="mono">MediaPipe Pose (client)</span>
                </div>
              </DeveloperGroup>
    </div>
  </>
}
