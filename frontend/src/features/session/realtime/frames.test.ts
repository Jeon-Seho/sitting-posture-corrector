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

describe('features messages (flattened contract draft, synthetic landmarks)', () => {
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

  it('sends a frame with a missing joint as unmeasurable without coordinates, and a complete one as running', () => {
    const batcher = new FrameBatcher(0)
    const broken = body()
    delete (broken as Partial<Landmark>[])[7]
    batcher.push(input(100, { landmarks: broken }))
    const [first] = batcher.push(input(200))
    const [second] = batcher.finish(500)
    expect(first).toEqual({ sequence: 0, start_ms: 0, end_ms: 200, phase: 'unmeasurable', t_ms: 100, p: null })
    expect(second).toMatchObject({ phase: 'running', t_ms: 200 })
    expect(second.p).toHaveLength(9)
  })

  it('sends each frame on its own, flat, ending its interval when the next frame arrives', () => {
    const b = new FrameBatcher(1000)
    const sent = [1000, 1060, 1130, 1490, 1520, 1990, 2010].flatMap((t) => b.push(input(t)))
    expect(sent.map((m) => [m.sequence, m.start_ms, m.end_ms, m.phase, m.t_ms])).toEqual([
      [0, 0, 60, 'running', 0],
      [1, 60, 130, 'running', 60],
      [2, 130, 490, 'running', 130],
      [3, 490, 520, 'running', 490],
      [4, 520, 990, 'running', 520],
      [5, 990, 1010, 'running', 990],
    ])
    // The flattened contract: no items/frames, no contract or feature version, no valid mark.
    expect(Object.keys(sent[0]).sort()).toEqual(['end_ms', 'p', 'phase', 'sequence', 'start_ms', 't_ms'])
  })

  it('sends frames the app could not place as unmeasurable with their time and p null', () => {
    const b = new FrameBatcher(0)
    b.push(input(10, { judgeable: false }))
    const [first] = b.push(input(20, { landmarks: [] }))
    const [second] = b.finish(100)
    expect(first).toMatchObject({ phase: 'unmeasurable', t_ms: 10, p: null })
    expect(second).toMatchObject({ phase: 'unmeasurable', t_ms: 20, p: null })
  })

  it('closes an interval after 0.5 s without a new frame as unmeasurable without t_ms', () => {
    const b = new FrameBatcher(0)
    b.push(input(100))
    expect(b.tick(700)).toMatchObject([{ start_ms: 0, end_ms: 500, phase: 'running', t_ms: 100 }])
    const [empty] = b.tick(1100)
    expect(empty).toEqual({ sequence: 1, start_ms: 500, end_ms: 1000, phase: 'unmeasurable', p: null })
    b.push(input(1200))
    expect(b.push(input(1300))).toMatchObject([{ start_ms: 1000, end_ms: 1300, phase: 'running', t_ms: 1200 }])
  })

  it('keeps one frame per interval: a second frame at the same time replaces the first', () => {
    const b = new FrameBatcher(0)
    b.push(input(100))
    const [first] = b.push(input(200))
    expect(first.t_ms).toBe(100)
    b.push(input(200, { landmarks: body(0.05) }))
    const [second] = b.finish(300)
    expect(second).toMatchObject({ start_ms: 200, end_ms: 300, t_ms: 200 })
    expect(second.p![0][0]).toBe(0.15)
  })

  it('drops a frame older than the open interval (closed on time while tracking lagged)', () => {
    const b = new FrameBatcher(0)
    b.push(input(100))
    b.tick(700) // [0, 500) sent; the open interval starts at 500
    expect(b.push(input(450))).toEqual([])
    const [closed] = b.finish(800)
    expect(closed).toEqual({ sequence: 1, start_ms: 500, end_ms: 800, phase: 'unmeasurable', p: null })
  })

  it('ends the interval at a pause and sends rest intervals without t_ms or p', () => {
    const b = new FrameBatcher(0)
    b.push(input(100))
    const paused = b.setPhase('rest', 300)
    expect(paused).toMatchObject([{ start_ms: 0, end_ms: 300, phase: 'running', t_ms: 100 }])
    const during = [...b.push(input(400)), ...b.tick(900)]
    expect(during).toEqual([{ sequence: 1, start_ms: 300, end_ms: 800, phase: 'rest' }])
    const resumed = b.setPhase('running', 1000)
    expect(resumed).toEqual([{ sequence: 2, start_ms: 800, end_ms: 1000, phase: 'rest' }])
    expect(b.finish(1200).map((m) => [m.sequence, m.phase])).toEqual([[3, 'unmeasurable']])
  })

  it('sends away intervals without t_ms or p', () => {
    const b = new FrameBatcher(0)
    b.setPhase('away', 0)
    expect(b.tick(600)).toEqual([{ sequence: 0, start_ms: 0, end_ms: 500, phase: 'away' }])
  })
})
