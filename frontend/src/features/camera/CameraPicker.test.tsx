import { describe, expect, it, vi } from 'vitest'
import { act, create } from 'react-test-renderer'
import { SelectMenu } from '../../components/SelectMenu'
import { CameraPicker, type CameraPickerSource } from './CameraPicker'

const devices = [
  { kind: 'videoinput', deviceId: 'a', label: 'Logi C270 HD WebCam (046d:0825)', groupId: '1' },
  { kind: 'videoinput', deviceId: 'b', label: 'USB Camera (4c4a:4a55)', groupId: '2' },
] as MediaDeviceInfo[]

const source = (over: Partial<CameraPickerSource> = {}): CameraPickerSource => ({
  devices,
  deviceId: '',
  mainDeviceId: '',
  state: 'off',
  chooseMainCamera: vi.fn(),
  ...over,
})
const menu = (camera: CameraPickerSource, disabled?: boolean) => {
  let tree!: ReturnType<typeof create>
  act(() => {
    tree = create(<CameraPicker camera={camera} disabled={disabled} />)
  })
  return tree
}

describe('CameraPicker (synthetic device names only)', () => {
  it('offers the cameras even while the camera is off', () => {
    const props = menu(source()).root.findByType(SelectMenu).props
    expect(props.value).toBe('')
    expect(props.options.map((o: { label: string }) => o.label)).toEqual([
      '기본 카메라 (자동)',
      'Logi C270 HD WebCam (046d:0825)',
      'USB Camera (4c4a:4a55)',
    ])
  })

  it('marks the camera in use and shows the saved choice', () => {
    const props = menu(source({ state: 'on', deviceId: 'b', mainDeviceId: 'b' })).root.findByType(SelectMenu).props
    expect(props.value).toBe('b')
    expect(props.options.find((o: { value: string }) => o.value === 'b').note).toBe('사용 중')
  })

  it('shows 「자동」 when the saved camera is unplugged', () => {
    expect(menu(source({ mainDeviceId: 'gone' })).root.findByType(SelectMenu).props.value).toBe('')
  })

  it('saves the choice through the camera controller and can be locked', () => {
    const camera = source()
    const props = menu(camera, true).root.findByType(SelectMenu).props
    expect(props.disabled).toBe(true)
    props.onChange('b')
    expect(camera.chooseMainCamera).toHaveBeenCalledWith('b')
  })

  it('hides itself with no cameras or before the browser reveals their ids', () => {
    expect(menu(source({ devices: [] })).toJSON()).toBeNull()
    const hidden = [{ ...devices[0], deviceId: '', label: '' }] as MediaDeviceInfo[]
    expect(menu(source({ devices: hidden })).toJSON()).toBeNull()
  })
})
