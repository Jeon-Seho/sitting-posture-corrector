import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import modelAsset from '../../../model-asset.json'
import type { CameraDelegate } from './types'

type LoadedPoseDetector = { detector: PoseLandmarker; delegate: CameraDelegate }

/** A canceled connection never adopts a late model or starts a CPU retry. */
export async function loadPoseDetector(
  isCurrent: () => boolean,
): Promise<LoadedPoseDetector | null> {
  const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
  if (!isCurrent()) return null

  const createDetector = (delegate: CameraDelegate) =>
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: `/mediapipe/${modelAsset.filename}`, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.6,
      minPosePresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    })

  let delegate: CameraDelegate = 'GPU'
  let detector: PoseLandmarker
  try {
    detector = await createDetector(delegate)
  } catch {
    if (!isCurrent()) return null
    delegate = 'CPU'
    detector = await createDetector(delegate)
  }

  if (!isCurrent()) {
    detector.close()
    return null
  }
  return { detector, delegate }
}
