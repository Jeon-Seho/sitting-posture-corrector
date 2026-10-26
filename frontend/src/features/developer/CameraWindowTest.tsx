import { useEffect, useState } from 'react'
import { desktopBridge } from '../desktop/bridge'
import { CAMERA_TEST_STATE, requestCameraTest, type CameraTestState } from '../camera/cameraWindowTesting'

/** Uses the existing camera window; never requests another stream or ends a session. */
export function CameraWindowTest({ cameraOn }: { cameraOn: boolean }) {
  const supported = desktopBridge()?.cameraWindow === true
  const [state, setState] = useState<CameraTestState>({ opened: false, collapsed: false, message: '' })
  useEffect(() => {
    if (!supported) return
    const receive = (event: Event) => setState((event as CustomEvent<CameraTestState>).detail)
    window.addEventListener(CAMERA_TEST_STATE, receive)
    requestCameraTest('status')
    return () => window.removeEventListener(CAMERA_TEST_STATE, receive)
  }, [supported])
  return <div className="setting-row setting-row-stack">
    <div>
      <div className="setting-name">PiP · 작은 카메라 창</div>
      <p className="setting-desc">{!supported ? '앱 전용 기능이에요. 웹 PiP는 사용하지 않아요.' : !cameraOn ? '측정하기에서 카메라를 먼저 켜 주세요.' : '현재 카메라로 확인해요. 테스트 닫기는 측정을 종료하지 않아요.'}</p>
    </div>
    <div className="row dev-actions">
      <button className="chip" disabled={!supported || !cameraOn} onClick={() => requestCameraTest('open')}>PiP 열기</button>
      <button className="chip" disabled={!supported || !cameraOn || !state.opened} onClick={() => requestCameraTest(state.collapsed ? 'restore' : 'collapse')}>{state.collapsed ? 'PiP 펼치기' : 'PiP 접기'}</button>
      <button className="chip" disabled={!supported || !cameraOn || !state.opened} onClick={() => requestCameraTest('return')}>앱으로 복귀</button>
      <button className="chip" disabled={!supported || !state.opened} onClick={() => requestCameraTest('close')}>테스트 창 닫기</button>
    </div>
    {supported && <span className="fine" role="status">{state.message || (state.opened ? state.collapsed ? '작은 창 · 접힘' : '작은 창 · 열림' : '작은 창 · 닫힘')}</span>}
  </div>
}
