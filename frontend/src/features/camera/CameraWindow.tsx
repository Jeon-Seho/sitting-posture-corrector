import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react'
import { ArrowsOutSimple, X } from '@phosphor-icons/react'
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
      <p role="status">{camera.quality ? '자세를 확인하고 있어요.' : '자세를 확인할 수 없어요.'}</p>
      <p>창을 드래그해 위치를 옮기고 가장자리를 당겨 크기를 바꾸세요.</p>
      <div className="camera-window-actions">
        <button onClick={onClose}>작은 창 닫기</button>
        <button onClick={camera.stop}>카메라 끄기</button>
      </div>
    </section>
  )
}

/**
 * A small video-only window like a browser picture-in-picture: drag it anywhere, and the bar that
 * appears on hover or focus holds 「측정하기로 돌아가기」 and 「닫기」 (2026-10-19). Closing hides the
 * window only; the camera keeps running so a measurement in progress is not cut off.
 */
function FloatingPreview({ camera, onExpand, onClose }: {
  camera: CameraController
  onExpand?: () => void
  onClose: () => void
}) {
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
    <aside ref={panel} className="camera-window-controls" aria-label="카메라 작은 창"
      onPointerDown={begin} onPointerMove={(event) => {
        const current = drag.current
        if (current?.pointer === event.pointerId) move(event.clientX - current.dx, event.clientY - current.dy)
      }} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}
      style={position ? {
        left: position.x, top: position.y, right: 'auto', bottom: 'auto',
        maxWidth: `calc(100vw - ${position.x + 8}px)`, maxHeight: `calc(100vh - ${position.y + 8}px)`,
      } : undefined}>
      <StreamPreview camera={camera} />
      <div className="camera-window-bar">
        <button className="camera-window-drag" aria-label="카메라 사용 중 · 방향키로 창 옮기기" onKeyDown={keyboardMove}>
          카메라 사용 중
        </button>
        <span className="camera-window-tools">
          {onExpand && (
            <button aria-label="측정하기로 돌아가기" title="측정하기로 돌아가기" onClick={onExpand}>
              <ArrowsOutSimple size={16} weight="bold" aria-hidden="true" />
            </button>
          )}
          <button aria-label="작은 창 닫기" title="닫기" onClick={onClose}>
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </span>
      </div>
    </aside>
  )
}

/**
 * `floating` hides the in-app preview on screens that already show the camera large.
 * `onExpand` returns to 측정하기; without it (collection screen) only 닫기 is shown.
 */
export function CameraWindow({ camera, floating = true, onExpand }: {
  camera: CameraController
  floating?: boolean
  onExpand?: () => void
}) {
  const preview = useCameraWindow(camera)
  const [dismissed, setDismissed] = useState(false)
  // Closing lasts until the camera is shown large again (e.g. back on 측정하기).
  useEffect(() => {
    if (!floating) setDismissed(false)
  }, [floating])
  if (camera.state !== 'on') return null
  return (
    <>
      {floating && !dismissed && (
        <FloatingPreview camera={camera} onExpand={onExpand} onClose={() => setDismissed(true)} />
      )}
      <video ref={preview.fallbackVideo} className="capture-source" muted playsInline aria-hidden="true" />
      {preview.pipWindow && createPortal(
        <WindowPreview camera={camera} onClose={preview.close} />,
        preview.pipWindow.document.body,
      )}
    </>
  )
}
