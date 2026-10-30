import { CAMERA_ERRORS } from './errors'

export function requestCamera(selectedId?: string, acquire?: MediaDevices['getUserMedia']): Promise<MediaStream> {
  const request = acquire ?? navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices)
  if (!request) throw new Error(CAMERA_ERRORS.unsupported)
  return request({
    audio: false,
    video: {
      width: { ideal: 640 },
      height: { ideal: 480 },
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
