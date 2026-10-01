import { CAMERA_ERRORS } from './errors'

export function requestCamera(selectedId?: string): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error(CAMERA_ERRORS.unsupported)
  return navigator.mediaDevices.getUserMedia({
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
  } catch {
    return []
  }
}

export function stopCameraTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop())
}
