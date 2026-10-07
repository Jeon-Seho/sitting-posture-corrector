import { SCENARIO_SECONDS, type CollapseType } from '../../../data/posture'
import { sampleAt } from './scenario'
import type { CollapseEvent, Machine, Rules, Sample, SessionPhase } from './types'

export function newMachine(): Machine {
  return {
    loop: 0,
    total: 0,
    paused: 0,
    unknown: 0,
    good: 0,
    collapse: 0,
    hold: 0,
    recover: 0,
    onsetAt: null,
    active: null,
    events: [],
    nextId: 1,
    lastAlertAt: 0,
    alertTick: 0,
    blockId: 0,
    interrupted: false,
  }
}

/**
 * 한 프레임 진행. 계획서의 이벤트 규칙을 그대로 돌린다.
 * 변화 점수(시연에서는 합성 점수)가 임계값 이상으로 지속 시간을 채워야 이벤트가 확정되고,
 * 재알림은 간격만큼 눌러 두며, 판정 불가 구간에서는 판정을 멈춘다.
 */
export function step(
  m: Machine,
  dt: number,
  phase: SessionPhase,
  rules: Rules,
  external?: Sample,
  alertsOn = true,
): Sample {
  const raw =
    external ??
    sampleAt(
      (m.loop + (phase === 'running' && Number.isFinite(dt) ? Math.max(0, dt) : 0)) %
        SCENARIO_SECONDS,
    )
  const measurable =
    raw.state !== 'unknown' &&
    Number.isFinite(raw.prob) &&
    raw.prob >= 0 &&
    raw.prob <= 1 &&
    Number.isFinite(raw.confidence) &&
    raw.confidence >= 0 &&
    raw.confidence <= 1
  const s: Sample = measurable
    ? { ...raw, state: raw.prob >= rules.threshold ? 'collapse' : 'good' }
    : { ...raw, state: 'unknown', prob: 0, confidence: 0, collapse: null }
  if (!Number.isFinite(dt) || dt < 0 || phase === 'ended') return s
  if (!external && phase === 'running') m.loop = (m.loop + dt) % SCENARIO_SECONDS
  if (phase === 'paused') {
    interrupt(m, 'paused')
    m.total += dt
    m.paused += dt
    return s
  }
  if (s.state === 'unknown') {
    interrupt(m, 'unknown')
    m.total += dt
    m.unknown += dt
    return s
  }
  if(s.evaluationScope){
    if(m.evaluationScope&&m.evaluationScope!==s.evaluationScope)interrupt(m,'unknown')
    m.evaluationScope=s.evaluationScope
    m.evaluationCounts??={head:{valid:0,good:0},upper_body:{valid:0,good:0}}
    m.evaluationCounts[s.evaluationScope].valid+=dt
    if(s.state==='good')m.evaluationCounts[s.evaluationScope].good+=dt
  }
  m.total += dt
  m.interrupted = false
  if (s.state === 'good') m.good += dt
  else m.collapse += dt

  if (s.prob >= rules.threshold) {
    m.recover = 0
    if (m.onsetAt === null) m.onsetAt = Math.max(0, m.total - dt)
    m.hold += dt
    if (s.collapse) m.holdKinds = { ...m.holdKinds, [s.collapse]: (m.holdKinds?.[s.collapse] ?? 0) + dt }
    if (!m.active && m.hold + 1e-8 >= rules.holdSeconds) {
      const ev: CollapseEvent = {
        id: m.nextId++,
        // One noisy frame at confirmation must not decide the direction of the whole episode.
        type: dominantKind(m.holdKinds) ?? s.collapse ?? 'forwardHead',
        startAt: m.onsetAt,
        validStartAt: Math.max(0, m.total - m.paused - m.unknown - m.hold),
        confirmedAt: m.total,
        endAt: null,
        durationSec: 0,
        alerts: 0,
        firstAlertAt: null,
        recovered: false,
        recoverySec: null,
        endedBySession: false,
        endReason: null,
        blockId: m.blockId,
        ...(s.evaluationScope?{evaluationScope:s.evaluationScope}:{}),
      }
      m.active = ev
      m.events = [ev, ...m.events]
    }
    if (
      m.active &&
      alertsOn &&
      (m.active.firstAlertAt === null || m.total - m.lastAlertAt >= rules.realertSeconds)
    ) {
      const bumped = {
        ...m.active,
        alerts: m.active.alerts + 1,
        firstAlertAt: m.active.firstAlertAt ?? m.total,
      }
      m.active = bumped
      m.events = m.events.map((e) => (e.id === bumped.id ? bumped : e))
      m.lastAlertAt = m.total
      m.alertTick++
    }
    return s
  }
  m.hold = 0
  m.onsetAt = null
  delete m.holdKinds
  if (m.active) {
    m.recover += dt
    if (m.recover + 1e-8 >= rules.recoverSeconds) {
      const closed: CollapseEvent = {
        ...m.active,
        endAt: m.total,
        durationSec: m.total - m.active.startAt,
        recovered: true,
        recoverySec: m.active.firstAlertAt === null ? null : m.total - m.active.firstAlertAt,
      }
      m.events = m.events.map((e) => (e.id === closed.id ? closed : e))
      m.active = null
      m.recover = 0
    }
  }
  return s
}

function dominantKind(kinds: Machine['holdKinds']): CollapseType | null {
  let best: CollapseType | null = null
  for (const [kind, seconds] of Object.entries(kinds ?? {}) as [CollapseType, number][])
    if (best === null || seconds > (kinds![best] ?? 0)) best = kind
  return best
}

function interrupt(m: Machine, reason: 'paused' | 'unknown') {
  closeOpenEvent(m, reason)
  if (!m.interrupted) m.blockId++
  m.interrupted = true
}

/** 측정 종료 시점에 열려 있던 이벤트는 세션 종료로 끊긴 것으로 남긴다 */
export function closeOpenEvent(m: Machine, reason: 'paused' | 'unknown' | 'ended' = 'ended') {
  if (m.active) {
    const ev: CollapseEvent = {
      ...m.active,
      endAt: m.total,
      durationSec: m.total - m.active.startAt,
      recovered: false,
      recoverySec: null,
      endedBySession: reason === 'ended',
      endReason: reason,
    }
    m.events = m.events.map((e) => (e.id === ev.id ? ev : e))
    m.active = null
  }
  m.hold = 0
  m.recover = 0
  m.onsetAt = null
  delete m.holdKinds
}
