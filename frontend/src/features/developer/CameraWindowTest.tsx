import { useEffect, useState } from 'react'
import { desktopBridge } from '../desktop/bridge'
import { CAMERA_TEST_STATE, requestCameraTest, type CameraTestState } from '../camera/cameraWindowTesting'

/** Opens the same native window with a static example; no camera or measurement needed. */
export function CameraWindowTest() {
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
      <p className="setting-desc">{!supported ? '앱 전용 기능이에요. 웹 PiP는 사용하지 않아요.' : '카메라 없이 예시 화면으로 열어요. 측정이나 저장은 하지 않아요.'}</p>
    </div>
    <div className="row dev-actions">
      <button className="chip" disabled={!supported} onClick={() => requestCameraTest('demo')}>PiP 열기</button>
      <button className="chip" disabled={!supported || !state.opened} onClick={() => requestCameraTest(state.collapsed ? 'restore' : 'collapse')}>{state.collapsed ? 'PiP 펼치기' : 'PiP 접기'}</button>
      <button className="chip" disabled={!supported || !state.opened} onClick={() => requestCameraTest('return')}>앱으로 복귀</button>
      <button className="chip" disabled={!supported || !state.opened} onClick={() => requestCameraTest('close')}>테스트 창 닫기</button>
    </div>
    {supported && <span className="fine" role="status">{state.message || (state.opened ? state.collapsed ? '작은 창 · 접힘' : '작은 창 · 열림' : '작은 창 · 닫힘')}</span>}
  </div>
}
