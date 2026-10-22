import { features, shouldersVisible, type Features, type Landmark } from '../../../../model/prototype/pose'
import type { ShoulderState } from './types'

/**
 * Whether this frame shows both shoulders (2026-10-22). The app does not judge: with a shoulder
 * missing the frame is `missing` at once and goes to the server as `valid:false`, and the
 * server decides what a missing joint means. The 2 s head-only grace (2026-10-13) was removed.
 */
export function readShoulders(
  points: Landmark[],
  width: number,
  height: number,
): { reading: Features | null; shoulders: ShoulderState | undefined } {
  const reading = features(points, width, height)
  if (reading) return { reading, shoulders: 'seen' }
  if (!points.length) return { reading: null, shoulders: undefined }
  return { reading: null, shoulders: shouldersVisible(points) ? 'seen' : 'missing' }
}
