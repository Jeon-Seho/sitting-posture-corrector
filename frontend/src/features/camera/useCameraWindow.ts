import { useCallback, useEffect, useRef, useState } from 'react'
import type { CameraController } from '../../hooks/useCamera'

type DocumentPip = { requestWindow: (options: { width: number; height: number }) => Promise<Window> }
type PipHost = Window & { documentPictureInPicture?: DocumentPip }
type CameraMediaSession = MediaSession & { setCameraActive?: (active: boolean) => void }

export const CAMERA_WINDOW_STYLE = `
  :root { color-scheme: dark; font-family: system-ui, sans-serif; }
  body { margin: 0; background: #171714; color: #fff; }
  .camera-window-view { display: grid; gap: 10px; padding: 12px; }
  .camera-window-view h1 { font-size: 15px; margin: 0; }
  .camera-window-view video { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; transform: scaleX(-1); background: #000; }
  .camera-window-view p { margin: 0; font-size: 12px; line-height: 1.5; }
  .camera-window-view button { padding: 9px 12px; cursor: pointer; }
  .camera-window-actions { display: flex; flex-wrap: wrap; gap: 8px; }
`

/** A preview of the existing stream only; never requests another camera or changes inference refs. */
export function useCameraWindow(camera: CameraController) {
  const [pipWindow, setPipWindow] = useState<Window | null>(null)
  const [videoPip, setVideoPip] = useState(false)
  const [message, setMessage] = useState('')
  const fallbackVideo = useRef<HTMLVideoElement>(null)
  const nativeWindow = useRef<Window | null>(null)
  const generation = useRef(0)
  const pending = useRef(false)
  const documentPip = (window as PipHost).documentPictureInPicture
  const supported = !!documentPip || !!document.pictureInPictureEnabled

  const close = useCallback(() => {
    const popup = nativeWindow.current
    nativeWindow.current = null
    popup?.close()
    setPipWindow(null)
    if (fallbackVideo.current && document.pictureInPictureElement === fallbackVideo.current)
      void document.exitPictureInPicture().catch(() => {})
    setVideoPip(false)
  }, [])

  useEffect(() => {
    if (camera.state !== 'on') {
      close()
      setMessage('')
    }
    // Cancel an opening request on disconnect/reconnect, even if it resolves after a new stream starts.
    return () => {
      generation.current++
      const popup = nativeWindow.current
      nativeWindow.current = null
      popup?.close()
      if (fallbackVideo.current && document.pictureInPictureElement === fallbackVideo.current)
        void document.exitPictureInPicture().catch(() => {})
    }
  }, [camera.state, close])

  useEffect(() => {
    const video = fallbackVideo.current
    if (camera.state !== 'on' || !video) return
    video.srcObject = camera.streamRef.current
    void video.play().catch(() => {})
    const left = () => setVideoPip(false)
    video.addEventListener('leavepictureinpicture', left)
    return () => {
      video.removeEventListener('leavepictureinpicture', left)
      if (document.pictureInPictureElement === video)
        void document.exitPictureInPicture().catch(() => {})
      video.srcObject = null
    }
  }, [camera.state, camera.streamRef])

  const open = useCallback(async () => {
    const stream = camera.streamRef.current
    if (camera.state !== 'on' || !stream || pending.current) return
    if (nativeWindow.current && !nativeWindow.current.closed) {
      nativeWindow.current.focus()
      return
    }
    if (document.pictureInPictureElement === fallbackVideo.current && fallbackVideo.current) return
    const token = generation.current
    pending.current = true
    setMessage('')
    try {
      const api = (window as PipHost).documentPictureInPicture
      if (api) {
        const popup = await api.requestWindow({ width: 360, height: 390 })
        if (token !== generation.current || camera.streamRef.current !== stream) {
          popup.close()
          return
        }
        popup.document.title = 'PoseGood · 카메라 작은 창'
        const style = popup.document.createElement('style')
        style.textContent = CAMERA_WINDOW_STYLE
        popup.document.head.appendChild(style)
        nativeWindow.current = popup
        popup.addEventListener('pagehide', () => {
          if (nativeWindow.current !== popup) return
          nativeWindow.current = null
          setPipWindow(null)
        }, { once: true })
        setPipWindow(popup)
      } else {
        const video = fallbackVideo.current
        if (!document.pictureInPictureEnabled || !video?.requestPictureInPicture)
          throw new Error('unsupported')
        if (video.readyState === 0) {
          setMessage('카메라 영상이 준비되면 작은 창 열기를 다시 눌러 주세요.')
          return
        }
        await video.requestPictureInPicture()
        if (token !== generation.current || camera.streamRef.current !== stream) {
          if (document.pictureInPictureElement === video)
            await document.exitPictureInPicture()
          return
        }
        setVideoPip(true)
      }
    } catch {
      setMessage('작은 창을 열지 못했습니다. Chrome에서 버튼을 직접 눌러 주세요. 앱 탭은 열어 두세요.')
    } finally {
      pending.current = false
    }
  }, [camera.state, camera.streamRef])

  // Supported browsers may invoke this when switching tabs; browser permissions decide auto PiP.
  useEffect(() => {
    const session = typeof navigator !== 'undefined' ? navigator.mediaSession as CameraMediaSession : undefined
    if (camera.state !== 'on' || !session || !documentPip) return
    try {
      session.setActionHandler('enterpictureinpicture' as MediaSessionAction, () => { void open() })
      session.setCameraActive?.(true)
    } catch { /* Manual opening remains available when automatic PiP is unsupported. */ }
    return () => {
      try {
        session.setCameraActive?.(false)
        session.setActionHandler('enterpictureinpicture' as MediaSessionAction, null)
      } catch { /* Unsupported action. */ }
    }
  }, [camera.state, documentPip, open])

  return { pipWindow, videoPip, fallbackVideo, supported, message, open, close }
}
