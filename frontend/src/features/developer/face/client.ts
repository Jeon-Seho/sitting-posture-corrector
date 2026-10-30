import type { Observation } from '../../camera/types'
import type { FaceFrame, FaceDifference } from './comparison'
import { compareFaceToPose } from './comparison'

export type FaceStatus = 'loading' | 'ready' | 'missing' | 'error'
export interface FaceWorkerPort {
  onmessage: ((event: MessageEvent) => void) | null; onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: unknown, transfer?: Transferable[]): void; terminate(): void
}
export interface FaceSample { frame: FaceFrame | null; difference: FaceDifference | null; inferenceMs: number; roundTripMs: number; delegate: 'GPU' | 'CPU' }
export interface FaceClientOptions {
  video: HTMLVideoElement; onStatus: (status: FaceStatus, message?: string, delegate?: string) => void
  onSample: (sample: FaceSample) => void; onExpired: () => void
  worker: () => FaceWorkerPort; bitmap: (video: HTMLVideoElement) => Promise<ImageBitmap>
  now?: () => number; origin: string
}

/** Single frame in flight, bounded readiness/result waits, no mutation of Pose observations. */
export function startFaceClient(options: FaceClientOptions) {
  const now = options.now ?? (() => performance.now())
  const worker = options.worker()
  let active = true, ready = false, busy = false, id = 0, submittedAt = 0, lastOffered = -Infinity
  let current: { id: number; observation: Observation; videoTimeMs: number } | null = null
  let lastFaceAt: number | null = null
  const started = now()
  const fail = (message: string) => { if (!active) return; active = false; worker.terminate(); options.onExpired(); options.onStatus('error', message); clearInterval(watchdog) }
  const watchdog = setInterval(() => {
    if (!ready && now() - started > 20000) fail('얼굴 모델 준비 시간이 초과됐습니다.')
    if (busy && now() - submittedAt > 3000) fail('얼굴 추론 응답이 늦어 추적을 중단했습니다.')
    if (lastFaceAt !== null && now() - lastFaceAt > 500) { lastFaceAt = null; options.onExpired(); options.onStatus('missing', '얼굴 관측이 오래되어 표시를 지웠습니다.') }
  }, 100)
  worker.onerror = () => fail('얼굴 Worker를 실행하지 못했습니다.')
  worker.onmessage = ({ data }) => {
    if (!active) return
    if (data.type === 'ready') { ready = true; options.onStatus('ready', data.fallbackReason ?? '', data.delegate); return }
    if (data.type === 'error') { fail(data.message); return }
    if (data.type !== 'result' || !current || data.id !== current.id) return
    busy = false
    const roundTripMs = now() - submittedAt, observation = current.observation
    const fresh = roundTripMs <= 500 && now() - observation.timeMs <= 500
    const candidate: FaceFrame | null = fresh ? data.frame : null
    const nose = candidate?.points.find(point => point.index === 1), poseNose = observation.landmarks[0]
    const left = observation.landmarks[11], right = observation.landmarks[12]
    const span = left && right ? Math.hypot((left.x - right.x) * observation.width, (left.y - right.y) * observation.height) : 0
    const associated = !!nose && !!poseNose && span > 0 && Math.hypot((nose.x - poseNose.x) * observation.width, (nose.y - poseNose.y) * observation.height) <= span * .5
    const frame: FaceFrame | null = associated ? candidate : null
    const difference = frame ? compareFaceToPose(frame, observation.landmarks.map(p => ({ ...p, visibility: p.visibility ?? 0 })), current.videoTimeMs, observation.width, observation.height) : null
    lastFaceAt = frame ? now() : null
    options.onSample({ frame, difference, inferenceMs: data.inferenceMs, roundTripMs, delegate: data.delegate })
    options.onStatus(frame ? 'ready' : 'missing', frame ? '' : '얼굴을 확인할 수 없어요. 오래된 점은 표시하지 않습니다.', data.delegate)
    current = null
  }
  worker.postMessage({ type: 'init', wasmPath: new URL('/mediapipe/wasm', options.origin).href, modelPath: new URL('/mediapipe/face_landmarker.task', options.origin).href })
  return {
    offer(observation: Observation) {
      const video = options.video
      if (!active || !ready || busy || !Number.isFinite(observation.timeMs) || !Number.isFinite(observation.videoTimeMs) || observation.timeMs - lastOffered < 100 || video.readyState < 2) return
      // A video frame that has advanced since Pose inference is not a matched comparison.
      if (Math.abs(video.currentTime * 1000 - observation.videoTimeMs) > 1) return
      busy = true; submittedAt = now(); lastOffered = observation.timeMs
      const request = { id: ++id, observation, videoTimeMs: observation.videoTimeMs }
      current = request
      void options.bitmap(video).then(bitmap => {
        if (!active || current !== request) { bitmap.close(); return }
        try { worker.postMessage({ type: 'frame', id: request.id, bitmap, timeMs: observation.timeMs, videoTimeMs: request.videoTimeMs }, [bitmap]) }
        catch { bitmap.close(); fail('영상 프레임을 얼굴 Worker에 전달하지 못했습니다.') }
      }).catch(() => fail('얼굴 비교용 영상 프레임을 읽지 못했습니다.'))
    },
    stop() { active = false; clearInterval(watchdog); current = null; worker.terminate() },
  }
}
