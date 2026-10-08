import { describe, expect, it } from 'vitest'
import type { Landmark } from '../../../../model/prototype/pose'
import { DEBUG_POINTS, PoseDebugRecorder } from './poseDebugExport'

const point = (i: number): Landmark => ({ x: i / 100, y: i / 50, z: -i / 10, visibility: 0.9 })
const pose = Array.from({ length: 33 }, (_, i) => point(i))

function rows(text: string) {
  const [header, ...body] = text.trim().split('\n')
  const names = header.split(',')
  return body.map((line) => Object.fromEntries(line.split(',').map((v, i) => [names[i], v])))
}

describe('pose debug export (raw landmarks for analysis)', () => {
  it('writes the kept points relative to the session origin', () => {
    const r = new PoseDebugRecorder(1000)
    r.push({ timeMs: 1250, width: 640, height: 480, featuresOk: true, landmarks: pose })
    const [row] = rows(r.toCsv())
    expect(row.time_ms).toBe('250')
    expect(row.features_ok).toBe('1')
    expect(Number(row.left_ear_x)).toBeCloseTo(0.07)
    expect(Number(row.right_shoulder_y)).toBeCloseTo(0.24)
    expect(Object.keys(row)).toHaveLength(4 + DEBUG_POINTS.length * 2)
    expect(row).not.toHaveProperty('nose_z')
    expect(row).not.toHaveProperty('nose_v')
    expect(row).not.toHaveProperty('left_shoulder_wx')
  })

  it('rounds coordinates to 5 decimals to keep the file small', () => {
    const r = new PoseDebugRecorder(0)
    const noisy = pose.map((p) => ({ ...p, x: 0.34482043981552124 }))
    r.push({ timeMs: 0, width: 640, height: 480, featuresOk: true, landmarks: noisy })
    const [row] = rows(r.toCsv())
    expect(row.nose_x).toBe('0.34482')
  })

  it('leaves missing points blank instead of inventing them', () => {
    const r = new PoseDebugRecorder(0)
    r.push({ timeMs: 10, width: 640, height: 480, featuresOk: false, landmarks: [] })
    const [row] = rows(r.toCsv())
    expect(row.features_ok).toBe('0')
    expect(row.nose_x).toBe('')
    expect(row.right_shoulder_y).toBe('')
  })

  it('ignores frames before the origin or with a broken clock', () => {
    const r = new PoseDebugRecorder(1000)
    r.push({ timeMs: 999, width: 1, height: 1, featuresOk: true, landmarks: pose })
    r.push({ timeMs: Number.NaN, width: 1, height: 1, featuresOk: true, landmarks: pose })
    expect(r.count).toBe(0)
  })
})
