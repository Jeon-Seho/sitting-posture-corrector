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
 * 4:3 is required (ADR 0048): `crop-and-scale` lets the browser cut a 16:9 camera down to 4:3
 * (Chrome, Edge, the desktop app). A browser that cannot refuses with `OverconstrainedError`.
 */
export function requestCamera(selectedId?: string, acquire?: MediaDevices['getUserMedia']): Promise<MediaStream> {
  const request = acquire ?? navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices)
  if (!request) throw new Error(CAMERA_ERRORS.unsupported)
  return request({
    audio: false,
    video: {
      width: { ideal: 640 },
      height: { ideal: 480 },
      aspectRatio: { exact: CAMERA_ASPECT },
      // Not in TypeScript's DOM types yet; Chromium uses it to crop instead of refusing.
      ...({ resizeMode: 'crop-and-scale' } as MediaTrackConstraints),
      frameRate: { ideal: 30, max: 30 },
      facingMode: 'user',
      ...(selectedId ? { deviceId: { exact: selectedId } } : {}),
    },
  })
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
