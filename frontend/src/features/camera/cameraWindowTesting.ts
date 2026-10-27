export const CAMERA_TEST_EVENT = 'posegood:camera-window-test'
export const CAMERA_TEST_STATE = 'posegood:camera-window-test-state'
export type CameraTestAction = 'status' | 'demo' | 'open' | 'collapse' | 'restore' | 'return' | 'close'
export type CameraTestState = { opened: boolean; collapsed: boolean; message: string }
export function requestCameraTest(action: CameraTestAction) {
  window.dispatchEvent(new CustomEvent(CAMERA_TEST_EVENT, { detail: action }))
}
export function publishCameraTest(state: CameraTestState) {
  window.dispatchEvent(new CustomEvent(CAMERA_TEST_STATE, { detail: state }))
}
