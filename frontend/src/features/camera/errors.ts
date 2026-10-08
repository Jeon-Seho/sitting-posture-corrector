export const CAMERA_ERRORS = {
  unsupported:
    '이 브라우저에서는 카메라를 사용할 수 없습니다. localhost 또는 HTTPS에서 Chrome으로 열어주세요.',
  preparationTimeout: '카메라 준비가 오래 걸립니다. 권한 창과 연결을 확인한 뒤 다시 시도해 주세요.',
  videoUnavailable: '카메라 화면을 준비하지 못했습니다. 다시 시도해 주세요.',
  disconnected: '카메라 연결이 끊겼습니다. 다시 연결해 주세요.',
  trackingFailed: '자세 추적을 이어갈 수 없습니다. 카메라를 다시 연결해 주세요.',
  permissionDenied:
    '카메라 권한이 거부되었습니다. 브라우저의 사이트 권한에서 카메라를 허용해 주세요.',
  deviceMissing:
    '연결된 카메라가 없습니다. 카메라를 연결해 주세요. 홈과 저장된 기록은 카메라 없이 볼 수 있습니다.',
  deviceBusy: '카메라를 다른 앱에서 사용 중일 수 있습니다. 사용 중인 앱을 닫고 다시 시도해 주세요.',
  deviceUnavailable:
    '선택한 카메라를 사용할 수 없습니다. 다른 장치를 선택하거나 다시 연결해 주세요.',
  preparationFailed:
    '카메라 또는 자세 추적 모델을 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.',
}

export function cameraPreparationError(cause: unknown): string {
  const name = cause instanceof Error ? cause.name : ''
  switch (name) {
    case 'NotAllowedError':
      return CAMERA_ERRORS.permissionDenied
    case 'NotFoundError':
      return CAMERA_ERRORS.deviceMissing
    case 'NotReadableError':
      return CAMERA_ERRORS.deviceBusy
  }
  if (cause instanceof Error && cause.message.startsWith('이 브라우저')) return cause.message
  if (name === 'OverconstrainedError') return CAMERA_ERRORS.deviceUnavailable
  return CAMERA_ERRORS.preparationFailed
}
