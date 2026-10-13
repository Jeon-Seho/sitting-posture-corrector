import { desktopBridge } from './bridge'

/**
 * Popup text for one posture alert. The posture type is not shown (ADR 0021), so the copy
 * matches the in-app toast.
 */
export function alertPopupText(reminder = false) {
  return {
    title: reminder ? '흐트러진 자세가 이어지고 있어요' : '자세가 흐트러졌어요',
    body: reminder
      ? '아직 자세가 돌아오지 않았어요. 처음 등록한 편한 자세로 돌아가 볼까요?'
      : '처음 등록한 편한 자세로 돌아가 볼까요?',
  }
}

/**
 * Also shows the alert outside the app (desktop only). The main process shows the popup only
 * when the app window is covered or minimized and the setting is on; a browser tab does nothing.
 */
export function popupAlert(reminder = false) {
  void desktopBridge()
    ?.showAlert?.(alertPopupText(reminder))
    ?.catch(() => {})
}
