import { useEffect, useState } from 'react'
import type { CameraController } from '../../hooks/useCamera'
import { desktopBridge } from './bridge'

/**
 * The small window's own page. The bar stays visible and is the drag handle: in the desktop shell
 * a drag region takes the mouse, so a bar that appears on hover could not be grabbed reliably.
 */
export const DESKTOP_CAMERA_WINDOW_STYLE = `
  :root { color-scheme: dark; font-family: system-ui, sans-serif; }
  body { margin: 0; background: #171714; color: #fff; overflow: hidden; user-select: none; }
  .camera-window-view { position: relative; height: 100vh; }
  .camera-window-view video { display: block; width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); background: #000; }
  .camera-window-bar { position: absolute; inset: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
    gap: 8px; padding: 8px 8px 20px 10px; background: linear-gradient(rgb(0 0 0 / 0.55), transparent); -webkit-app-region: drag; }
  .camera-window-view.is-minimized .camera-window-bar { position: static; padding-bottom: 8px; background: none; }
  .camera-window-label { font-size: 12px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .camera-window-label::before { content: ''; display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 50%; background: #5fae7c; }
  .camera-window-view.status-alert { box-shadow: inset 0 0 0 3px #d0505a; }
  .camera-window-view.status-alert .camera-window-label::before { background: #d0505a; }
  .camera-window-view.status-unknown .camera-window-label::before,
  .camera-window-view.status-paused .camera-window-label::before { background: #9a9389; }
  .camera-window-tools { display: inline-flex; gap: 4px; -webkit-app-region: no-drag; }
  .camera-window-tools button { display: inline-grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 50%;
    background: rgb(0 0 0 / 0.35); color: #fff; cursor: pointer; }
  .camera-window-tools button:hover { background: rgb(0 0 0 / 0.6); }
`

/**
 * Desktop app only (ADR 0028, plan 0055): opens the small camera window while the camera is on and
 * `wanted`, and closes it otherwise. The shell decides when it is visible (app covered or minimized).
 * The page draws into it with a portal, so the same stream is shown; no new camera request.
 */
export function useDesktopCameraWindow(camera: CameraController, wanted: boolean) {
  const [popup, setPopup] = useState<Window | null>(null)
  const name = desktopBridge()?.cameraWindow?.name
  useEffect(() => {
    if (!wanted || camera.state !== 'on' || !name) return
    const opened = window.open('about:blank', name)
    if (!opened) return
    opened.document.title = 'PoseGood · 카메라 작은 창'
    const style = opened.document.createElement('style')
    style.textContent = DESKTOP_CAMERA_WINDOW_STYLE
    opened.document.head.appendChild(style)
    // Closed from outside (e.g. Alt+F4): stays closed until the camera starts again.
    const gone = () => setPopup((current) => (current === opened ? null : current))
    opened.addEventListener('pagehide', gone)
    setPopup(opened)
    return () => {
      opened.removeEventListener('pagehide', gone)
      opened.close()
      setPopup(null)
    }
  }, [wanted, camera.state, name])
  return popup
}
