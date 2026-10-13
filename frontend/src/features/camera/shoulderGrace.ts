import {
  features,
  SHOULDER_GRACE_MS,
  shouldersVisible,
  withShoulders,
  type Features,
  type Landmark,
} from '../../../../model/prototype/pose'
import type { ShoulderState } from './types'

export type LastShoulders = { left: Landmark; right: Landmark; time: number } | null

/**
 * One frame with the 2 s shoulder grace (2026-10-13): shoulders are the reference; when they
 * drop out, the head is judged against the last seen shoulders for at most 2 s, then the
 * frame is unmeasurable. Only a fully judgeable frame refreshes `last`.
 */
export function judgeWithGrace(
  points: Landmark[],
  width: number,
  height: number,
  timeMs: number,
  last: LastShoulders,
): { reading: Features | null; shoulders: ShoulderState | undefined; last: LastShoulders } {
  const reading = features(points, width, height)
  if (reading) return { reading, shoulders: 'seen', last: { left: points[11], right: points[12], time: timeMs } }
  if (!points.length) return { reading: null, shoulders: undefined, last }
  if (shouldersVisible(points)) return { reading: null, shoulders: 'seen', last }
  const inGrace = !!last && timeMs - last.time <= SHOULDER_GRACE_MS
  const head = inGrace ? features(withShoulders(points, last!), width, height) : null
  return { reading: head, shoulders: head ? 'grace' : 'missing', last }
}
