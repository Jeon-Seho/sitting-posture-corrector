import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CameraWindowTest } from './CameraWindowTest'
import { CAMERA_TEST_EVENT, publishCameraTest } from '../camera/cameraWindowTesting'

describe('developer camera checks', () => {
  let renderer: ReactTestRenderer | undefined
  afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals() })
  it('disables PiP on web but enables a camera-free example on desktop', () => {
    vi.stubGlobal('window', new EventTarget())
    act(() => { renderer = create(<CameraWindowTest />) })
    expect(renderer!.root.findAllByType('button').every(button => button.props.disabled)).toBe(true)
    window.posegoodDesktop = { version: 1, cameraWindow: true } as typeof window.posegoodDesktop
    act(() => { renderer!.update(<CameraWindowTest />) })
    expect(renderer!.root.findAllByType('button')[0].props.disabled).toBe(false)
    expect(JSON.stringify(renderer!.toJSON())).toContain('카메라 없이 예시 화면')
  })
  it('routes commands to the existing window and reflects collapse/close state', () => {
    const host = Object.assign(new EventTarget(), { posegoodDesktop: { version: 1, cameraWindow: true } })
    vi.stubGlobal('window', host)
    const commands: string[] = []
    host.addEventListener(CAMERA_TEST_EVENT, event => commands.push((event as CustomEvent).detail))
    act(() => { renderer = create(<CameraWindowTest />) })
    const press = (label: string) => act(() => renderer!.root.findAllByType('button').find(button => button.children.join('') === label)!.props.onClick())
    press('PiP 열기')
    act(() => publishCameraTest({ opened: true, collapsed: false, message: '' }))
    press('PiP 접기')
    act(() => publishCameraTest({ opened: true, collapsed: true, message: '' }))
    press('PiP 펼치기')
    press('테스트 창 닫기')
    expect(commands).toEqual(['status', 'demo', 'collapse', 'restore', 'close'])
    act(() => publishCameraTest({ opened: false, collapsed: false, message: '' }))
    expect(renderer!.root.findAllByType('button').filter(button => !button.props.disabled)).toHaveLength(1)
  })
})
