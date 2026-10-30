import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import type { FaceFrame } from './comparison'

// Only /dev constructs this worker. No original frames or face coordinates are persisted.
let detector: FaceLandmarker | null = null
let delegate: 'GPU' | 'CPU' = 'GPU'
let previousTime = -1
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      const vision = await FilesetResolver.forVisionTasks(data.wasmPath)
      const create = (device: 'GPU' | 'CPU') => FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: data.modelPath, delegate: device },
        ...(device === 'GPU' ? { canvas: new OffscreenCanvas(1, 1) } : {}), runningMode: 'VIDEO', numFaces: 1,
        minFaceDetectionConfidence: .5, minFacePresenceConfidence: .5, minTrackingConfidence: .5,
        outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false,
      })
      let fallbackReason: string | null = null
      try { detector = await create('GPU') }
      catch { delegate = 'CPU'; fallbackReason = 'Worker GPU 준비 실패 · CPU로 실행'; detector = await create('CPU') }
      self.postMessage({ type: 'ready', delegate, fallbackReason })
    } catch (error) { self.postMessage({ type: 'error', message: `얼굴 모델 준비 실패: ${error instanceof Error ? error.message.slice(0, 240) : 'Worker 초기화 오류'}` }) }
    return
  }
  if (data.type !== 'frame') return
  const bitmap: ImageBitmap = data.bitmap
  try {
    if (!detector || !Number.isFinite(data.timeMs) || data.timeMs <= previousTime) throw new Error('Invalid frame time')
    previousTime = data.timeMs
    const started = performance.now()
    const result = detector.detectForVideo(bitmap, data.timeMs)
    const inferenceMs = performance.now() - started
    const landmarks = result.faceLandmarks[0]
    const connections = [...FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, ...FaceLandmarker.FACE_LANDMARKS_LIPS]
    const indices = new Set([1, 159, 145, 386, 374, 61, 291, ...connections.flatMap(edge => [edge.start, edge.end])])
    const points = landmarks ? [...indices].map(index => ({ index, x: landmarks[index]?.x ?? NaN, y: landmarks[index]?.y ?? NaN })) : []
    const usable = points.length > 0 && points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)
    const frame: FaceFrame | null = usable ? { timeMs: data.timeMs, videoTimeMs: data.videoTimeMs, width: bitmap.width, height: bitmap.height,
      landmarkCount: landmarks.length, points, edges: connections.map(edge => [edge.start, edge.end]), inferenceMs, delegate } : null
    self.postMessage({ type: 'result', id: data.id, frame, inferenceMs, delegate })
  } catch { self.postMessage({ type: 'error', message: '얼굴 추적 오류 · 기존 Pose 측정은 유지됩니다.' }) }
  finally { bitmap.close() }
}
