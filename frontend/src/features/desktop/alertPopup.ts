import type { CollapseType } from '../../data/posture'
import { COLLAPSE_HINT, COLLAPSE_TITLE } from '../session/liveView'
import { desktopBridge } from './bridge'

/** Popup text for one posture alert; the same copy as the measurement screen. */
export function alertPopupText(kind: CollapseType | null, reminder = false) {
  return {
    title: kind ? COLLAPSE_TITLE[kind] : '자세가 흐트러졌어요',
    body:
      (reminder ? '아직 자세가 돌아오지 않았어요. ' : '') +
      (kind ? COLLAPSE_HINT[kind] : '처음 등록한 편한 자세로 돌아가 볼까요?'),
  }
}

/**
 * Also shows the alert outside the app (desktop only). The main process shows the popup only
 * when the app window is covered or minimized and the setting is on; a browser tab does nothing.
 */
export function popupAlert(kind: CollapseType | null, reminder = false) {
  void desktopBridge()
    ?.showAlert?.(alertPopupText(kind, reminder))
    ?.catch(() => {})
}
