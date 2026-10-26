import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { CameraController } from '../../hooks/useCamera'
import { useCameraWindow } from './useCameraWindow'

describe('native camera window lifecycle with synthetic streams only', () => {
  let renderer: ReactTestRenderer
  let camera: CameraController
  let controls: ReturnType<typeof useCameraWindow>
  let request: (() => void) | undefined
  const enabled = vi.fn(async (_value: boolean) => true)
  const show = vi.fn(async () => true)
  const remove = vi.fn()
  const makeChild = () => {
    const events = new Map<string, () => void>()
    const child = {
      closed: false,
      close: vi.fn(() => { child.closed = true; events.get('pagehide')?.() }),
      addEventListener: vi.fn((name: string, handler: () => void) => events.set(name, handler)),
      document: { title: '', createElement: vi.fn(() => ({ textContent: '' })), head: { appendChild: vi.fn() } },
    }
    return child
  }
  let child: ReturnType<typeof makeChild>
  let host: { posegoodDesktop?: unknown; open: ReturnType<typeof vi.fn> }
  function Harness() { controls = useCameraWindow(camera); return null }
  const mount = () => act(() => { renderer = create(<Harness />) })
  beforeEach(() => {
    enabled.mockReset().mockResolvedValue(true)
    show.mockClear(); remove.mockClear(); request = undefined
    child = makeChild()
    host = {
      posegoodDesktop: {
        version: 1, cameraWindow: true, setCameraWindowEnabled: enabled, showCameraWindow: show,
        onCameraWindowRequested: vi.fn((callback: () => void) => { request = callback; return remove }),
      },
      open: vi.fn(() => child),
    }
    camera = { state: 'on', streamRef: { current: { synthetic: true } }, videoRef: { current: { capture: true } } } as unknown as CameraController
    vi.stubGlobal('window', host)
  })
  afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals() })
  it('opens one frameless native child without replacing the capture stream', async () => {
    const stream = camera.streamRef.current
    const capture = camera.videoRef.current
    mount()
    await act(async () => { await controls.open() })
    expect(host.open).toHaveBeenCalledWith('about:blank', 'posegood-camera', 'width=360,height=314')
    expect(controls.pipWindow).toBe(child)
    expect(camera.streamRef.current).toBe(stream)
    expect(camera.videoRef.current).toBe(capture)
    await act(async () => { await controls.open() })
    expect(host.open).toHaveBeenCalledOnce()
    expect(show).toHaveBeenCalledOnce()
    act(() => controls.close())
    expect(child.close).toHaveBeenCalledOnce()
    expect(controls.pipWindow).toBeNull()
    expect(camera.streamRef.current).toBe(stream)
  })
  it('responds to a native blur/minimize request and unregisters on shutdown', async () => {
    mount()
    await act(async () => { request?.() })
    expect(controls.pipWindow).toBe(child)
    camera.state = 'off'
    await act(async () => { renderer.update(<Harness />) })
    expect(child.closed).toBe(true)
    expect(enabled).toHaveBeenLastCalledWith(false)
    expect(remove).toHaveBeenCalled()
  })
  it('tracks native close without ending the camera stream and can reopen', async () => {
    mount()
    await act(async () => { await controls.open() })
    act(() => child.close())
    expect(controls.pipWindow).toBeNull()
    const next = makeChild(); host.open.mockReturnValue(next)
    await act(async () => { await controls.open() })
    expect(controls.pipWindow).toBe(next)
    expect(camera.streamRef.current).not.toBeNull()
  })
  it('cancels a pending open on stream replacement', async () => {
    mount()
    let finish!: (value: boolean) => void
    enabled.mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve }))
    let opening!: Promise<void>
    act(() => { opening = controls.open() })
    camera.streamRef.current = { anotherSyntheticStream: true } as unknown as MediaStream
    act(() => renderer.update(<Harness />))
    await act(async () => { finish(true); await opening })
    expect(host.open).not.toHaveBeenCalled()
    expect(controls.pipWindow).toBeNull()
  })
  it('reports native creation failure and allows retry', async () => {
    host.open.mockReturnValue(null)
    mount()
    await act(async () => { await controls.open() })
    expect(controls.message).toContain('작은 창을 열지 못했어요')
    host.open.mockReturnValue(child)
    await act(async () => { await controls.open() })
    expect(controls.pipWindow).toBe(child)
    expect(controls.message).toBe('')
  })
  it.each([undefined, { version: 2, cameraWindow: true }, { version: 1 }])('does not open windows or register automatic requests without native support (%s)', async (bridge) => {
    host.posegoodDesktop = bridge
    mount()
    await act(async () => { await controls.open() })
    expect(controls.supported).toBe(false)
    expect(host.open).not.toHaveBeenCalled()
    expect(enabled).not.toHaveBeenCalled()
    expect(request).toBeUndefined()
  })
})
