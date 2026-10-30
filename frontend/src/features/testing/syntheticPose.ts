import { readShoulders } from '../camera/shoulderCheck'
import type { Observation } from '../camera/types'
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
const FACE = [0, 2, 5, 7, 8, 9, 10]
/** How far the face drops toward the shoulders in a `deviation` frame (still inside the frame checks). */
const HEAD_DROP = .12

/**
 * - `normal`: the upright pose above.
 * - `deviation`: the same pose with the head dropped toward the shoulders; the server judges it.
 * - `poor`: both shoulders below the image, barely visible → sent as `{ p: null, valid: false }`.
 * - `absent`: nobody tracked → sent as `{ p: null }`.
 */
export type SyntheticKind = 'normal' | 'deviation' | 'poor' | 'absent'

/** All 33 points like the tracker; the joints not sent lie below the frame, barely visible. */
export const normalLandmarks = () => Array.from({ length: 33 }, (_, i) => {
  const joint = NORMAL_JOINTS[i]
  return joint ? { x: joint[0], y: joint[1], z: 0, visibility: .95 } : { x: .5, y: 1.2, z: 0, visibility: .05 }
})

export function syntheticLandmarks(kind: SyntheticKind) {
  if (kind === 'absent') return []
  return normalLandmarks().map((p, i) => {
    if (kind === 'deviation' && FACE.includes(i)) return { ...p, y: p.y + HEAD_DROP }
    if (kind === 'poor' && (i === 11 || i === 12)) return { ...p, y: 1.05, visibility: .1 }
    return p
  })
}

/**
 * One frame as the real camera loop makes it (`frameLoop`): `measurable` and `shoulders` come from
 * the same `readShoulders`, so LiveSession sends it exactly like a tracked frame.
 */
export function syntheticObservation(kind: SyntheticKind, timeMs: number): Observation & { measurable: boolean } {
  const landmarks = syntheticLandmarks(kind)
  const { measurable, shoulders } = readShoulders(landmarks, 640, 480)
  return {
    timeMs, videoTimeMs: timeMs, landmarks, worldLandmarks: [], measurable, shoulders,
    width: 640, height: 480, inferenceMs: 1, delegate: 'CPU',
  }
}
