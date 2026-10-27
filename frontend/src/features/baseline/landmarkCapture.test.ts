import { describe, expect, it } from 'vitest'
import type { Landmark } from '../../../../model/prototype/pose'
import { beginCapture, observeCapture, type LandmarkCapture } from './landmarkCapture'

const pose = (noseY: number): Landmark[] =>
  Array.from({ length: 33 }, (_, i) => ({ x: i === 11 ? 0.3 : i === 12 ? 0.7 : 0.5, y: i === 0 ? noseY : 0.5, z: 0 }))

/** Feeds frames every `stepMs` from t = 0 and returns the last step. */
function run(frames: (Landmark[] | null)[], stepMs: number, capture: LandmarkCapture = beginCapture()) {
  let step = observeCapture(capture, frames[0], 0, 0)
  for (let i = 1; i < frames.length; i++) step = observeCapture(step.capture, frames[i], i * stepMs, stepMs)
  return step
}

describe('posture capture: mean of 9 joints for B1 (2026-10-20 team meeting)', () => {
  it('averages every usable frame equally and rounds to 5 digits', () => {
    // 31 frames over 3 s: nose y alternates 0.2 / 0.3 → mean 0.2 + 0.1·15/31.
    const frames = Array.from({ length: 31 }, (_, i) => pose(i % 2 ? 0.3 : 0.2))
    const step = run(frames, 100)
    expect(step.ready).not.toBeNull()
    expect(step.ready!.sampleCount).toBe(31)
    expect(step.ready!.calibrationMs).toBe(3000)
    expect(step.ready!.landmarks.nose).toEqual({ x: 0.5, y: Math.round((0.2 + (0.1 * 15) / 31) * 1e5) / 1e5 })
    expect(step.ready!.landmarks.left_shoulder).toEqual({ x: 0.3, y: 0.5 })
    expect(Object.keys(step.ready!.landmarks)).toHaveLength(9)
  })

  it('restarts on an unusable frame or a long gap', () => {
    const broken = run([...Array.from({ length: 20 }, () => pose(0.25)), null], 100)
    expect(broken.capture.count).toBe(0)
    expect(broken.progress).toBe(0)
    const gap = observeCapture(run([pose(0.25), pose(0.25)], 100).capture, pose(0.25), 1300, 1200)
    expect(gap.capture.count).toBe(0)
  })

  it('keeps capturing past 3 s at a low tracking rate until 20 samples (B1 minimum)', () => {
    // 5 fps: 16 frames by 3 s, not enough.
    const short = run(Array.from({ length: 16 }, () => pose(0.25)), 200)
    expect(short.progress).toBe(1)
    expect(short.ready).toBeNull()
    const enough = run(Array.from({ length: 20 }, () => pose(0.25)), 200)
    expect(enough.ready!.sampleCount).toBe(20)
    expect(enough.ready!.calibrationMs).toBe(3800)
  })

  it('reports a mean outside the frame instead of a posture', () => {
    const frames = Array.from({ length: 31 }, () => pose(0.25).map((p, i) => (i === 7 ? { ...p, x: -0.1 } : p)))
    const step = run(frames, 100)
    expect(step.ready).toBeNull()
    expect(step.outOfFrame).toBe(true)
  })
})
