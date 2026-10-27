import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CameraWindowTest } from './CameraWindowTest'
import { CAMERA_TEST_EVENT, publishCameraTest } from '../camera/cameraWindowTesting'

describe('developer camera checks', () => {
  let renderer: ReactTestRenderer | undefined
  afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals() })
  it('starts the shared camera locally and keeps PiP disabled until the camera is ready', async () => {
    vi.stubGlobal('window', Object.assign(new EventTarget(), { posegoodDesktop: { version: 1, cameraWindow: true } }))
    let complete: () => void = () => {}
    const connect = vi.fn(() => new Promise<void>(resolve => { complete = resolve }))
    act(() => { renderer = create(<CameraWindowTest cameraOn={false} onConnect={connect} />) })
    const buttons = () => renderer!.root.findAllByType('button')
    act(() => buttons().find(button => button.children.join('') === '테스트 카메라 켜기')!.props.onClick())
    expect(connect).toHaveBeenCalledOnce()
    expect(buttons().find(button => button.children.join('') === '카메라 준비 중…')!.props.disabled).toBe(true)
    expect(buttons().find(button => button.children.join('') === 'PiP 열기')!.props.disabled).toBe(true)
    await act(async () => { complete(); await Promise.resolve() })
    act(() => renderer!.update(<CameraWindowTest cameraOn onConnect={connect} />))
    expect(buttons().find(button => button.children.join('') === 'PiP 열기')!.props.disabled).toBe(false)
  })
  it('reports camera start failure and allows retry without opening PiP', async () => {
    vi.stubGlobal('window', Object.assign(new EventTarget(), { posegoodDesktop: { version: 1, cameraWindow: true } }))
    const connect = vi.fn(async () => { throw new Error('synthetic denial') })
    act(() => { renderer = create(<CameraWindowTest cameraOn={false} onConnect={connect} />) })
    await act(async () => { await renderer!.root.findAllByType('button')[0].props.onClick(); await Promise.resolve() })
    expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(1)
    expect(renderer!.root.findAllByType('button')[0].children.join('')).toBe('카메라 다시 연결')
    act(() => renderer!.update(<CameraWindowTest cameraOn={false} cameraError="카메라 권한이 꺼져 있어요." onConnect={connect} />))
    expect(JSON.stringify(renderer!.toJSON())).toContain('카메라 권한이 꺼져 있어요.')
  })
  it('disables PiP on web and while the desktop camera is off', () => {
    vi.stubGlobal('window', new EventTarget())
    act(() => { renderer = create(<CameraWindowTest cameraOn />) })
    expect(renderer!.root.findAllByType('button').every(button => button.props.disabled)).toBe(true)
    expect(JSON.stringify(renderer!.toJSON())).toContain('웹 PiP는 사용하지 않아요')
    window.posegoodDesktop = { version: 1, cameraWindow: true } as typeof window.posegoodDesktop
    act(() => { renderer!.update(<CameraWindowTest cameraOn={false} />) })
    expect(renderer!.root.findAllByType('button').every(button => button.props.disabled)).toBe(true)
  })
  it('routes commands to the existing window and reflects collapse/close state', () => {
    const host = Object.assign(new EventTarget(), { posegoodDesktop: { version: 1, cameraWindow: true } })
    vi.stubGlobal('window', host)
    const commands: string[] = []
    host.addEventListener(CAMERA_TEST_EVENT, event => commands.push((event as CustomEvent).detail))
    act(() => { renderer = create(<CameraWindowTest cameraOn />) })
    const press = (label: string) => act(() => renderer!.root.findAllByType('button').find(button => button.children.join('') === label)!.props.onClick())
    press('PiP 열기')
    act(() => publishCameraTest({ opened: true, collapsed: false, message: '' }))
    press('PiP 접기')
    act(() => publishCameraTest({ opened: true, collapsed: true, message: '' }))
    press('PiP 펼치기')
    press('테스트 창 닫기')
    expect(commands).toEqual(['status', 'open', 'collapse', 'restore', 'close'])
    act(() => publishCameraTest({ opened: false, collapsed: false, message: '' }))
    expect(renderer!.root.findAllByType('button').filter(button => !button.props.disabled)).toHaveLength(1)
  })
})
