import {
  POSES,
  SCENARIO,
  SCENARIO_SECONDS,
  type Features,
  type Keypoints,
  type Point,
} from '../../../data/posture'
import type { Machine, Sample } from './types'

const BLEND_SECONDS = 1.2
const JOINTS = Object.keys(POSES.upright.keypoints) as (keyof Keypoints)[]

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

export function blendKeypoints(a: Keypoints, b: Keypoints, t: number, time: number): Keypoints {
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

export function blendFeatures(a: Features, b: Features, t: number): Features {
  return {
    neckForward: lerp(a.neckForward, b.neckForward, t),
    shoulderTilt: lerp(a.shoulderTilt, b.shoulderTilt, t),
    trunkTilt: lerp(a.trunkTilt, b.trunkTilt, t),
    lateralBalance: lerp(a.lateralBalance, b.lateralBalance, t),
  }
}
