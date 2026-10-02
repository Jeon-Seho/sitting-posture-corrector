import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { CameraController } from '../../hooks/useCamera'
import { useCameraWindow } from './useCameraWindow'

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

function WindowPreview({ camera, onClose }: { camera: CameraController; onClose: () => void }) {
  return (
    <section className="camera-window-view" aria-label="카메라 작은 창">
      <h1>POSE GOOD · 내 카메라</h1>
      <StreamPreview camera={camera} />
      <p role="status">{camera.quality ? '몸의 특징을 확인하고 있습니다.' : '몸의 특징을 측정할 수 없습니다.'}</p>
      <p>창을 드래그해 위치를 옮기고 가장자리를 당겨 크기를 바꾸세요.</p>
      <div className="camera-window-actions">
        <button onClick={onClose}>작은 창 닫기</button>
        <button onClick={camera.stop}>카메라 끄기</button>
      </div>
    </section>
  )
}

/** Browser-local fallback also gives pointer and keyboard users control over placement. */
function FloatingPreview({ camera, children }: { camera: CameraController; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null)
  const drag = useRef<{ pointer: number; dx: number; dy: number } | null>(null)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const [expanded, setExpanded] = useState(true)
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
  function begin(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
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
  return (
    <aside ref={panel} className={`camera-window-controls ${expanded ? 'is-expanded' : ''}`}
      aria-label="카메라 창 설정" style={position ? {
        left: position.x, top: position.y, right: 'auto', bottom: 'auto',
        maxWidth: `calc(100vw - ${position.x + 8}px)`, maxHeight: `calc(100vh - ${position.y + 8}px)`,
      } : undefined}>
      <div className="camera-window-heading">
        <button className="camera-window-drag" aria-label="카메라 창 위치 이동" onKeyDown={keyboardMove}
          onPointerDown={begin} onPointerMove={(event) => {
            const current = drag.current
            if (current?.pointer === event.pointerId) move(event.clientX - current.dx, event.clientY - current.dy)
          }} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}
          onLostPointerCapture={() => { drag.current = null }}>카메라 사용 중 · 드래그로 이동</button>
        <button className="camera-window-collapse" aria-expanded={expanded} onClick={() => setExpanded((old) => !old)}>
          {expanded ? '접기' : '펼치기'}
        </button>
      </div>
      {expanded && <>
        <StreamPreview camera={camera} />
        <p className="fine">{camera.quality ? '몸의 특징 측정 가능' : '몸의 특징 측정 불가'}</p>
        <p className="fine">제목을 드래그하거나 제목에 초점을 두고 방향키로 옮기세요. 오른쪽 아래 모서리로 크기를 조절합니다.</p>
        {children}
      </>}
    </aside>
  )
}

export function CameraWindow({ camera }: { camera: CameraController }) {
  const preview = useCameraWindow(camera)
  if (camera.state !== 'on') return null
  const opened = !!preview.pipWindow || preview.videoPip
  return (
    <>
      <FloatingPreview camera={camera}>
        <div className="row">
          <button className="btn" disabled={!preview.supported} onClick={() => {
            if (opened) preview.close()
            else void preview.open()
          }}>{opened ? '작은 창 닫기' : '카메라 작은 창 열기'}</button>
          <button className="btn" onClick={camera.stop}>카메라 사용 종료</button>
        </div>
        <p className="fine">다른 사이트는 새 탭으로 열고 이 앱 탭은 남겨 두세요. 자동 작은 창은 브라우저 설정에 따라 열립니다.</p>
        {!preview.supported && <p role="status">현재 창은 이 앱 안에서만 보입니다. 다른 사이트 위에도 보려면 Chrome에서 열어 주세요.</p>}
        {preview.message && <p role="status">{preview.message}</p>}
      </FloatingPreview>
      <video ref={preview.fallbackVideo} className="capture-source" muted playsInline aria-hidden="true" />
      {preview.pipWindow && createPortal(
        <WindowPreview camera={camera} onClose={preview.close} />,
        preview.pipWindow.document.body,
      )}
    </>
  )
}
