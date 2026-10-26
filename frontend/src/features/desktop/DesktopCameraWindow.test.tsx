import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { CameraController } from '../../hooks/useCamera'
import { publishMeasurementStatus, registerMeasurementEnd, WINDOW_END_REASON } from '../session/sessionControl'
import { DesktopCameraWindow } from './DesktopCameraWindow'

// react-test-renderer cannot mount into another document; draw the window's content in place.
vi.mock('react-dom', async (original) => ({
  ...(await original<typeof import('react-dom')>()),
  createPortal: (node: unknown) => node,
}))

describe('desktop small camera window (synthetic streams only)', () => {
  let renderer: ReactTestRenderer
  let camera: CameraController
  let popup: { closed: boolean; close: ReturnType<typeof vi.fn>; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn>; document: unknown }
  let open: ReturnType<typeof vi.fn>
  let bridge: { version: 1; cameraWindow?: { name: string }; focusApp: ReturnType<typeof vi.fn>; setCameraWindowCompact: ReturnType<typeof vi.fn> }
  const onExpand = vi.fn()

  function mount(measuring = false) {
    act(() => { renderer = create(<DesktopCameraWindow camera={camera} measuring={measuring} onExpand={onExpand} />) })
  }
  const button = (label: string) => renderer.root.find((node) => node.type === 'button' && node.props['aria-label'] === label)
  const text = () => renderer.root.findAll((node) => node.props.role === 'status').map((node) => node.children.join('')).join('')

  beforeEach(() => {
    popup = {
      closed: false,
      close: vi.fn(() => { popup.closed = true }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      document: { title: '', createElement: vi.fn(() => ({ textContent: '' })), head: { appendChild: vi.fn() }, body: {} },
    }
    open = vi.fn(() => popup)
    bridge = {
      version: 1,
      cameraWindow: { name: 'posegood-camera-window' },
      focusApp: vi.fn(async () => true),
      setCameraWindowCompact: vi.fn(async () => true),
    }
    camera = { state: 'on', streamRef: { current: { synthetic: true } } } as unknown as CameraController
    vi.stubGlobal('window', { posegoodDesktop: bridge, open })
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    publishMeasurementStatus(null)
    vi.unstubAllGlobals()
    onExpand.mockReset()
  })

  it('opens the one window the shell allows while the camera is on, and closes it with the camera', () => {
    mount()
    expect(open).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledWith('about:blank', 'posegood-camera-window')
    expect(text()).toBe('카메라 사용 중')
    camera = { ...camera, state: 'off' } as CameraController
    act(() => renderer.update(<DesktopCameraWindow camera={camera} measuring={false} onExpand={onExpand} />))
    expect(popup.close).toHaveBeenCalled()
    expect(renderer.toJSON()).toBeNull()
  })

  it('does nothing in a browser tab or an older desktop shell', () => {
    vi.stubGlobal('window', { open })
    mount()
    expect(open).not.toHaveBeenCalled()
    act(() => renderer.unmount())
    delete bridge.cameraWindow
    vi.stubGlobal('window', { posegoodDesktop: bridge, open })
    mount()
    expect(open).not.toHaveBeenCalled()
  })

  it('shows the measurement posture, and X ends and saves a running measurement', () => {
    const end = vi.fn()
    const unregister = registerMeasurementEnd(end)
    act(() => publishMeasurementStatus('alert'))
    mount(true)
    expect(text()).toBe('자세가 흐트러졌어요')
    expect(renderer.root.findByProps({ 'aria-label': '카메라 작은 창' }).props.className).toContain('status-alert')
    act(() => button('측정 종료').props.onClick())
    expect(end).toHaveBeenCalledWith(WINDOW_END_REASON)
    unregister()
  })

  it('X without a measurement closes the window until the camera starts again', () => {
    mount()
    act(() => button('작은 창 닫기').props.onClick())
    expect(popup.close).toHaveBeenCalled()
    expect(renderer.toJSON()).toBeNull()
    camera = { ...camera, state: 'off' } as CameraController
    act(() => renderer.update(<DesktopCameraWindow camera={camera} measuring={false} onExpand={onExpand} />))
    camera = { ...camera, state: 'on' } as CameraController
    act(() => renderer.update(<DesktopCameraWindow camera={camera} measuring={false} onExpand={onExpand} />))
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('minimize shrinks the window to its bar; expand brings the app back to 측정하기', () => {
    mount()
    act(() => button('최소화').props.onClick())
    expect(bridge.setCameraWindowCompact).toHaveBeenLastCalledWith(true)
    expect(renderer.root.findAllByType('video')).toHaveLength(0)
    act(() => button('영상 보이기').props.onClick())
    expect(bridge.setCameraWindowCompact).toHaveBeenLastCalledWith(false)
    act(() => button('측정 화면으로 돌아가기').props.onClick())
    expect(bridge.focusApp).toHaveBeenCalledOnce()
    expect(onExpand).toHaveBeenCalledOnce()
  })
})
