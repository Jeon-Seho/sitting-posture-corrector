import { describe, expect, it } from 'vitest'
import { holdWhileSettling } from './cameraSample'
import { sampleAt, type Sample } from './engine'
import { RETURN_SETTLE_MS, ReturnSettle, TURN_SETTLE_MS } from './returnSettle'

const good: Sample = { ...sampleAt(0), state: 'good', collapse: 'tilt', prob: 0.2, confidence: 0.9, notice: null }
const unknown: Sample = { ...good, state: 'unknown', collapse: null, prob: 0, confidence: 0 }

describe('return settle (synthetic samples)', () => {
  it('judges from the start when nothing was unmeasurable', () => {
    expect(new ReturnSettle().judge(0, true)).toBe(true)
  })

  it('holds the judgement for 3 s after the last unmeasurable observation', () => {
    const settle = new ReturnSettle()
    expect(settle.judge(1000, false)).toBe(false)
    expect(settle.judge(1100, true)).toBe(false)
    expect(settle.judge(1000 + RETURN_SETTLE_MS - 1, true)).toBe(false)
    expect(settle.judge(1000 + RETURN_SETTLE_MS, true)).toBe(true)
  })

  it('holds only 1 s after a turned head, and never shortens a longer hold', () => {
    const settle = new ReturnSettle()
    expect(settle.judge(0, 'head_turn')).toBe(false)
    expect(settle.judge(TURN_SETTLE_MS - 1, 'measurable')).toBe(false)
    expect(settle.judge(TURN_SETTLE_MS, 'measurable')).toBe(true)
    const both = new ReturnSettle()
    both.judge(0, 'unmeasurable')
    both.judge(100, 'head_turn')
    expect(both.judge(2000, 'measurable')).toBe(false)
    expect(both.judge(RETURN_SETTLE_MS, 'measurable')).toBe(true)
  })

  it('keeps the live screen unknown, with no score, while the user settles', () => {
    const settle = new ReturnSettle()
    expect(holdWhileSettling(good, settle, 0)).toBe(good)
    expect(holdWhileSettling(unknown, settle, 100)).toBe(unknown)
    const held = holdWhileSettling(good, settle, 200)
    expect(held).toMatchObject({ state: 'unknown', prob: 0, confidence: 0, collapse: null })
    expect(held.notice).toContain('자세를 다시 잡는 중')
    expect(holdWhileSettling(good, settle, 100 + RETURN_SETTLE_MS)).toBe(good)
  })
})
