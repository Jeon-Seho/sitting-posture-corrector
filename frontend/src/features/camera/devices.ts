import { CAMERA_ERRORS } from './errors'

/** Width ÷ height of every picture the app measures: 4:3 like the training data and baselines (ADR 0048). */
export const CAMERA_ASPECT = 4 / 3

/** True for a 4:3 picture (640×480, 1280×960 …); a rounding pixel is tolerated. */
export function isFourByThree(width: number | undefined, height: number | undefined) {
  return !!width && !!height && Math.abs(width / height - CAMERA_ASPECT) < 0.01
}

/** The browser could not give 4:3 even by cropping (`aspectRatio` exact below). */
export function aspectRefused(cause: unknown) {
  return cause instanceof Error && cause.name === 'OverconstrainedError' && (cause as { constraint?: string }).constraint === 'aspectRatio'
}

/**
 * The plain request (640×480 wished for) opens almost every webcam in 4:3 as before. With `crop`,
 * 4:3 is required and the browser may cut a wider camera down to it (ADR 0048): `crop-and-scale`
 * (Chrome, Edge, the desktop app); a browser that cannot refuses with `OverconstrainedError`.
 */
export function requestCamera(selectedId?: string, acquire?: MediaDevices['getUserMedia'], crop = false): Promise<MediaStream> {
  const request = acquire ?? navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices)
  if (!request) throw new Error(CAMERA_ERRORS.unsupported)
  return request({
    audio: false,
    video: {
      width: { ideal: 640 },
      height: { ideal: 480 },
      // Not in TypeScript's DOM types yet; Chromium uses it to crop instead of refusing.
      ...(crop ? { aspectRatio: { exact: CAMERA_ASPECT }, ...({ resizeMode: 'crop-and-scale' } as MediaTrackConstraints) } : {}),
      frameRate: { ideal: 30, max: 30 },
      facingMode: 'user',
      ...(selectedId ? { deviceId: { exact: selectedId } } : {}),
    },
  })
}

/**
 * Opens the camera in 4:3 (ADR 0048). Most cameras give 4:3 to the plain request; only one that
 * does not is closed and opened again, the same device, with 4:3 required. Still not 4:3: refused.
 */
export async function requestFourByThreeCamera(selectedId?: string, acquire?: MediaDevices['getUserMedia']): Promise<MediaStream> {
  const first = await requestCamera(selectedId, acquire)
  const opened = first.getVideoTracks()[0]?.getSettings()
  // No size reported yet: the picture size is checked again once the video plays.
  if (!opened?.width || !opened.height || isFourByThree(opened.width, opened.height)) return first
  stopCameraTracks(first)
  const cropped = await requestCamera(selectedId || opened.deviceId || undefined, acquire, true)
  const again = cropped.getVideoTracks()[0]?.getSettings()
  if (again?.width && again.height && !isFourByThree(again.width, again.height)) {
    stopCameraTracks(cropped)
    throw new Error(CAMERA_ERRORS.aspectUnsupported)
  }
  return cropped
}

export async function listVideoDevices(): Promise<MediaDeviceInfo[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter((device) => device.kind === 'videoinput')
  } catch (caughtError) {
    console.error('[features/camera/devices.ts:listVideoDevices] Operation failed', caughtError)
    return []
  }
}

export function stopCameraTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop())
}

/** The camera permission as the browser reports it; null where it cannot tell (Firefox, tests). */
export async function cameraPermission(): Promise<PermissionState | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return null
    return (await navigator.permissions.query({ name: 'camera' as PermissionName })).state
  } catch {
    return null
  }
}
