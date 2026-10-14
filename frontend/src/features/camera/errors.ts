export const CAMERA_ERRORS = {
  unsupported:
    '이 브라우저에서는 카메라를 쓸 수 없어요. localhost 또는 HTTPS 주소를 Chrome으로 열어 주세요.',
  preparationTimeout: '카메라 준비가 오래 걸려요. 권한 창과 연결을 확인한 뒤 다시 시도해 주세요.',
  videoUnavailable: '카메라 화면을 준비하지 못했어요. 다시 시도해 주세요.',
  disconnected: '카메라 연결이 끊겼어요. 다시 연결해 주세요.',
  trackingFailed: '자세 추적을 이어갈 수 없어요. 카메라를 다시 연결해 주세요.',
  permissionDenied:
    '카메라 권한이 꺼져 있어요. 사이트 권한에서 카메라를 허용해 주세요.',
  deviceMissing:
    '연결된 카메라가 없어요. 카메라를 연결해 주세요. 기록은 카메라 없이도 볼 수 있어요.',
  deviceBusy: '다른 앱이 카메라를 쓰고 있을 수 있어요. 그 앱을 닫고 다시 시도해 주세요.',
  deviceUnavailable:
    '고른 카메라를 쓸 수 없어요. 다른 카메라를 고르거나 다시 연결해 주세요.',
  preparationFailed:
    '카메라나 자세 추적 모델을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.',
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
