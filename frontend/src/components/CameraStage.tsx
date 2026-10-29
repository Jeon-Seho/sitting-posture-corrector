import { ThemeIllustration } from '../features/appearance/ThemeIllustration'
import { useEffect, useRef } from 'react'
import type { CameraController } from '../hooks/useCamera'
import { ArrowsOutSimple } from './icons'
import { requestCameraTest } from '../features/camera/cameraWindowTesting'
import { desktopBridge } from '../features/desktop/bridge'

/** The capture element stays mounted in App; this view can move between setup/session. */
export function CameraStage({
  camera,
  showSkeleton = true,
  message,
}: {
  camera: CameraController
  showSkeleton?: boolean
  /** A higher-priority notice that replaces the camera status, whatever state the camera is in. */
  message?: { title: string; body: string }
}) {
  useEffect(() => {
    camera.setOverlayEnabled(showSkeleton)
  }, [showSkeleton, camera.setOverlayEnabled])
  const preview = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = preview.current
    if (!video) return
    video.srcObject = camera.streamRef.current
    if (video.srcObject) void video.play().catch(() => {})
    return () => {
      video.srcObject = null
    }
  }, [camera.state, camera.streamRef])
  return (
    <>
      {desktopBridge()?.cameraWindow && camera.state === 'on' && <button className="camera-stage-pip" aria-label="작은 창 열기" onClick={() => requestCameraTest('open')}>
        <ArrowsOutSimple size={18} aria-hidden="true" /> 작은 창
      </button>}
      <video
        ref={preview}
        className="webcam-preview"
        muted
        playsInline
        disablePictureInPicture={!desktopBridge()}
        aria-label="실제 웹캠 미리보기"
      />
      <canvas
        ref={camera.canvasRef}
        className="webcam-overlay"
        style={{ opacity: showSkeleton ? 1 : 0 }}
        aria-hidden="true"
      />
      {message ? (
        <div className="webcam-message">
          <strong>{message.title}</strong>
          <span>{message.body}</span>
        </div>
      ) : (
        camera.state !== 'on' && (
          <div className="webcam-message">
            {camera.state === 'off' && <ThemeIllustration kind="camera" className="state-art" />}
            <strong>{camera.state === 'loading' ? '카메라를 준비하고 있어요…' : '카메라가 꺼져 있어요'}</strong>
            <span>{camera.error || '영상은 이 기기 안에서만 처리하고 저장하지 않아요.'}</span>
          </div>
        )
      )}
    </>
  )
}
