import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import modelAsset from '../../../model-asset.json'
import { createCpuWorker, type PoseDetector } from './cpuWorker'
import type { CameraDelegate } from './types'
import { detectorFallback } from './detectorFallback'
import { probeAcceleration, reportPerformance } from './acceleration'
import { downloadModelFiles, type DownloadProgress } from './modelFiles'

type LoadedPoseDetector = { detector: PoseDetector; delegate: CameraDelegate }

/** The downloaded engine as a page-local address MediaPipe (and the CPU worker) can load; made once. */
const wasmUrls = new Map<string, string>()
function wasmUrl(path: string, bytes: Uint8Array) {
  let url = wasmUrls.get(path)
  if (!url) {
    url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/wasm' }))
    wasmUrls.set(path, url)
  }
  return url
}

/** A canceled connection never adopts a late model or starts a CPU retry. */
export async function loadPoseDetector(
  isCurrent: () => boolean,
  preferred: CameraDelegate = 'GPU',
  onDownload?: (progress: DownloadProgress) => void,
): Promise<LoadedPoseDetector | null> {
  if (!isCurrent()) return null
  if (preferred === 'GPU' && probeAcceleration() === 'limited') reportPerformance('limited')
  const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
  if (!isCurrent()) return null
  // Downloaded by us (modelFiles.ts) so a slow connection is waited for, not cut at a time limit.
  const modelUrl = `/mediapipe/${modelAsset.filename}`
  const [model, wasm] = await downloadModelFiles(vision.wasmBinaryPath ? [modelUrl, vision.wasmBinaryPath] : [modelUrl], onDownload)
  if (!isCurrent()) return null
  if (wasm) vision.wasmBinaryPath = wasmUrl(vision.wasmBinaryPath, wasm)

  const createDetector = async (delegate: CameraDelegate): Promise<PoseDetector> => {
    const options = {
      baseOptions: { modelAssetBuffer: model, delegate },
      runningMode: 'VIDEO' as const,
      numPoses: 1,
      minPoseDetectionConfidence: 0.6,
      minPosePresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    }
    if (delegate === 'CPU' && typeof Worker !== 'undefined' && typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined') {
      try { return await createCpuWorker(options, vision.wasmBinaryPath) }
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
