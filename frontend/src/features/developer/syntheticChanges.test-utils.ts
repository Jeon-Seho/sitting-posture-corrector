import { comparisonDemo } from './comparisonDemo'

/**
 * Explicit synthetic geometry changes for tests only. They reproduce the coordinate edits of the
 * removed v3 demo tasks so metric checks stay independent of the current guided task list.
 */
export type SyntheticChange = 'head' | 'bow' | 'body' | 'shoulders'
export function changedFrame(timeMs: number, change: SyntheticChange) {
  const frame = comparisonDemo(timeMs, 'neutral'), { landmarks, worldLandmarks } = frame
  if (change === 'head') { for (let i = 0; i < 11; i++) { landmarks[i].y -= .01; worldLandmarks[i].z -= .08 } }
  if (change === 'bow') { for (let i = 0; i < 11; i++) landmarks[i].y += i >= 9 ? -.015 : .045; worldLandmarks[0].z -= .025 }
  if (change === 'body') { for (const p of landmarks) { p.x = .5 + (p.x - .5) * 1.2; p.y = .5 + (p.y - .5) * 1.2 } for (const p of worldLandmarks) p.z -= .1 }
  if (change === 'shoulders') { for (const i of [11, 12]) { landmarks[i].y -= .06; worldLandmarks[i].y -= .045 } }
  return frame
}
