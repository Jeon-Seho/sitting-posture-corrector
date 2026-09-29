import { referenceScore } from '../../../model/prototype/pose'
import type { CameraController } from '../hooks/useCamera'
import { sampleAt, type Sample } from './engine'

export function cameraSample(camera: CameraController): Sample {
  const base = sampleAt(0)
  const current = camera.current.current
  if (!camera.baseline || !current || performance.now() - camera.lastFrame.current > 1000) {
    return { ...base, state: 'unknown', collapse: null, confidence: 0, prob: 0,
      notice: camera.error || '얼굴과 양쪽 어깨가 보이는지 확인해 주세요.' }
  }
  const result = referenceScore(current, camera.baseline)
  return { ...base, state: result.score >= 0.7 ? 'collapse' : 'good', collapse: result.tilt ? 'tilt' : 'forwardHead',
    confidence: current.quality, prob: result.score, notice: null }
}
