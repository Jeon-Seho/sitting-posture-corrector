import {
  DEFAULT_RULES,
  type CollapseType,
  type Features,
  type Keypoints,
  type PostureState,
  type Segment,
} from '../../../data/posture'

export type Rules = typeof DEFAULT_RULES
export type SessionPhase = 'running' | 'paused' | 'ended'
export type EvaluationScope = 'head'|'upper_body'
export type EvaluationCounts = Record<EvaluationScope,{valid:number;good:number}>

export type CollapseEvent = {
  id: number
  type: CollapseType
  /** 변화 점수(시연에서는 합성 점수)가 임계값을 넘은 시각 */
  startAt: number
  /** 사건 시작까지의 유효 관측 시간. 휴식·측정 불가·누락은 제외한다. 과거 기록에는 없을 수 있다. */
  validStartAt?: number
  /** 지속 조건을 충족해 이벤트로 확정된 시각 */
  confirmedAt: number
  endAt: number | null
  durationSec: number
  alerts: number
  firstAlertAt: number | null
  recovered: boolean
  /** 최초 알림부터 정상 복귀까지 */
  recoverySec: number | null
  /** 측정 종료로 끊긴 이벤트인지 */
  endedBySession: boolean
  endReason: 'paused' | 'unknown' | 'ended' | null
  blockId: number
  evaluationScope?: EvaluationScope
}

export type Machine = {
  loop: number
  total: number
  paused: number
  unknown: number
  good: number
  collapse: number
  hold: number
  recover: number
  onsetAt: number | null
  active: CollapseEvent | null
  events: CollapseEvent[]
  nextId: number
  lastAlertAt: number
  alertTick: number
  blockId: number
  interrupted: boolean
  /** Seconds per direction during the current hold; the episode takes the dominant one. */
  holdKinds?: Partial<Record<CollapseType, number>>
  evaluationCounts?: EvaluationCounts
  evaluationScope?: EvaluationScope
}

export type Sample = {
  seg: Segment
  prev: Segment
  t: number
  state: PostureState
  collapse: CollapseType | null
  notice: string | null
  prob: number
  confidence: number
  evaluationScope?: EvaluationScope
}

export type LiveState = {
  state: PostureState
  collapse: CollapseType | null
  notice: string | null
  keypoints: Keypoints
  features: Features
  confidence: number
  collapseProb: number
  holdProgress: number
  recoverProgress: number
  alerting: boolean
  nextAlertIn: number | null
  totalSeconds: number
  pausedSeconds: number
  unknownSeconds: number
  validSeconds: number
  goodSeconds: number
  collapseSeconds: number
  events: CollapseEvent[]
  alertTick: number
  evaluationCounts?: EvaluationCounts
}
