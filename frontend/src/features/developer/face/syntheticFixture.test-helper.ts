import type { Observation } from '../../camera/types'
import type { FaceFrame } from './comparison'

// Explicitly synthetic geometry. No participant recording or detector accuracy fixture.
export const syntheticObservation = (timeMs = 1000): Observation => {
  const landmarks = Array.from({ length: 13 }, () => ({ x: .5, y: .3, z: 0, visibility: 1 }))
  landmarks[2] = { x: .4, y: .25, z: 0, visibility: 1 }; landmarks[5] = { x: .6, y: .25, z: 0, visibility: 1 }
  landmarks[9] = { x: .45, y: .4, z: 0, visibility: 1 }; landmarks[10] = { x: .55, y: .4, z: 0, visibility: 1 }
  landmarks[11] = { x: .3, y: .6, z: 0, visibility: 1 }; landmarks[12] = { x: .7, y: .6, z: 0, visibility: 1 }
  return { timeMs, videoTimeMs: timeMs, landmarks, worldLandmarks: landmarks.map(p => ({ ...p })), inferenceMs: 10, delegate: 'GPU', width: 640, height: 480, features: null }
}
export const syntheticFace = (timeMs = 1000, dy = 0): FaceFrame => ({ timeMs, videoTimeMs: timeMs, width: 640, height: 480, landmarkCount: 478, inferenceMs: 5, delegate: 'GPU',
  points: [{ index: 1, x: .5, y: .3 + dy }, { index: 159, x: .4, y: .24 + dy }, { index: 145, x: .4, y: .26 + dy },
    { index: 386, x: .6, y: .24 + dy }, { index: 374, x: .6, y: .26 + dy }, { index: 61, x: .45, y: .4 + dy }, { index: 291, x: .55, y: .4 + dy }], edges: [[159, 145], [386, 374], [61, 291]] })
