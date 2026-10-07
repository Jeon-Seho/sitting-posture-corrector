import { referenceScore } from '../../../model/prototype/pose'
import type { CameraController } from '../hooks/useCamera'
import { sampleAt, type Sample } from './engine'

export function cameraSample(camera: CameraController): Sample {
  const base = sampleAt(0)
  const current = camera.current.current
  const age = performance.now() - camera.lastFrame.current
  if(camera.face){
    if(camera.state==='on'&&camera.baseline&&Number.isFinite(age)&&age>=0&&age<=800)return camera.face.sample()
    return {...base,state:'unknown',collapse:null,confidence:0,prob:0,notice:camera.error||'얼굴 추적 확인 중 · 점수 유지'}
  }
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
      collapse: null,
      confidence: 0,
      prob: 0,
      notice: '측정 품질을 확인할 수 없습니다. 얼굴과 양쪽 어깨를 확인해 주세요.',
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
