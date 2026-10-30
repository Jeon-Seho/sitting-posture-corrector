import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import modelAsset from '../../../model-asset.json'
import { createCpuWorker, type PoseDetector } from './cpuWorker'
import type { CameraDelegate } from './types'
import { detectorFallback } from './detectorFallback'
import { probeAcceleration, reportPerformance } from './acceleration'

type LoadedPoseDetector = { detector: PoseDetector; delegate: CameraDelegate }

/** A canceled connection never adopts a late model or starts a CPU retry. */
export async function loadPoseDetector(
  isCurrent: () => boolean,
  preferred: CameraDelegate = 'GPU',
): Promise<LoadedPoseDetector | null> {
  if (!isCurrent()) return null
  if (preferred === 'GPU' && probeAcceleration() === 'limited') reportPerformance('limited')
  const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
  if (!isCurrent()) return null

  const createDetector = async (delegate: CameraDelegate): Promise<PoseDetector> => {
    const options = {
      baseOptions: { modelAssetPath: new URL(`/mediapipe/${modelAsset.filename}`, typeof location === 'undefined' ? 'http://localhost' : location.href).href, delegate },
      runningMode: 'VIDEO' as const,
      numPoses: 1,
      minPoseDetectionConfidence: 0.6,
      minPosePresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    }
    if (delegate === 'CPU' && typeof Worker !== 'undefined' && typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined') {
      try { return await createCpuWorker(options) }
      catch (error) {
        console.error('[camera] CPU worker unavailable; using main thread', error)
        if (!isCurrent()) throw error
      }
    }
    return PoseLandmarker.createFromOptions(vision, options)
  }

  const loaded = await detectorFallback(createDetector, isCurrent, preferred)
  if (loaded?.delegate === 'CPU') reportPerformance('cpu')
  return loaded
}
