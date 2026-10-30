import { requireSyntheticMode } from './guard'
requireSyntheticMode()

/**
 * Upright seated pose for the 9 sent joints, in raw camera coordinates (the person's left is on
 * the image right). It passes the server's frame checks (BE `FrameFeatures`): nose and shoulders
 * visible 0.65 or more inside 0.02..0.98, shoulders 30 % of the width apart, ears even (no head
 * turn), shoulders above `FRAMING_BOTTOM`. Not a participant's pose and not judged by the app.
 */
const NORMAL_JOINTS: Record<number, [number, number]> = {
  0: [.5, .35], 2: [.53, .31], 5: [.47, .31], 7: [.57, .33], 8: [.43, .33],
  9: [.52, .4], 10: [.48, .4], 11: [.65, .6], 12: [.35, .6],
}
/** All 33 points like the tracker; the joints not sent lie below the frame, barely visible. */
export const normalLandmarks = () => Array.from({ length: 33 }, (_, i) => {
  const joint = NORMAL_JOINTS[i]
  return joint ? { x: joint[0], y: joint[1], z: 0, visibility: .95 } : { x: .5, y: 1.2, z: 0, visibility: .05 }
})
