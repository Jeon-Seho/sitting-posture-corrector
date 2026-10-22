import { describe, expect, it } from 'vitest'
import type { Landmark } from '../../../../../model/prototype/pose'
import { FRAME_JOINTS, FrameBatcher, frameJoints } from './frames'

const body = (shift = 0): Landmark[] =>
  Array.from({ length: 33 }, (_, i) => ({ x: 0.1 + i * 0.01 + shift, y: 0.2 + i * 0.001, z: 0, visibility: 0.987 }))
const input = (timeMs: number, extra: Partial<{ judgeable: boolean; landmarks: Landmark[] }> = {}) => ({
  timeMs,
  landmarks: body(),
  judgeable: true,
  ...extra,
})

describe('posture.frames.v1 batching (synthetic landmarks)', () => {
  it('keeps the 9 agreed joints in order, rounded, and null for nobody', () => {
    const p = frameJoints(body())!
    expect(p).toHaveLength(9)
    expect(p[0]).toEqual([0.1, 0.2, 0.99])
    expect(p[7]).toEqual([Number((0.1 + 11 * 0.01).toFixed(5)), 0.211, 0.99])
    expect(FRAME_JOINTS).toEqual([0, 2, 5, 7, 8, 9, 10, 11, 12])
    expect(frameJoints([])).toBeNull()
  })

  it('keeps coordinates inside the range the server accepts (x·y -1..2, visibility 0..1)', () => {
    const points = body()
    points[0] = { x: -3.2, y: 2.7, z: 0, visibility: 1.4 }
    points[11] = { x: Number.NaN, y: 0.5, z: 0, visibility: 0.9 }
    points[12] = { x: 0.6, y: 0.5, z: 0 }
    const p = frameJoints(points)!
    expect(p[0]).toEqual([-1, 2, 1])
    expect(p[7]).toEqual([0, 0, 0])
    expect(p[8]).toEqual([0.6, 0.5, 0])
  })

  it('sends every frame of each 0.5 s interval without averaging, with increasing sequence', () => {
    const b = new FrameBatcher(1000)
    const sent = [1000, 1060, 1130, 1490, 1520, 1990, 2010].flatMap((t) => b.push(input(t)))
    expect(sent.map((m) => [m.sequence, m.start_ms, m.end_ms, m.frames.map((f) => f.t_ms)])).toEqual([
      [0, 0, 500, [0, 60, 130, 490]],
      [1, 500, 1000, [520, 990]],
    ])
    expect(sent[0]).toMatchObject({ schema_version: '3.0', feature_version: 'keypoints-9-v1', phase: 'running' })
    // 640x480 is fixed (DB V2.3 CAPTURE_RESOLUTION), so the camera size is not sent.
    expect(sent[0]).not.toHaveProperty('width')
    expect(sent[0]).not.toHaveProperty('height')
  })

  it('marks frames the app could not place as not valid but still sends the coordinates', () => {
    const b = new FrameBatcher(0)
    b.push(input(10, { judgeable: false }))
    b.push(input(20, { landmarks: [] }))
    const [batch] = b.finish(100)
    expect(batch.frames[0]).toMatchObject({ t_ms: 10, valid: false })
    expect(batch.frames[0].p).toHaveLength(9)
    expect(batch.frames[1]).toEqual({ t_ms: 20, p: null })
  })

  it('ends the interval at a pause and sends rest intervals without frames', () => {
    const b = new FrameBatcher(0)
    b.push(input(100))
    const paused = b.setPhase('rest', 300)
    expect(paused.map((m) => [m.start_ms, m.end_ms, m.phase, m.frames.length])).toEqual([[0, 300, 'running', 1]])
    const during = [...b.push(input(400)), ...b.tick(900)]
    expect(during.map((m) => [m.start_ms, m.end_ms, m.phase, m.frames.length])).toEqual([[300, 800, 'rest', 0]])
    const resumed = b.setPhase('running', 1000)
    expect(resumed.map((m) => [m.start_ms, m.end_ms, m.phase])).toEqual([[800, 1000, 'rest']])
    expect(b.finish(1200).map((m) => [m.sequence, m.phase])).toEqual([[3, 'running']])
  })
})

describe('posture.frames.v1 draft schema', () => {
  it('produces exactly the fields the contract draft requires', async () => {
    const { readFileSync } = await import('node:fs')
    const schema = JSON.parse(
      readFileSync(new URL('../../../../../contracts/realtime/frames/posture-frames.v1.schema.json', import.meta.url), 'utf8'),
    )
    const b = new FrameBatcher(0)
    b.push(input(10, { judgeable: false }))
    const [batch] = b.finish(100)
    expect(Object.keys(batch).sort()).toEqual([...schema.required].sort())
    expect(schema.properties.schema_version.const).toBe(batch.schema_version)
    expect(schema.properties.feature_version.const).toBe(batch.feature_version)
    expect(Object.keys(batch.frames[0]).sort()).toEqual(['p', 't_ms', 'valid'])
  })
})
