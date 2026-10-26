import { useCallback, useEffect, useRef, useState } from 'react'
import type { CameraController } from '../../hooks/useCamera'
import { desktopBridge } from '../desktop/bridge'

export const CAMERA_WINDOW_STYLE = `
  :root { color-scheme: dark; font-family: system-ui, sans-serif; }
  body { margin: 0; background: #21332c; color: #f1f2e9; overflow: hidden; }
  .camera-window-view { position: relative; height: 100vh; display: flex; flex-direction: column; }
  .camera-window-view video { display: block; width: 100%; height: calc(100% - 44px); order: 2; object-fit: contain; transform: scaleX(-1); background: #000; }
  .camera-window-bar { position: relative; flex: 0 0 44px; box-sizing: border-box; -webkit-app-region: drag; display: flex; align-items: center; justify-content: space-between;
    gap: 8px; padding: 4px 8px 4px 10px; background: #192a23; opacity: 1; }
  .camera-window-view:hover .camera-window-bar, .camera-window-view:focus-within .camera-window-bar,
  .camera-window-view.is-minimized .camera-window-bar { opacity: 1; }
  .camera-window-view.is-minimized .camera-window-bar { position: static; padding-bottom: 4px; background: none; }
  .camera-window-label { font-size: 12px; font-weight: 700; }
  .camera-window-label::before { content: ''; display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 50%; background: #5fae7c; }
  .camera-window-view.status-alert { box-shadow: inset 0 0 0 3px #d0505a; }
  .camera-window-view.status-alert .camera-window-bar { opacity: 1; }
  .camera-window-view.status-alert .camera-window-label::before { background: #d0505a; }
  .camera-window-view.status-unknown .camera-window-label::before,
  .camera-window-view.status-paused .camera-window-label::before { background: #9a9389; }
  .camera-window-tools { display: inline-flex; gap: 4px; }
  .camera-window-tools button { display: inline-grid; place-items: center; width: 36px; height: 36px; -webkit-app-region: no-drag; border: 0; border-radius: 50%;
    background: rgb(0 0 0 / 0.35); color: #fff; cursor: pointer; }
  .camera-window-tools button:hover { background: rgb(0 0 0 / 0.6); }
  .posegood-icon img { filter: grayscale(1) brightness(0) invert(.88); }
`

/** Same-origin native child window, with the existing camera stream rendered through a portal. */
export function useCameraWindow(camera: CameraController) {
  const [pipWindow, setPipWindow] = useState<Window | null>(null)
  const [message, setMessage] = useState('')
  const nativeWindow = useRef<Window | null>(null)
  const opening = useRef(false)
  const generation = useRef(0)
  const bridge = desktopBridge()
  const supported = bridge?.cameraWindow === true
  const stream = camera.streamRef.current
  const close = useCallback(() => {
    const child = nativeWindow.current
    nativeWindow.current = null
    child?.close()
    setPipWindow(null)
  }, [])
  const open = useCallback(async () => {
    if (!supported || camera.state !== 'on' || !stream || opening.current) return
    if (nativeWindow.current && !nativeWindow.current.closed) {
      await bridge?.showCameraWindow?.()
      return
    }
    opening.current = true
    const token = generation.current
    let child: Window | null = null
    setMessage('')
    try {
      if (!await bridge?.setCameraWindowEnabled?.(true)) throw new Error('unavailable')
      if (token !== generation.current) return
      child = window.open('about:blank', 'posegood-camera', 'width=360,height=314')
      if (!child) throw new Error('blocked')
      if (token !== generation.current) { child.close(); return }
      child.document.title = 'PoseGood · 카메라 작은 창'
      const style = child.document.createElement('style')
      style.textContent = CAMERA_WINDOW_STYLE
      child.document.head.appendChild(style)
      nativeWindow.current = child
      const opened = child
      child.addEventListener('pagehide', () => {
        if (nativeWindow.current !== opened) return
        nativeWindow.current = null
        setPipWindow(null)
      }, { once: true })
      setPipWindow(child)
    } catch {
      child?.close()
      setMessage('작은 창을 열지 못했어요. 다시 눌러 주세요.')
    } finally {
      opening.current = false
    }
  }, [supported, bridge, camera.state, stream])
  useEffect(() => {
    if (!supported) return
    const remove = bridge?.onCameraWindowRequested?.(() => { void open() })
    void bridge?.setCameraWindowEnabled?.(camera.state === 'on').catch(() => {
      setMessage('작은 창을 준비하지 못했어요. 다시 눌러 주세요.')
    })
    if (camera.state !== 'on') { close(); setMessage('') }
    return () => {
      generation.current++
      remove?.()
      close()
      void bridge?.setCameraWindowEnabled?.(false).catch(() => {})
    }
  }, [supported, bridge, camera.state, stream, open, close])
  return { pipWindow, supported, message, open, close }
}
