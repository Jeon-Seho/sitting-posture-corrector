import { useCallback, useEffect, useRef, useState } from 'react'
import type { CameraController } from '../../hooks/useCamera'
import { desktopBridge } from '../desktop/bridge'

export const CAMERA_WINDOW_STYLE = `
  :root { color-scheme:dark; font-family:system-ui,sans-serif; }
  body { margin:0; background:#111; color:#fff; overflow:hidden; }
  .camera-window-view { position:relative; height:100vh; background:#111; -webkit-app-region:drag; }
  .camera-window-view video { display:block; width:100%; height:100%; object-fit:contain; transform:scaleX(-1); }
  .camera-window-bar { position:absolute; inset:0; background:linear-gradient(#0009,transparent 40%,transparent 65%,#0008); opacity:0; transition:opacity 180ms ease-out; pointer-events:none; }
  .camera-window-view:hover .camera-window-bar, .camera-window-view:focus-within .camera-window-bar,
  .camera-window-view.is-minimized .camera-window-bar, .camera-window-view.status-alert .camera-window-bar { opacity:1; }
  .camera-window-label { position:absolute; bottom:12px; left:12px; font-size:12px; font-weight:600; text-shadow:0 1px 3px #000; }
  .camera-window-label::before { content:''; display:inline-block; width:6px; height:6px; margin-right:6px; border-radius:50%; background:#52c58c; }
  .camera-window-tools { position:absolute; top:8px; right:8px; display:flex; gap:4px; pointer-events:auto; -webkit-app-region:no-drag; }
  .camera-window-tools button { display:grid; place-items:center; width:32px; height:32px; border:0; border-radius:50%; background:#0007; color:white; cursor:pointer; }
  .camera-window-tools button:hover { background:#000c; }
  .camera-window-tools button:focus-visible { outline:2px solid white; outline-offset:2px; }
  .camera-window-view.is-minimized .camera-window-bar { background:#171717; }
  .camera-window-view.is-minimized .camera-window-label { bottom:16px; }
  .camera-window-view.status-alert { box-shadow:inset 0 0 0 3px #E5484D; }
  .status-alert .camera-window-label::before { background:#E5484D; }
  .status-unknown .camera-window-label::before, .status-paused .camera-window-label::before { background:#b7bec3; }
  .camera-window-demo { height:100%; display:grid; place-content:center; justify-items:center; gap:12px; background:#18212a; }
  .camera-window-demo img { width:90px; height:100px; object-fit:contain; }
  .camera-window-demo p { margin:0; font-size:12px; color:#cbd5df; }
  .posegood-icon img { filter:grayscale(1) brightness(0) invert(1); }
  @media(prefers-reduced-motion:reduce) { * { transition:none!important; } }
`

/** Same-origin native child window, with the existing camera stream rendered through a portal. */
export function useCameraWindow(camera: CameraController, demo = false) {
  const [pipWindow, setPipWindow] = useState<Window | null>(null)
  const [message, setMessage] = useState('')
  const nativeWindow = useRef<Window | null>(null)
  const opening = useRef(false)
  const generation = useRef(0)
  const bridge = desktopBridge()
  const supported = bridge?.cameraWindow === true
  const stream = demo ? null : camera.streamRef.current
  const ready = demo || camera.state === 'on'
  const close = useCallback(() => {
    const child = nativeWindow.current
    nativeWindow.current = null
    child?.close()
    setPipWindow(null)
  }, [])
  const open = useCallback(async () => {
    if (!supported || !ready || (!demo && !stream) || opening.current) return
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
      child = window.open('about:blank', 'posegood-camera', 'width=400,height=225')
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
  }, [supported, bridge, ready, demo, stream])
  useEffect(() => {
    if (!supported) return
    const remove = !demo ? bridge?.onCameraWindowRequested?.(() => { void open() }) : undefined
    void bridge?.setCameraWindowEnabled?.(ready).catch(() => {
      setMessage('작은 창을 준비하지 못했어요. 다시 눌러 주세요.')
    })
    if (!ready) { close(); setMessage('') }
    return () => {
      generation.current++
      remove?.()
      close()
      void bridge?.setCameraWindowEnabled?.(false).catch(() => {})
    }
  }, [supported, bridge, ready, demo, stream, open, close])
  return { pipWindow, supported, message, open, close }
}
