import {
  DEFAULT_RULES,
  POSES,
  SCENARIO,
  SCENARIO_SECONDS,
  type CollapseType,
  type Features,
  type Keypoints,
  type Point,
  type PostureState,
  type Segment,
} from '../data/posture'

export type Rules = typeof DEFAULT_RULES
export type SessionPhase = 'running' | 'paused' | 'ended'

const BLEND_SECONDS = 1.2
const JOINTS = Object.keys(POSES.upright.keypoints) as (keyof Keypoints)[]

export type CollapseEvent = {
  id: number
  type: CollapseType
  /** 붕괴 확률이 임계값을 넘은 시각 */
  startAt: number
  /** 지속 조건을 충족해 이벤트로 확정된 시각 */
  confirmedAt: number
  endAt: number | null
  durationSec: number
  alerts: number
  firstAlertAt: number
  recovered: boolean
  /** 최초 알림부터 정상 복귀까지 */
  recoverySec: number | null
  /** 측정 종료로 끊긴 이벤트인지 */
  endedBySession: boolean
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
}

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
  }
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
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t)
}

/** 시나리오 위치에서 현재 프레임의 추정 결과를 만든다 */
export function sampleAt(loop: number): Sample {
  let acc = 0
  let i = SCENARIO.length - 1
  let within = 0
  for (let k = 0; k < SCENARIO.length; k++) {
    if (loop < acc + SCENARIO[k].seconds) {
      i = k
      within = loop - acc
      break
    }
    acc += SCENARIO[k].seconds
  }
  const seg = SCENARIO[i]
  const prev = SCENARIO[(i - 1 + SCENARIO.length) % SCENARIO.length]
  const t = smoothstep(Math.min(within / BLEND_SECONDS, 1))
  return {
    seg,
    prev,
    t,
    state: seg.state,
    collapse: seg.collapse ?? null,
    notice: seg.notice ?? null,
    prob: lerp(POSES[prev.pose].collapseProb, POSES[seg.pose].collapseProb, t),
    confidence: lerp(POSES[prev.pose].confidence, POSES[seg.pose].confidence, t),
  }
}

/**
 * 한 프레임 진행. 계획서의 이벤트 규칙을 그대로 돌린다.
 * 붕괴 확률이 임계값 이상으로 지속 시간을 채워야 이벤트가 확정되고,
 * 재알림은 간격만큼 눌러 두며, 판정 불가 구간에서는 판정을 멈춘다.
 */
export function step(m: Machine, dt: number, phase: SessionPhase, rules: Rules): Sample {
  m.total += dt
  if (phase === 'paused') m.paused += dt
  else m.loop = (m.loop + dt) % SCENARIO_SECONDS

  const s = sampleAt(m.loop)
  if (phase !== 'running') return s

  if (s.state === 'unknown') m.unknown += dt
  else if (s.state === 'good') m.good += dt
  else m.collapse += dt

  if (s.state === 'unknown') {
    // 판정 불가 구간에서는 붕괴 판정도 복귀 판정도 하지 않는다
    m.hold = 0
    m.recover = 0
    return s
  }

  if (s.prob >= rules.threshold) {
    m.recover = 0
    if (m.onsetAt === null) m.onsetAt = m.total
    m.hold += dt

    if (!m.active && m.hold >= rules.holdSeconds) {
      const ev: CollapseEvent = {
        id: m.nextId++,
        type: s.collapse ?? 'forwardHead',
        startAt: m.onsetAt,
        confirmedAt: m.total,
        endAt: null,
        durationSec: 0,
        alerts: 1,
        firstAlertAt: m.total,
        recovered: false,
        recoverySec: null,
        endedBySession: false,
      }
      m.active = ev
      m.events = [ev, ...m.events].slice(0, 40)
      m.lastAlertAt = m.total
      m.alertTick += 1
    } else if (m.active && m.total - m.lastAlertAt >= rules.realertSeconds) {
      const bumped = { ...m.active, alerts: m.active.alerts + 1 }
      m.active = bumped
      m.events = m.events.map((e) => (e.id === bumped.id ? bumped : e))
      m.lastAlertAt = m.total
      m.alertTick += 1
    }
    return s
  }

  m.hold = 0
  m.onsetAt = null
  if (m.active) {
    m.recover += dt
    if (m.recover >= rules.recoverSeconds) {
      const closed: CollapseEvent = {
        ...m.active,
        endAt: m.total,
        durationSec: m.total - m.active.startAt,
        recovered: true,
        recoverySec: m.total - m.active.firstAlertAt,
      }
      m.events = m.events.map((e) => (e.id === closed.id ? closed : e))
      m.active = null
      m.recover = 0
    }
  }
  return s
}

/**
 * 시연 중 다음 시나리오 구간으로 건너뛴다.
 * 발표에서 붕괴 구간이 올 때까지 기다리지 않으려고 둔 조작이다.
 */
export function seekNextSegment(m: Machine) {
  let acc = 0
  for (const seg of SCENARIO) {
    if (m.loop < acc + seg.seconds) {
      m.loop = (acc + seg.seconds) % SCENARIO_SECONDS
      return
    }
    acc += seg.seconds
  }
  m.loop = 0
}

/** 측정 종료 시점에 열려 있던 이벤트는 세션 종료로 끊긴 것으로 남긴다 */
export function closeOpenEvent(m: Machine) {
  if (!m.active) return
  const ev: CollapseEvent = {
    ...m.active,
    endAt: m.total,
    durationSec: m.total - m.active.startAt,
    recovered: false,
    recoverySec: null,
    endedBySession: true,
  }
  m.events = m.events.map((e) => (e.id === ev.id ? ev : e))
  m.active = null
}

function blendKeypoints(a: Keypoints, b: Keypoints, t: number, time: number): Keypoints {
  // 정지 화면처럼 보이지 않도록 호흡과 미세 흔들림을 얹는다
  const swayX = Math.sin(time * 1.05) * 0.3
  const swayY = Math.sin(time * 0.73 + 1.2) * 0.26
  const breath = Math.sin(time * 1.6) * 0.2
  const out = {} as Keypoints
  for (const j of JOINTS) {
    const head = j === 'nose' || j.endsWith('Eye') || j.endsWith('Ear')
    const k = head ? 1.5 : 1
    out[j] = [
      lerp(a[j][0], b[j][0], t) + swayX * k,
      lerp(a[j][1], b[j][1], t) + swayY * k + breath,
    ] as Point
  }
  return out
}

function blendFeatures(a: Features, b: Features, t: number): Features {
  return {
    neckForward: lerp(a.neckForward, b.neckForward, t),
    shoulderTilt: lerp(a.shoulderTilt, b.shoulderTilt, t),
    trunkTilt: lerp(a.trunkTilt, b.trunkTilt, t),
    lateralBalance: lerp(a.lateralBalance, b.lateralBalance, t),
  }
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
}

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
  }
}

export const EMPTY_LIVE: LiveState = snapshot(newMachine(), sampleAt(0), DEFAULT_RULES)
