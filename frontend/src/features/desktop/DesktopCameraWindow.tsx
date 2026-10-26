import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowsOutSimple, Minus, Square, X } from '@phosphor-icons/react'
import type { CameraController } from '../../hooks/useCamera'
import {
  endRunningMeasurement,
  useMeasurementStatus,
  WINDOW_END_REASON,
  type MeasurementStatus,
} from '../session/sessionControl'
import { desktopBridge } from './bridge'
import { useDesktopCameraWindow } from './useDesktopCameraWindow'

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

/**
 * The desktop app's small camera window, like a YouTube mini player (10/20 design): minimize (hide
 * the video, keep measuring), expand (bring the app back to 측정하기) and X. While measuring, X ends
 * and saves (2026-10-20); otherwise it closes the window until the camera starts again.
 * Renders nothing in a browser tab (ADR 0028).
 */
export function DesktopCameraWindow({ camera, measuring, onExpand }: {
  camera: CameraController
  measuring: boolean
  onExpand: () => void
}) {
  const [dismissed, setDismissed] = useState(false)
  const [minimized, setMinimized] = useState(false)
  useEffect(() => {
    if (camera.state !== 'on') {
      setDismissed(false)
      setMinimized(false)
    }
  }, [camera.state])
  const popup = useDesktopCameraWindow(camera, !dismissed)
  const posture = useMeasurementStatus()
  if (!popup) return null
  const bridge = desktopBridge()
  const status = (measuring && posture) || 'camera'
  const minimize = () => {
    setMinimized(!minimized)
    void bridge?.setCameraWindowCompact?.(!minimized)
  }
  const expand = () => {
    void bridge?.focusApp?.()
    onExpand()
  }
  const close = () => {
    if (measuring && endRunningMeasurement(WINDOW_END_REASON)) return
    setDismissed(true)
  }
  return createPortal(
    <section className={`camera-window-view ${minimized ? 'is-minimized' : ''} status-${status}`} aria-label="카메라 작은 창">
      {!minimized && <StreamPreview camera={camera} />}
      <div className="camera-window-bar">
        <span className="camera-window-label" role="status">{STATUS_TEXT[status]}</span>
        <span className="camera-window-tools">
          <button aria-label={minimized ? '영상 보이기' : '최소화'} title={minimized ? '영상 보이기' : '최소화'} onClick={minimize}>
            {minimized ? <Square size={14} weight="bold" aria-hidden="true" /> : <Minus size={16} weight="bold" aria-hidden="true" />}
          </button>
          <button aria-label="측정 화면으로 돌아가기" title="측정 화면으로 돌아가기" onClick={expand}>
            <ArrowsOutSimple size={16} weight="bold" aria-hidden="true" />
          </button>
          <button aria-label={measuring ? '측정 종료' : '작은 창 닫기'} title={measuring ? '측정 종료·저장' : '닫기'} onClick={close}>
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </span>
      </div>
    </section>,
    popup.document.body,
  )
}
