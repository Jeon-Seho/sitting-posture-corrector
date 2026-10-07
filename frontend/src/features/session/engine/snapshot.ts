import { DEFAULT_RULES, POSES } from '../../../data/posture'
import { newMachine } from './machine'
import { sampleAt, blendKeypoints, blendFeatures } from './scenario'
import type { LiveState, Machine, Rules, Sample } from './types'

export function snapshot(m: Machine, s: Sample, rules: Rules): LiveState {
  return {
    state: s.state,
    collapse: s.collapse,
    notice: s.notice,
    keypoints: blendKeypoints(
      POSES[s.prev.pose].keypoints,
      POSES[s.seg.pose].keypoints,
      s.t,
      m.total,
    ),
    features: blendFeatures(POSES[s.prev.pose].features, POSES[s.seg.pose].features, s.t),
    confidence: s.confidence,
    collapseProb: s.prob,
    holdProgress: Math.min(m.hold / rules.holdSeconds, 1),
    recoverProgress: m.active ? Math.min(m.recover / rules.recoverSeconds, 1) : 0,
    alerting: m.active !== null,
    nextAlertIn: m.active ? Math.max(0, rules.realertSeconds - (m.total - m.lastAlertAt)) : null,
    totalSeconds: m.total,
    pausedSeconds: m.paused,
    unknownSeconds: m.unknown,
    // 유효 측정 시간 = 전체 − 일시정지 − 판정 불가
    validSeconds: Math.max(0, m.total - m.paused - m.unknown),
    goodSeconds: m.good,
    collapseSeconds: m.collapse,
    events: m.events,
    alertTick: m.alertTick,
    ...(m.evaluationCounts?{evaluationCounts:structuredClone(m.evaluationCounts)}:{}),
  }
}

export const EMPTY_LIVE: LiveState = snapshot(newMachine(), sampleAt(0), DEFAULT_RULES)
