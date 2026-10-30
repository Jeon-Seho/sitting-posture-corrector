/**
 * The camera chosen as "main" when several are connected. It is kept per device in local
 * storage (a device id is only meaningful on this computer) and never sent to the server.
 */
const KEY = 'posegood.v2.mainCamera'

export function readMainCamera(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch (caughtError) {
    console.error('[features/camera/mainCamera.ts:readMainCamera] Operation failed', caughtError)
    return ''
  }
}

export function writeMainCamera(deviceId: string) {
  try {
    if (deviceId) localStorage.setItem(KEY, deviceId)
    else localStorage.removeItem(KEY)
  } catch (caughtError) {
    console.error('[features/camera/mainCamera.ts:writeMainCamera] Operation failed', caughtError)
    /* Storage blocked: the choice lasts for this run only. */
  }
}

/** The saved camera is unplugged or cannot satisfy the request; the default camera is used instead. */
export function missingDevice(cause: unknown) {
  const name = cause instanceof Error ? cause.name : ''
  return name === 'OverconstrainedError' || name === 'NotFoundError'
}

/** "카메라 2" when the browser hides names before camera permission is granted. */
export function cameraName(device: Pick<MediaDeviceInfo, 'label'>, index: number) {
  return device.label || `카메라 ${index + 1}`
}
