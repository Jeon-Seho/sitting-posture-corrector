import { requestCamera, stopCameraTracks } from '../camera/devices'
import { CAMERA_ERRORS } from '../camera/errors'
import { detectorFallback } from '../camera/detectorFallback'
import { startPoseFrameLoop } from '../camera/frameLoop'

/** Inject inputs at the media/model boundary. Never touches getUserMedia or global browser APIs. */
export async function runCameraErrorScenario(
  key: keyof typeof CAMERA_ERRORS,
  delay: (ms: number) => Promise<void>, isCurrent: () => boolean,
  phase: (value: 'permission' | 'connected' | 'tracking' | 'gpu') => void,
  cleanup: (dispose: () => void) => void,
) {
  let stopped = false
  const track = { stop: () => { stopped = true } }
  const stream = { getTracks: () => [track] } as unknown as MediaStream
  const names: Partial<Record<keyof typeof CAMERA_ERRORS, string>> = {
    permissionDenied: 'NotAllowedError', deviceMissing: 'NotFoundError', deviceBusy: 'NotReadableError', deviceUnavailable: 'OverconstrainedError',
  }
  try {
    phase('permission')
    await requestCamera(undefined, async () => {
      await delay(1000)
      if (!isCurrent()) return stream
      if (names[key]) throw new DOMException('Synthetic media request failure', names[key])
      if (key === 'unsupported') throw new Error(CAMERA_ERRORS.unsupported)
      return stream
    })
    if (!isCurrent()) return
    phase('connected')
    await delay(700)
    if (!isCurrent()) return
    if (key === 'preparationFailed' || key === 'preparationTimeout') {
      phase('gpu')
      try {
        const loaded = await detectorFallback(async () => {
          await delay(key === 'preparationTimeout' ? 2400 : 500)
          if (key === 'preparationFailed') throw new Error('Synthetic model asset failure')
          return { close: () => stopCameraTracks(stream) }
        }, isCurrent, 'GPU', key === 'preparationTimeout' ? 1500 : 5000)
        loaded?.detector.close()
      } catch (error) {
        console.error('[developer] Model scenario failed', error)
        throw new Error(CAMERA_ERRORS[key], { cause: error })
      }
    } else if (key === 'trackingFailed') {
      phase('tracking')
      await new Promise<void>(resolve => {
        const stop = startPoseFrameLoop({
          video: { readyState: 2, currentTime: 1, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement,
          detector: { close() {}, detectForVideo() { throw new Error('Synthetic inference failure') } },
          delegate: 'CPU', isCurrent, getCanvas: () => null,
          getVisual: () => ({ mode: 'skeleton', enabled: false, reducedMotion: true, startedAt: 0 }),
          onPoseStarted() {}, onObservation() {}, onFrameUnavailable() {}, onMetrics() {},
          onTrackingError() { stop(); resolve() },
        })
        cleanup(() => { stop(); resolve() })
      })
      if (isCurrent()) throw new Error(CAMERA_ERRORS.trackingFailed)
    } else if (key === 'disconnected') {
      phase('tracking')
      await new Promise<void>(resolve => {
        const source = new EventTarget()
        source.addEventListener('ended', () => { stopCameraTracks(stream); resolve() }, { once: true })
        void delay(800).then(() => source.dispatchEvent(new Event('ended')))
      })
      if (isCurrent()) throw new Error(CAMERA_ERRORS.disconnected)
    } else throw new Error(CAMERA_ERRORS[key])
  } finally {
    if (!stopped) stopCameraTracks(stream)
  }
}
