import { useEffect, useRef } from 'react'
import type { CameraController } from '../../hooks/useCamera'

/** Reuses the route's existing camera. Mounting a preview never requests access. */
export default function NormalCollectionPreview({ camera }: { camera: CameraController }) {
  const preview = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const node = preview.current
    if (!node) return
    node.srcObject = camera.state === 'on' ? camera.streamRef.current : null
    if (node.srcObject) void node.play().catch(() => {})
    return () => { node.srcObject = null }
  }, [camera.state, camera.streamRef])
  return <div className="lab-collection-preview">
    <video ref={preview} muted playsInline aria-label="정상 자세 수집용 좌우 반전 카메라 미리보기" hidden={camera.state !== 'on'} />
    <canvas ref={camera.canvasRef} aria-hidden="true" hidden={camera.state !== 'on'} />
    {camera.state !== 'on' && <p>{camera.state === 'loading' ? '카메라를 준비하고 있습니다…' : '수집 시작을 누르면 카메라가 연결됩니다.'}</p>}
    {camera.error && <p role="alert">{camera.error}</p>}
    <span>영상은 저장하지 않습니다 · 좌표 수집은 명시적으로 시작</span>
  </div>
}
