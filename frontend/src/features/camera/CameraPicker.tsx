import { VideoCamera } from '../../components/icons'
import { SelectMenu } from '../../components/SelectMenu'
import type { CameraController } from '../../hooks/useCamera'
import { cameraName } from './mainCamera'

export type CameraPickerSource = Pick<
  CameraController,
  'devices' | 'deviceId' | 'mainDeviceId' | 'state' | 'chooseMainCamera'
>

/** Before camera permission the browser hides names and ids, so there is nothing to choose yet. */
export function camerasHidden(devices: CameraPickerSource['devices']) {
  return devices.some((d) => !d.deviceId)
}

/**
 * The main camera choice, shared by settings and 「측정하기」 (2026-10-16). Choosing saves it; a
 * camera that is on switches at once, otherwise the choice is used the next time it is turned on.
 */
export function CameraPicker({ camera, disabled = false }: { camera: CameraPickerSource; disabled?: boolean }) {
  const { devices } = camera
  if (devices.length === 0 || camerasHidden(devices)) return null
  const on = camera.state === 'on'
  // An unplugged main camera shows as 「자동」; the camera in use is marked 「사용 중」.
  const known = devices.some((d) => d.deviceId === camera.mainDeviceId)
  return (
    <SelectMenu
      label="메인 카메라"
      icon={<VideoCamera size={15} weight="bold" className="icon" />}
      value={known ? camera.mainDeviceId : ''}
      disabled={disabled}
      onChange={camera.chooseMainCamera}
      options={[
        { value: '', label: '기본 카메라 (자동)' },
        ...devices.map((d, i) => ({
          value: d.deviceId,
          label: cameraName(d, i),
          note: on && d.deviceId === camera.deviceId ? '사용 중' : undefined,
        })),
      ]}
    />
  )
}
