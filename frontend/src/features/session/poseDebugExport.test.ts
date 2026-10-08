import { describe, expect, it } from 'vitest'
import type { Features, Landmark } from '../../../../model/prototype/pose'
import { DEBUG_POINTS, PoseDebugRecorder } from './poseDebugExport'
import { RETURN_SETTLE_MS } from '../../lib/returnSettle'

const point = (i: number): Landmark => ({ x: i / 100, y: i / 50, z: -i / 10, visibility: 0.9 })
const pose = Array.from({ length: 33 }, (_, i) => point(i))
const baseline: Features = { headGap: 0.8, offset: 0, tilt: 0, quality: 0.9 }
const features = (change: Partial<Features> = {}): Features => ({ ...baseline, ...change })
const recorder = (origin = 0) => new PoseDebugRecorder(origin, baseline, 0.7)

function rows(text: string) {
  const [header, ...body] = text.trim().split('\n')
  const names = header.split(',')
  return body.map((line) => Object.fromEntries(line.split(',').map((v, i) => [names[i], v])))
}

describe('pose debug export (raw landmarks for analysis)', () => {
  it('writes the kept points relative to the session origin', () => {
    const r = recorder(1000)
    r.push({ timeMs: 1250, width: 640, height: 480, features: features(), landmarks: pose })
    const [row] = rows(r.toCsv())
    expect(row.time_ms).toBe('250')
    expect(row.features_ok).toBe('1')
    expect(Number(row.left_ear_x)).toBeCloseTo(0.07)
    expect(Number(row.right_shoulder_y)).toBeCloseTo(0.24)
    expect(Object.keys(row)).toHaveLength(7 + DEBUG_POINTS.length * 2)
    expect(row).not.toHaveProperty('nose_z')
    expect(row).not.toHaveProperty('nose_v')
    expect(row).not.toHaveProperty('left_shoulder_wx')
  })

  it('rounds coordinates to 5 decimals to keep the file small', () => {
    const r = recorder()
    const noisy = pose.map((p) => ({ ...p, x: 0.34482043981552124 }))
    r.push({ timeMs: 0, width: 640, height: 480, features: features(), landmarks: noisy })
    const [row] = rows(r.toCsv())
    expect(row.nose_x).toBe('0.34482')
  })

  it('leaves missing points blank instead of inventing them', () => {
    const r = recorder()
    r.push({ timeMs: 10, width: 640, height: 480, features: null, landmarks: [] })
    const [row] = rows(r.toCsv())
    expect(row.features_ok).toBe('0')
    expect([row.state, row.type, row.score]).toEqual(['unknown', '', ''])
    expect(row.nose_x).toBe('')
    expect(row.right_shoulder_y).toBe('')
  })

  it('labels each frame with the rule judgement against the session threshold', () => {
    const r = recorder()
    const push = (timeMs: number, f: Features) =>
      r.push({ timeMs, width: 640, height: 480, features: f, landmarks: pose })
    push(0, features())
    push(100, features({ headGap: 0.8 + 0.22 * 1.2 }))
    push(200, features({ tilt: 0.03 * 1.2 }))
    push(300, features({ headGap: 0.8 + 0.22 * 0.9 }))
    push(400, features({ offset: 0.2 * 0.5 }))
    push(500, features({ offset: -0.2 * 1.2 }))
    push(600, features({ tilt: -0.03 * 0.5 }))
    const out = rows(r.toCsv()).map((row) => [row.state, row.type, row.score])
    expect(out).toEqual([
      ['good', 'head', '0.00'],
      ['collapse', 'head', '0.84'],
      ['collapse', 'tilt_right', '0.84'],
      ['good', 'head', '0.63'],
      ['good', 'tilt_right', '0.35'],
      ['collapse', 'tilt_left', '0.84'],
      ['good', 'tilt_left', '0.35'],
    ])
  })

  it('truncates the score so a good frame never shows the threshold', () => {
    const r = recorder()
    const push = (timeMs: number, f: Features) =>
      r.push({ timeMs, width: 640, height: 480, features: f, landmarks: pose })
    push(0, features({ headGap: 0.8 + (0.22 * 0.6996) / 0.7 }))
    push(100, features({ headGap: 0.8 + (0.22 * 0.29) / 0.7 }))
    const out = rows(r.toCsv()).map((row) => [row.state, row.score])
    expect(out).toEqual([
      ['good', '0.69'],
      ['good', '0.29'],
    ])
  })

  it('holds the judgement for a while after the user comes back from unknown', () => {
    const r = recorder()
    const push = (timeMs: number, f: Features | null) =>
      r.push({ timeMs, width: 640, height: 480, features: f, landmarks: pose })
    push(0, features())
    push(100, null)
    push(200, features())
    push(100 + RETURN_SETTLE_MS - 1, features())
    push(100 + RETURN_SETTLE_MS, features())
    const out = rows(r.toCsv()).map((row) => [row.features_ok, row.state, row.score])
    expect(out).toEqual([
      ['1', 'good', '0.00'],
      ['0', 'unknown', ''],
      ['1', 'unknown', '0.00'],
      ['1', 'unknown', '0.00'],
      ['1', 'good', '0.00'],
    ])
  })

  it('writes the frame size on the first row only', () => {
    const r = recorder()
    r.push({ timeMs: 0, width: 640, height: 480, features: features(), landmarks: pose })
    r.push({ timeMs: 100, width: 640, height: 480, features: features(), landmarks: pose })
    const [first, second] = rows(r.toCsv())
    expect([first.width, first.height]).toEqual(['640', '480'])
    expect([second.width, second.height]).toEqual(['', ''])
  })

  it('ignores frames before the origin or with a broken clock', () => {
    const r = recorder(1000)
    r.push({ timeMs: 999, width: 1, height: 1, features: features(), landmarks: pose })
    r.push({ timeMs: Number.NaN, width: 1, height: 1, features: features(), landmarks: pose })
    expect(r.count).toBe(0)
  })
})
