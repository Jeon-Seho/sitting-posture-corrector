import { describe, expect, it } from 'vitest'
import { GuideDisplayFilter } from './displaySmoothing'
import type { LabGuideFrame } from './types'

const frame = (timeMs: number, x = .5): LabGuideFrame => ({ timeMs, width: 640, height: 480,
  points: Array.from({ length: 13 }, () => ({ x, y: .5, visibility: 1 })) })

describe('display-only filtering of synthetic guide points', () => {
  it('reduces stationary jitter without changing the raw observation', () => {
    const filter = new GuideDisplayFilter()
    filter.update(frame(0))
    let rawTravel = 0, displayTravel = 0, raw = .5, shown = .5
    for (let n = 1; n <= 60; n++) {
      const input = frame(n * 33, .5 + (n % 2 ? .003 : -.003))
      const copy = structuredClone(input), output = filter.update(input)!
      rawTravel += Math.abs(input.points[0].x - raw); raw = input.points[0].x
      displayTravel += Math.abs(output.points[0].x - shown); shown = output.points[0].x
      expect(input).toEqual(copy)
    }
    expect(displayTravel).toBeLessThan(rawTravel * .5)
  })
  it('follows deliberate motion and resets after loss, timestamp reversal and a new crop', () => {
    const filter = new GuideDisplayFilter()
    filter.update(frame(0))
    for (let n = 1; n <= 10; n++) filter.update(frame(n * 33, .5 + n * .02))
    expect(filter.update(frame(363, .72))!.points[0].x).toBeGreaterThan(.68)
    expect(filter.update(null)).toBeNull()
    expect(filter.update(frame(400, .3))).toEqual(frame(400, .3))
    expect(filter.update(frame(800, .7))).toEqual(frame(800, .7))
    expect(filter.update(frame(100, .2))).toEqual(frame(100, .2))
    const crop = { ...frame(133, .8), width: 1280 }
    expect(filter.update(crop)).toEqual(crop)
  })
  it('never keeps a low-visibility landmark visible or drags a newly found point', () => {
    const filter = new GuideDisplayFilter()
    filter.update(frame(0))
    const missing = frame(33, .9); missing.points[0].visibility = .1
    expect(filter.update(missing)!.points[0]).toEqual(missing.points[0])
    expect(filter.update(frame(66, .2))!.points[0].x).toBe(.2)
  })
})
