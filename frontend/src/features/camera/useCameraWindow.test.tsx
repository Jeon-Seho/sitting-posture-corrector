import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { CameraController } from '../../hooks/useCamera'
import { useCameraWindow } from './useCameraWindow'

describe('camera window lifecycle with synthetic streams only', () => {
  let renderer: ReactTestRenderer
  let camera: CameraController
  let controls: ReturnType<typeof useCameraWindow>
  let host: Record<string, unknown>
  let doc: { pictureInPictureEnabled: boolean; pictureInPictureElement: unknown; exitPictureInPicture: ReturnType<typeof vi.fn> }
  let video: Record<string, unknown>
  let events: Map<string, () => void>
  function Harness() {
    controls = useCameraWindow(camera)
    return <video ref={controls.fallbackVideo} />
  }
  function mount() {
    act(() => { renderer = create(<Harness />, { createNodeMock: () => video }) })
  }
  function popup() {
    const listeners = new Map<string, () => void>()
    const win = {
      closed: false,
      focus: vi.fn(),
      close: vi.fn(() => { win.closed = true; listeners.get('pagehide')?.() }),
      addEventListener: vi.fn((name: string, handler: () => void) => listeners.set(name, handler)),
      document: { title: '', createElement: vi.fn(() => ({ textContent: '' })), head: { appendChild: vi.fn() } },
    }
    return win
  }
  beforeEach(() => {
    events = new Map()
    host = {}
    doc = {
      pictureInPictureEnabled: true,
      pictureInPictureElement: null,
      exitPictureInPicture: vi.fn(async () => { doc.pictureInPictureElement = null }),
    }
    video = {
      srcObject: null,
      readyState: 4,
      play: vi.fn(async () => {}),
      requestPictureInPicture: vi.fn(async () => { doc.pictureInPictureElement = video }),
      addEventListener: vi.fn((name: string, handler: () => void) => events.set(name, handler)),
      removeEventListener: vi.fn((name: string) => events.delete(name)),
    }
    camera = {
      state: 'on', streamRef: { current: { synthetic: true } },
      videoRef: { current: { originalCapture: true } }, canvasRef: { current: { originalOverlay: true } },
    } as unknown as CameraController
    vi.stubGlobal('window', host)
    vi.stubGlobal('document', doc)
    vi.stubGlobal('navigator', {})
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    vi.unstubAllGlobals()
  })
  it('opens one native window using the same stream and leaves inference refs unchanged', async () => {
    const win = popup()
    const request = vi.fn(async () => win)
    host.documentPictureInPicture = { requestWindow: request }
    const source = camera.videoRef.current
    const canvas = camera.canvasRef.current
    mount()
    await act(async () => { await controls.open() })
    expect(controls.pipWindow).toBe(win)
    expect(video.srcObject).toBe(camera.streamRef.current)
    expect(camera.videoRef.current).toBe(source)
    expect(camera.canvasRef.current).toBe(canvas)
    await act(async () => { await controls.open() })
    expect(request).toHaveBeenCalledOnce()
    expect(win.focus).toHaveBeenCalledOnce()
    act(() => controls.close())
    expect(win.close).toHaveBeenCalledOnce()
    expect(controls.pipWindow).toBeNull()
    expect(camera.streamRef.current).not.toBeNull()
  })
  it('tracks closing the native window through browser controls', async () => {
    const win = popup()
    host.documentPictureInPicture = { requestWindow: async () => win }
    mount()
    await act(async () => { await controls.open() })
    act(() => win.close())
    expect(controls.pipWindow).toBeNull()
  })
  it('closes a window that resolves after the camera was disconnected and reconnected', async () => {
    const win = popup()
    let finish!: (value: unknown) => void
    host.documentPictureInPicture = { requestWindow: vi.fn(() => new Promise((resolve) => { finish = resolve })) }
    mount()
    let opening!: Promise<void>
    act(() => { opening = controls.open() })
    camera.state = 'off'
    act(() => renderer.update(<Harness />))
    camera.state = 'on'
    camera.streamRef.current = { anotherSyntheticStream: true } as unknown as MediaStream
    act(() => renderer.update(<Harness />))
    await act(async () => { finish(win); await opening })
    expect(win.close).toHaveBeenCalledOnce()
    expect(controls.pipWindow).toBeNull()
  })
  it('falls back to native video PiP and tracks the browser close event', async () => {
    mount()
    await act(async () => { await controls.open() })
    expect(video.requestPictureInPicture).toHaveBeenCalledOnce()
    expect(controls.videoPip).toBe(true)
    act(() => { doc.pictureInPictureElement = null; events.get('leavepictureinpicture')?.() })
    expect(controls.videoPip).toBe(false)
  })
  it('closes its video PiP and detaches preview streams when the camera stops', async () => {
    mount()
    await act(async () => { await controls.open() })
    camera.state = 'off'
    act(() => renderer.update(<Harness />))
    expect(doc.exitPictureInPicture).toHaveBeenCalled()
    expect(video.srcObject).toBeNull()
    expect(controls.videoPip).toBe(false)
  })
  it('does not exit a picture-in-picture element owned by another video', () => {
    doc.pictureInPictureElement = { anotherVideo: true }
    mount()
    act(() => controls.close())
    expect(doc.exitPictureInPicture).not.toHaveBeenCalled()
  })
  it('reports unsupported or denied PiP without replacing the camera stream', async () => {
    doc.pictureInPictureEnabled = false
    mount()
    const stream = camera.streamRef.current
    expect(controls.supported).toBe(false)
    await act(async () => { await controls.open() })
    expect(controls.message).toContain('작은 창을 열지 못했습니다')
    expect(camera.streamRef.current).toBe(stream)
    host.documentPictureInPicture = { requestWindow: async () => { throw new Error('denied') } }
    await act(async () => { await controls.open() })
    expect(controls.pipWindow).toBeNull()
  })
  it('waits for real video metadata rather than requesting an unready video window', async () => {
    video.readyState = 0
    mount()
    await act(async () => { await controls.open() })
    expect(video.requestPictureInPicture).not.toHaveBeenCalled()
    expect(controls.message).toContain('카메라 영상이 준비되면')
  })
  it('clears the automatic PiP action when the camera disconnects', () => {
    const session = { setActionHandler: vi.fn(), setCameraActive: vi.fn() }
    vi.stubGlobal('navigator', { mediaSession: session })
    host.documentPictureInPicture = { requestWindow: async () => popup() }
    mount()
    expect(session.setCameraActive).toHaveBeenCalledWith(true)
    expect(session.setActionHandler).toHaveBeenCalledWith('enterpictureinpicture', expect.any(Function))
    camera.state = 'off'
    act(() => renderer.update(<Harness />))
    expect(session.setCameraActive).toHaveBeenLastCalledWith(false)
    expect(session.setActionHandler).toHaveBeenLastCalledWith('enterpictureinpicture', null)
  })
})
