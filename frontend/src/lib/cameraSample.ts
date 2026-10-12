import { referenceScore } from '../../../model/prototype/pose'
import type { CameraController } from '../hooks/useCamera'
import { sampleAt, type Sample } from './engine'
import type { ReturnSettle } from './returnSettle'

export function cameraSample(camera: CameraController): Sample {
  const base = sampleAt(0)
  const current = camera.current.current
  const age = performance.now() - camera.lastFrame.current
  if (
    camera.state !== 'on' ||
    !camera.baseline ||
    !current ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > 1000
  ) {
    return {
      ...base,
      state: 'unknown',
      collapse: null,
      confidence: 0,
      prob: 0,
      notice: camera.error || '얼굴과 양쪽 어깨가 보이는지 확인해 주세요.',
    }
  }
  const result = referenceScore(current, camera.baseline)
  if (result.score === null)
    return {
      ...base,
      state: 'unknown',
      headTurn: result.headTurn,
      collapse: null,
      confidence: 0,
      prob: 0,
      notice: result.headTurn
        ? '고개를 돌린 동안은 자세를 판정하지 않아요.'
        : '측정 품질을 확인할 수 없습니다. 얼굴과 양쪽 어깨를 확인해 주세요.',
    }
  return {
    ...base,
    state: result.score >= 0.7 ? 'collapse' : 'good',
    collapse: result.tilt ? 'tilt' : 'forwardHead',
    confidence: current.quality,
    prob: result.score,
    notice: null,
  }
}

/**
 * Right after an unknown sample the user is still getting back into position: keep the
 * sample unknown (no score, no good or collapse time) until the settle time has passed.
 */
export function holdWhileSettling(sample: Sample, settle: ReturnSettle, timeMs: number): Sample {
  const observed =
    sample.state !== 'unknown' ? 'measurable' : sample.headTurn ? 'head_turn' : 'unmeasurable'
  if (settle.judge(timeMs, observed) || sample.state === 'unknown') return sample
  return {
    ...sample,
    state: 'unknown',
    collapse: null,
    confidence: 0,
    prob: 0,
    notice: '자세를 다시 잡는 중이에요. 잠시 후 측정을 이어가요.',
  }
}
