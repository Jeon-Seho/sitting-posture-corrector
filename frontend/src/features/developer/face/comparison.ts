import type { LabGuidePoint } from '../types'

export interface FacePoint { index: number; x: number; y: number }
export interface FaceFrame {
  timeMs: number; videoTimeMs: number; width: number; height: number
  landmarkCount: number; points: FacePoint[]; edges: [number, number][]
  inferenceMs: number; delegate: 'GPU' | 'CPU'
}
export interface FaceDifference { meanPixels: number; verticalPixels: number }
const valid = (p: { x: number; y: number } | undefined) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
const center = (a: FacePoint | undefined, b: FacePoint | undefined) => valid(a) && valid(b) ? { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 } : null

/** Approximate anatomical matches; a detector difference is not a ground-truth error. */
export function compareFaceToPose(face: FaceFrame, pose: LabGuidePoint[], videoTimeMs: number, width: number, height: number): FaceDifference | null {
  if (face.width !== width || face.height !== height || Math.abs(face.videoTimeMs - videoTimeMs) > 1) return null
  const p = (index: number) => face.points.find(point => point.index === index)
  const eyes = [center(p(159), p(145)), center(p(386), p(374))]
  const mouths = [p(61), p(291)]
  const poseEyes = [pose[2], pose[5]], poseMouths = [pose[9], pose[10]]
  const byX = <T extends { x: number }>(points: T[]) => [...points].sort((a, b) => a.x - b.x)
  if ([...eyes, ...mouths, p(1)].some(point => !point || !valid(point)) || [pose[0], ...poseEyes, ...poseMouths].some(point => !valid(point) || point.visibility < .5)) return null
  const pairs = [[pose[0], p(1)!], ...byX(poseEyes).map((point, i) => [point, byX(eyes as { x: number; y: number }[])[i]]), ...byX(poseMouths).map((point, i) => [point, byX(mouths as FacePoint[])[i]])]
  return { meanPixels: pairs.reduce((sum, [a, b]) => sum + Math.hypot((a.x - b.x) * width, (a.y - b.y) * height), 0) / pairs.length,
    verticalPixels: pairs.reduce((sum, [a, b]) => sum + (a.y - b.y) * height, 0) / pairs.length }
}

export interface FaceTrial {
  id: number; glasses: boolean; elapsedMs: number; attempted: number; detected: number; paired: number
  meanDifferencePixels: number | null; meanVerticalPixels: number | null
  meanInferenceMs: number | null; meanRoundTripMs: number | null; delegate: string | null
}
export class FaceTrialAccumulator {
  attempted = 0; detected = 0; paired = 0
  private difference = 0; private vertical = 0; private inference = 0; private roundTrip = 0
  private delegate: string | null = null
  constructor(readonly id: number, readonly glasses: boolean, readonly startedAt: number) {}
  add(frame: FaceFrame | null, difference: FaceDifference | null, inferenceMs: number, roundTripMs: number, delegate: string) {
    this.attempted++; this.inference += inferenceMs; this.roundTrip += roundTripMs; this.delegate = delegate
    if (frame) this.detected++
    if (difference) { this.paired++; this.difference += difference.meanPixels; this.vertical += difference.verticalPixels }
  }
  finish(now: number): FaceTrial {
    return { id: this.id, glasses: this.glasses, elapsedMs: Math.max(0, now - this.startedAt), attempted: this.attempted, detected: this.detected, paired: this.paired,
      meanDifferencePixels: this.paired ? this.difference / this.paired : null, meanVerticalPixels: this.paired ? this.vertical / this.paired : null,
      meanInferenceMs: this.attempted ? this.inference / this.attempted : null, meanRoundTripMs: this.attempted ? this.roundTrip / this.attempted : null, delegate: this.delegate }
  }
}
