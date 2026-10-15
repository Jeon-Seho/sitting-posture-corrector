import modelAsset from '../../../model-asset.json'
import modelVariants from '../../../model-variants.json'

/** Original Pose indices 0..12: face and both shoulders. */
export const SHOULDER_UP_LANDMARK_COUNT = 13

/** Extra models are opt-in /dev assets; the service default stays Heavy. */
export const POSE_MODELS = { ...modelVariants, heavy: modelAsset }

export const POSE_CONFIG = {
  wasmPath: '/mediapipe/wasm',
  modelAssetPath: `/mediapipe/${modelAsset.filename}`,
  modelId: modelAsset.modelId,
  minPoseDetectionConfidence: 0.6,
  minPosePresenceConfidence: 0.6,
  minTrackingConfidence: 0.6,
} as const

export const FRAME_EXPIRY_MS = 1_000
export const TRACKING_TICK_MS = 33
export const METRIC_INTERVAL_MS = 500
