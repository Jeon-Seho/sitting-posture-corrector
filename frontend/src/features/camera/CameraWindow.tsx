import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowsOutSimple, Minus, Square, X } from '../../components/icons'
import { createPortal } from 'react-dom'
import type { CameraController } from '../../hooks/useCamera'
import {
  endRunningMeasurement,
  useMeasurementStatus,
  WINDOW_END_REASON,
  type MeasurementStatus,
} from '../session/sessionControl'
import { useCameraWindow } from './useCameraWindow'
import { desktopBridge } from '../desktop/bridge'
import { CAMERA_TEST_EVENT, publishCameraTest, type CameraTestAction } from './cameraWindowTesting'

function StreamPreview({ camera }: { camera: CameraController }) {
  const preview = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = preview.current
    if (!video) return
    video.srcObject = camera.streamRef.current
    void video.play().catch(() => {})
    return () => { video.srcObject = null }
  }, [camera.streamRef])
  return <video ref={preview} autoPlay muted playsInline aria-label="작은 창 웹캠 미리보기" />
}

/** The dot and words beside it: the posture of the running measurement (2026-10-20). */
const STATUS_TEXT: Record<MeasurementStatus | 'camera', string> = {
  camera: '카메라 사용 중',
  good: '바른 자세예요',
  alert: '자세가 흐트러졌어요',
  unknown: '자세를 확인할 수 없어요',
  paused: '쉬는 중',
}

type Controls = {
  status: MeasurementStatus | 'camera'
  minimized: boolean
  onMinimize: () => void
  /** Back to 측정하기, wherever the app is. Absent on the collection screen. */
  onExpand?: () => void
  /** While measuring: end and save (2026-10-20). Otherwise: close the window only. */
  onClose: () => void
  measuring: boolean
  /** The draggable label; the native window is moved through its OS drag region. */
  label: (text: string) => ReactNode
}

/**
 * The bar of a picture-in-picture style window, like YouTube's: minimize (hide the video, keep
 * measuring), expand (back to the measurement) and close. Playback controls do not apply here.
 */
function PipBar({ status, minimized, onMinimize, onExpand, onClose, measuring, label }: Controls) {
  return (
    <div className="camera-window-bar">
      {label(STATUS_TEXT[status])}
      <span className="camera-window-tools">
        <button aria-label={minimized ? '영상 보이기' : '최소화'} title={minimized ? '영상 보이기' : '최소화'} onClick={onMinimize}>
          {minimized ? <Square size={14} weight="bold" aria-hidden="true" /> : <Minus size={16} weight="bold" aria-hidden="true" />}
        </button>
        {onExpand && (
          <button aria-label="측정 화면으로 돌아가기" title="측정 화면으로 돌아가기" onClick={onExpand}>
            <ArrowsOutSimple size={16} weight="bold" aria-hidden="true" />
          </button>
        )}
        <button aria-label={measuring ? '측정 종료' : '작은 창 닫기'} title={measuring ? '측정 종료·저장' : '닫기'} onClick={onClose}>
          <X size={16} weight="bold" aria-hidden="true" />
        </button>
      </span>
    </div>
  )
}

/** Inside the frameless native child window, shown over other applications. */
function WindowPreview({ camera, controls }: { camera: CameraController; controls: Omit<Controls, 'label'> }) {
  useEffect(() => { void desktopBridge()?.showCameraWindow?.() }, [])
  return (
    <section className={`camera-window-view ${controls.minimized ? 'is-minimized' : ''} status-${controls.status}`} aria-label="카메라 작은 창">
      {!controls.minimized && <StreamPreview camera={camera} />}
      <PipBar {...controls} label={(text) => <span className="camera-window-label" role="status">{text}</span>} />
    </section>
  )
}

/**
 * The same window inside the app (another tab of PoseGood): drag it anywhere; the bar appears on
 * hover or focus, and stays while minimized.
 */
function FloatingPreview({ camera, controls }: { camera: CameraController; controls: Omit<Controls, 'label'> }) {
  const panel = useRef<HTMLElement>(null)
  const drag = useRef<{ pointer: number; dx: number; dy: number } | null>(null)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const move = (x: number, y: number) => {
    const rect = panel.current?.getBoundingClientRect()
    if (!rect) return
    setPosition({
      x: Math.max(0, Math.min(x, Math.max(0, window.innerWidth - rect.width))),
      y: Math.max(0, Math.min(y, Math.max(0, window.innerHeight - rect.height))),
    })
  }
  useEffect(() => {
    const resized = () => {
      const rect = panel.current?.getBoundingClientRect()
      if (rect) move(rect.x, rect.y)
    }
    window.addEventListener('resize', resized)
    return () => window.removeEventListener('resize', resized)
  }, [])
  function begin(event: PointerEvent<HTMLElement>) {
    // The bar's buttons click; anywhere else on the window drags it.
    if (event.button !== 0 || (event.target as HTMLElement).closest('.camera-window-tools')) return
    const rect = panel.current?.getBoundingClientRect()
    if (!rect) return
    drag.current = { pointer: event.pointerId, dx: event.clientX - rect.x, dy: event.clientY - rect.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function keyboardMove(event: KeyboardEvent<HTMLButtonElement>) {
    const delta: Record<string, [number, number]> = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }
    const rect = panel.current?.getBoundingClientRect()
    if (!delta[event.key] || !rect) return
    event.preventDefault()
    move(rect.x + delta[event.key][0], rect.y + delta[event.key][1])
  }
  const stop = () => { drag.current = null }
  return (
    <aside ref={panel} className={`camera-window-controls ${controls.minimized ? 'is-minimized' : ''} status-${controls.status}`} aria-label="카메라 작은 창"
      onPointerDown={begin} onPointerMove={(event) => {
        const current = drag.current
        if (current?.pointer === event.pointerId) move(event.clientX - current.dx, event.clientY - current.dy)
      }} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}
      style={position ? {
        left: position.x, top: position.y, right: 'auto', bottom: 'auto',
        maxWidth: `calc(100vw - ${position.x + 8}px)`, maxHeight: `calc(100vh - ${position.y + 8}px)`,
      } : undefined}>
      {!controls.minimized && <StreamPreview camera={camera} />}
      <PipBar {...controls} label={(text) => (
        <button className="camera-window-drag" aria-label={`${text} · 방향키로 창 옮기기`} onKeyDown={keyboardMove}>
          <span role="status">{text}</span>
        </button>
      )} />
    </aside>
  )
}

/**
 * `floating` hides the in-app window on screens that already show the camera large.
 * `onExpand` returns to the measurement; without it (collection screen) there is no expand.
 * `measuring` makes the X end and save the measurement (2026-10-20); otherwise it closes the window.
 * Camera windows are a desktop-app feature; web pages render no floating preview or PiP source.
 */
export function CameraWindow({ camera, floating = true, onExpand, measuring = false }: {
  camera: CameraController
  floating?: boolean
  onExpand?: () => void
  measuring?: boolean
}) {
  if (!desktopBridge()) return null
  return <DesktopCameraWindow camera={camera} floating={floating} onExpand={onExpand} measuring={measuring} />
}

function DesktopCameraWindow({ camera, floating, onExpand, measuring }: {
  camera: CameraController
  floating: boolean
  onExpand?: () => void
  measuring: boolean
}) {
  const preview = useCameraWindow(camera)
  const posture = useMeasurementStatus()
  const [dismissed, setDismissed] = useState(false)
  const [minimized, setMinimized] = useState(false)
  useEffect(() => {
    if (!preview.supported) return
    const report = () => publishCameraTest({ opened: !!preview.pipWindow, collapsed: minimized, message: preview.message })
    const receive = (event: Event) => {
      const action = (event as CustomEvent<CameraTestAction>).detail
      if (action === 'status') { report(); return }
      if (camera.state !== 'on' || !preview.supported) return
      if (action === 'open') { void preview.open(); return }
      if (action === 'close') { preview.close(); return }
      if (action === 'return') {
        void desktopBridge()?.returnFromCameraWindow?.()
        preview.close()
        onExpand?.()
        return
      }
      if ((action === 'collapse' || action === 'restore') && preview.pipWindow) {
        const collapsed = action === 'collapse'
        void desktopBridge()?.collapseCameraWindow?.(collapsed).then(ok => {
          if (ok) setMinimized(collapsed)
        })
      }
    }
    window.addEventListener(CAMERA_TEST_EVENT, receive)
    report()
    return () => window.removeEventListener(CAMERA_TEST_EVENT, receive)
  }, [camera.state, preview.supported, preview.pipWindow, preview.message, preview.open, preview.close, minimized, onExpand])
  useEffect(() => {
    if (preview.pipWindow) {
      setMinimized(false)
    }
  }, [preview.pipWindow])
  // Closing lasts until the camera is shown large again (e.g. back on 측정하기).
  useEffect(() => {
    if (!floating) {
      setDismissed(false)
      if (!preview.pipWindow) setMinimized(false)
    }
  }, [floating, preview.pipWindow])
  if (camera.state !== 'on') return null
  const controls = {
    status: (measuring && posture) || ('camera' as const),
    minimized,
    measuring,
    onMinimize: () => {
      if (preview.pipWindow) void desktopBridge()?.collapseCameraWindow?.(!minimized)
      setMinimized((old) => !old)
    },
    onExpand: onExpand && (() => {
      // Restore the main native window before navigating to the measurement.
      if (preview.pipWindow) {
        void desktopBridge()?.returnFromCameraWindow?.()
        preview.close()
      }
      onExpand()
    }),
    onClose: () => {
      if (measuring && endRunningMeasurement(WINDOW_END_REASON)) {
        preview.close()
        return
      }
      if (preview.pipWindow) preview.close()
      else setDismissed(true)
    },
  }
  return (
    <>
      {floating && !dismissed && !preview.pipWindow && <FloatingPreview camera={camera} controls={controls} />}
      {preview.supported && !preview.pipWindow && (
        <div className="camera-window-launch">
          <button className="btn btn-sm" onClick={() => void preview.open()}>작은 창 열기</button>
          {preview.message && <span role="status">{preview.message}</span>}
        </div>
      )}
      {preview.pipWindow && createPortal(
        <WindowPreview camera={camera} controls={controls} />,
        preview.pipWindow.document.body,
      )}
    </>
  )
}
