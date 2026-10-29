import { measurable, shouldersVisible, type Landmark } from '../../../../model/prototype/pose'
import type { ShoulderState } from './types'

/**
 * Whether this frame can be measured and shows both shoulders (2026-10-22). The app does not
 * judge: with a shoulder missing the frame is `missing` at once and goes to the server as
 * `valid:false`, and the server decides what a missing joint means. The 2 s head-only grace
 * (2026-10-13) was removed.
 */
export function readShoulders(
  points: Landmark[],
  width: number,
  height: number,
): { measurable: boolean; shoulders: ShoulderState | undefined } {
  if (measurable(points, width, height)) return { measurable: true, shoulders: 'seen' }
  if (!points.length) return { measurable: false, shoulders: undefined }
  return { measurable: false, shoulders: shouldersVisible(points) ? 'seen' : 'missing' }
}
