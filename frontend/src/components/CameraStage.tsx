import { useEffect, useRef } from 'react'
import type { CameraController } from '../hooks/useCamera'

/** The capture element stays mounted in App; this view can move between setup/session. */
export function CameraStage({
  camera,
  showSkeleton = true,
}: {
  camera: CameraController
  showSkeleton?: boolean
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
      <video
        ref={preview}
        className="webcam-preview"
        muted
        playsInline
        aria-label="실제 웹캠 미리보기"
      />
      <canvas
        ref={camera.canvasRef}
        className="webcam-overlay"
        style={{ opacity: showSkeleton ? 1 : 0 }}
        aria-hidden="true"
      />
      {camera.state !== 'on' && (
        <div className="webcam-message">
          <strong>
            {camera.state === 'loading' ? '카메라를 준비하고 있어요…' : '카메라가 꺼져 있어요'}
          </strong>
          <span>{camera.error || '영상은 이 기기 안에서만 처리하고 저장하지 않아요.'}</span>
        </div>
      )}
    </>
  )
}
