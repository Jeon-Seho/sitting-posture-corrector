/**
 * 계획서 기준 자세 판정 모델.
 * 상태는 바른 자세 / 자세 붕괴 / 판정 불가 3종이며,
 * 붕괴는 거북목·기울어짐 하위 유형으로 나뉜다.
 */

export type Point = [number, number]

export type Keypoints = {
  nose: Point
  leftEye: Point
  rightEye: Point
  leftEar: Point
  rightEar: Point
  neck: Point
  leftShoulder: Point
  rightShoulder: Point
  leftElbow: Point
  rightElbow: Point
  leftWrist: Point
  rightWrist: Point
  leftHip: Point
  rightHip: Point
}

export type PostureState = 'good' | 'collapse' | 'unknown'
export type CollapseType = 'forwardHead' | 'tilt'

export const STATE_LABEL: Record<PostureState, string> = {
  good: '바른 자세',
  collapse: '자세 붕괴',
  unknown: '판정 불가',
}

export const COLLAPSE_LABEL: Record<CollapseType, string> = {
  forwardHead: '거북목',
  tilt: '기울어짐',
}

/** 계획서의 특징값: 목 전방 이동, 어깨 기울기, 상체 기울기, 좌우 균형 */
export type Features = {
  neckForward: number
  shoulderTilt: number
  trunkTilt: number
  lateralBalance: number
}

export type PoseId = 'upright' | 'forwardHead' | 'tilt' | 'away'

export type Pose = {
  id: PoseId
  keypoints: Keypoints
  features: Features
  /** MediaPipe 검출 신뢰도 (0~1) */
  confidence: number
  /** LSTM이 내놓는 붕괴 클래스 확률 (0~1) */
  collapseProb: number
}

/**
 * 좌표계는 100 x 100 정규 공간. 웹캠 상반신 정면 뷰 기준이고
 * x가 작을수록 화면 왼쪽이다. 추정 모델 없이 시연용으로 잡은 값.
 */
export const POSES: Record<PoseId, Pose> = {
  upright: {
    id: 'upright',
    confidence: 0.96,
    collapseProb: 0.06,
    features: { neckForward: 7, shoulderTilt: 1.2, trunkTilt: 2.0, lateralBalance: 97 },
    keypoints: {
      nose: [50, 30],
      leftEye: [45.5, 27],
      rightEye: [54.5, 27],
      leftEar: [41, 29],
      rightEar: [59, 29],
      neck: [50, 42],
      leftShoulder: [34, 48],
      rightShoulder: [66, 48],
      leftElbow: [28, 68],
      rightElbow: [72, 68],
      leftWrist: [34, 84],
      rightWrist: [66, 84],
      leftHip: [39, 92],
      rightHip: [61, 92],
    },
  },
  forwardHead: {
    id: 'forwardHead',
    confidence: 0.94,
    collapseProb: 0.91,
    features: { neckForward: 34, shoulderTilt: 2.4, trunkTilt: 16, lateralBalance: 94 },
    keypoints: {
      nose: [50, 37],
      leftEye: [44.5, 33.5],
      rightEye: [55.5, 33.5],
      leftEar: [39.5, 36],
      rightEar: [60.5, 36],
      neck: [50, 47],
      leftShoulder: [35, 54],
      rightShoulder: [65, 54],
      leftElbow: [28, 71],
      rightElbow: [72, 71],
      leftWrist: [34, 85],
      rightWrist: [66, 85],
      leftHip: [39, 93],
      rightHip: [61, 93],
    },
  },
  tilt: {
    id: 'tilt',
    confidence: 0.93,
    collapseProb: 0.86,
    features: { neckForward: 15, shoulderTilt: 11.4, trunkTilt: 9.5, lateralBalance: 71 },
    keypoints: {
      nose: [54, 31],
      leftEye: [49.5, 28.5],
      rightEye: [58, 26],
      leftEar: [45, 31.5],
      rightEar: [62.5, 27],
      neck: [52, 43],
      leftShoulder: [36, 44],
      rightShoulder: [68, 53],
      leftElbow: [30, 64],
      rightElbow: [75, 72],
      leftWrist: [36, 81],
      rightWrist: [69, 88],
      leftHip: [40, 92],
      rightHip: [62, 93],
    },
  },
  /** 자리 비움·부분 가림. 키포인트가 화면 밖으로 빠진 상태 */
  away: {
    id: 'away',
    confidence: 0.28,
    collapseProb: 0.14,
    features: { neckForward: 0, shoulderTilt: 0, trunkTilt: 0, lateralBalance: 0 },
    keypoints: {
      nose: [16, 34],
      leftEye: [11, 31],
      rightEye: [20, 31],
      leftEar: [7, 33],
      rightEar: [25, 33],
      neck: [17, 46],
      leftShoulder: [2, 52],
      rightShoulder: [33, 52],
      leftElbow: [-4, 72],
      rightElbow: [39, 72],
      leftWrist: [1, 88],
      rightWrist: [33, 88],
      leftHip: [6, 94],
      rightHip: [28, 94],
    },
  },
}

/** 뼈대를 그릴 때 이을 관절 쌍 */
export const BONES: [keyof Keypoints, keyof Keypoints][] = [
  ['leftEar', 'leftEye'],
  ['leftEye', 'nose'],
  ['nose', 'rightEye'],
  ['rightEye', 'rightEar'],
  ['nose', 'neck'],
  ['neck', 'leftShoulder'],
  ['neck', 'rightShoulder'],
  ['leftShoulder', 'leftElbow'],
  ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'],
  ['rightElbow', 'rightWrist'],
  ['leftShoulder', 'leftHip'],
  ['rightShoulder', 'rightHip'],
  ['leftHip', 'rightHip'],
]

export type Segment = {
  pose: PoseId
  state: PostureState
  collapse?: CollapseType
  /** 시뮬레이션 기준 초 */
  seconds: number
  /** 판정 불가 구간에서 보여줄 안내 */
  notice?: string
}

/**
 * 시연 시나리오. 계획서의 이벤트 규칙(3초 지속 확정, 60초 재알림,
 * 판정 불가 구간 제외)이 화면에서 모두 한 번씩 나타나도록 구성했다.
 */
export const SCENARIO: Segment[] = [
  { pose: 'upright', state: 'good', seconds: 46 },
  { pose: 'forwardHead', state: 'collapse', collapse: 'forwardHead', seconds: 14 },
  { pose: 'upright', state: 'good', seconds: 40 },
  { pose: 'tilt', state: 'collapse', collapse: 'tilt', seconds: 11 },
  { pose: 'upright', state: 'good', seconds: 38 },
  {
    pose: 'away',
    state: 'unknown',
    seconds: 18,
    notice: '상반신이 화면을 벗어났습니다. 카메라 위치나 조명을 확인해 주세요.',
  },
  { pose: 'upright', state: 'good', seconds: 52 },
  // 재알림 간격이 한 번 걸리도록 일부러 길게 끄는 구간
  { pose: 'forwardHead', state: 'collapse', collapse: 'forwardHead', seconds: 72 },
  { pose: 'upright', state: 'good', seconds: 40 },
  { pose: 'tilt', state: 'collapse', collapse: 'tilt', seconds: 13 },
  { pose: 'upright', state: 'good', seconds: 41 },
]

export const SCENARIO_SECONDS = SCENARIO.reduce((a, s) => a + s.seconds, 0)

/** 계획서에 후보로 적힌 판정 파라미터 */
export const DEFAULT_RULES = {
  /** 붕괴 확정까지 필요한 지속 시간(초) */
  holdSeconds: 3,
  /** 정상 복귀로 인정할 유지 시간(초) */
  recoverSeconds: 2,
  /** 같은 이벤트 재알림 간격(초) */
  realertSeconds: 60,
  /** 붕괴 판정 확률 임계값 */
  threshold: 0.7,
}

export const MODEL_VERSION = 'lstm-v0.3.1'
