import { useEffect, useState } from 'react'
import { desktopBridge } from '../desktop/bridge'
import { CAMERA_TEST_STATE, requestCameraTest, type CameraTestState } from '../camera/cameraWindowTesting'

/** Uses the shared camera controller and window; never opens a second stream or ends a session. */
export function CameraWindowTest({ cameraOn, cameraLoading = false, cameraError = '', onConnect }: {
  cameraOn: boolean
  cameraLoading?: boolean
  cameraError?: string
  onConnect?: () => Promise<void>
}) {
  const supported = desktopBridge()?.cameraWindow === true
  const [state, setState] = useState<CameraTestState>({ opened: false, collapsed: false, message: '' })
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState('')
  const busy = connecting || cameraLoading
  async function connect() {
    if (!supported || busy || !onConnect) return
    setConnecting(true)
    setConnectError('')
    try { await onConnect() }
    catch { setConnectError('카메라를 켜지 못했어요. 권한과 연결을 확인한 뒤 다시 시도해 주세요.') }
    finally { setConnecting(false) }
  }
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
      <p className="setting-desc">{!supported ? '앱 전용 기능이에요. 웹 PiP는 사용하지 않아요.' : busy ? '카메라를 준비 중이에요. 권한 요청이 나오면 허용해 주세요.' : !cameraOn ? '카메라를 켠 다음 PiP 열기를 눌러 주세요. 측정을 시작하지 않아도 테스트할 수 있어요.' : '현재 카메라로 확인해요. 테스트 닫기는 측정을 종료하지 않아요.'}</p>
    </div>
    <div className="row dev-actions">
      {supported && !cameraOn && onConnect && <button className="chip" disabled={busy} onClick={() => void connect()}>{busy ? '카메라 준비 중…' : cameraError || connectError ? '카메라 다시 연결' : '테스트 카메라 켜기'}</button>}
      <button className="chip" disabled={!supported || !cameraOn} onClick={() => requestCameraTest('open')}>PiP 열기</button>
      <button className="chip" disabled={!supported || !cameraOn || !state.opened} onClick={() => requestCameraTest(state.collapsed ? 'restore' : 'collapse')}>{state.collapsed ? 'PiP 펼치기' : 'PiP 접기'}</button>
      <button className="chip" disabled={!supported || !cameraOn || !state.opened} onClick={() => requestCameraTest('return')}>앱으로 복귀</button>
      <button className="chip" disabled={!supported || !state.opened} onClick={() => requestCameraTest('close')}>테스트 창 닫기</button>
    </div>
    {supported && !cameraOn && (cameraError || connectError) && <p className="fine" role="alert">{cameraError || connectError}</p>}
    {supported && <span className="fine" role="status">{state.message || (state.opened ? state.collapsed ? '작은 창 · 접힘' : '작은 창 · 열림' : '작은 창 · 닫힘')}</span>}
  </div>
}
