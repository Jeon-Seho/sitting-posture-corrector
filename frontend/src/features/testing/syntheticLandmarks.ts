import type { Anchors } from '../../../../model/prototype/pose'

/** Explicitly synthetic mean baseline coordinates (normalized 0..1); not captured from anyone. */
export const SYNTHETIC_LANDMARKS: Anchors = {
  nose: { x: 0.5, y: 0.4 },
  left_eye: { x: 0.52, y: 0.37 },
  right_eye: { x: 0.48, y: 0.37 },
  left_ear: { x: 0.56, y: 0.38 },
  right_ear: { x: 0.44, y: 0.38 },
  mouth_left: { x: 0.515, y: 0.45 },
  mouth_right: { x: 0.485, y: 0.45 },
  left_shoulder: { x: 0.65, y: 0.62 },
  right_shoulder: { x: 0.35, y: 0.62 },
}
