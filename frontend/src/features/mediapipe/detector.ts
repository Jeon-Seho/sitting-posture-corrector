import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import { POSE_CONFIG } from './config'
import { shoulderUpLandmarks } from './landmarks'
import type { PoseDelegate, PoseTracker } from './types'

/** A canceled connection never adopts a late model or starts a CPU retry. */
export async function createPoseTracker(isCurrent: () => boolean): Promise<PoseTracker | null> {
  const vision = await FilesetResolver.forVisionTasks(POSE_CONFIG.wasmPath)
  if (!isCurrent()) return null

  const createDetector = (delegate: PoseDelegate) =>
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: POSE_CONFIG.modelAssetPath, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: POSE_CONFIG.minPoseDetectionConfidence,
      minPosePresenceConfidence: POSE_CONFIG.minPosePresenceConfidence,
      minTrackingConfidence: POSE_CONFIG.minTrackingConfidence,
    })

  let delegate: PoseDelegate = 'GPU'
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
  return {
    delegate,
    detectFrame(video, timeMs) {
      const videoTimeMs = video.currentTime * 1_000
      const started = performance.now()
      const result = detector.detectForVideo(video, timeMs)
      const inferenceMs = performance.now() - started
      return {
        ...shoulderUpLandmarks(result),
        timeMs,
        videoTimeMs,
        inferenceMs,
        delegate,
        width: video.videoWidth,
        height: video.videoHeight,
      }
    },
    close: () => detector.close(),
  }
}
