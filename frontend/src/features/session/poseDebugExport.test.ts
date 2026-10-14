import { describe, expect, it } from 'vitest'
import type { Landmark } from '../../../../model/prototype/pose'
import { DEBUG_POINTS, PoseDebugRecorder } from './poseDebugExport'

const point = (i: number): Landmark => ({ x: i / 100, y: i / 50, z: -i / 10, visibility: 0.9 })
const pose = Array.from({ length: 33 }, (_, i) => point(i))
const recorder = (origin = 0) => new PoseDebugRecorder(origin)

function rows(text: string) {
  const [header, ...body] = text.trim().split('\n')
  const names = header.split(',')
  return body.map((line) => Object.fromEntries(line.split(',').map((v, i) => [names[i], v])))
}

describe('pose debug export (raw landmarks for analysis)', () => {
  it('writes the kept points relative to the session origin', () => {
    const r = recorder(1000)
    r.push({ timeMs: 1250, width: 640, height: 480, landmarks: pose })
    const [row] = rows(r.toCsv())
    expect(row.time_ms).toBe('250')
    expect(Number(row.left_ear_x)).toBeCloseTo(0.07)
    expect(Number(row.right_shoulder_y)).toBeCloseTo(0.24)
    expect(Object.keys(row)).toHaveLength(3 + DEBUG_POINTS.length * 2)
    expect(row).not.toHaveProperty('nose_z')
    expect(row).not.toHaveProperty('nose_v')
    expect(row).not.toHaveProperty('left_shoulder_wx')
  })

  it('writes no judgement labels; the server and ML make them (ADR 0021)', () => {
    const r = recorder()
    r.push({ timeMs: 0, width: 640, height: 480, landmarks: pose })
    const header = r.toCsv().split('\n')[0].split(',')
    for (const label of ['features_ok', 'state', 'type', 'score']) expect(header).not.toContain(label)
  })

  it('rounds coordinates to 5 decimals to keep the file small', () => {
    const r = recorder()
    const noisy = pose.map((p) => ({ ...p, x: 0.34482043981552124 }))
    r.push({ timeMs: 0, width: 640, height: 480, landmarks: noisy })
    const [row] = rows(r.toCsv())
    expect(row.nose_x).toBe('0.34482')
  })

  it('leaves missing points blank instead of inventing them', () => {
    const r = recorder()
    r.push({ timeMs: 10, width: 640, height: 480, landmarks: [] })
    const [row] = rows(r.toCsv())
    expect(row.nose_x).toBe('')
    expect(row.right_shoulder_y).toBe('')
  })

  it('writes the frame size on the first row only', () => {
    const r = recorder()
    r.push({ timeMs: 0, width: 640, height: 480, landmarks: pose })
    r.push({ timeMs: 100, width: 640, height: 480, landmarks: pose })
    const [first, second] = rows(r.toCsv())
    expect([first.width, first.height]).toEqual(['640', '480'])
    expect([second.width, second.height]).toEqual(['', ''])
  })

  it('ignores frames before the origin or with a broken clock', () => {
    const r = recorder(1000)
    r.push({ timeMs: 999, width: 1, height: 1, landmarks: pose })
    r.push({ timeMs: Number.NaN, width: 1, height: 1, landmarks: pose })
    expect(r.count).toBe(0)
  })
})
