import { describe, expect, it } from 'vitest'
import { RECORDING_RATE, RecordingRate, RecordingSlots } from './recordingRate'

/** Kept frames per second and smallest kept gap for an explicit synthetic tracker stream of `fps` with a jitter pattern. */
function kept(fps: number, jitterMs: number[] = [0]) {
  const slots = new RecordingSlots(), rate = new RecordingRate(), times: number[] = []
  for (let i = 0; i < fps * 5; i++) {
    const t = i * 1000 / fps + jitterMs[i % jitterMs.length]
    if (slots.keep(times.at(-1) ?? null, t)) { times.push(t); rate.add(t) }
  }
  return { hz: rate.hz()!, minGap: Math.min(...times.slice(1).map((t, i) => t - times[i])) }
}

describe('7–10 Hz recording rate on /dev', () => {
  it('keeps about 10 Hz from any tracker faster than 10 fps, even with timing jitter', () => {
    for (const fps of [13.3, 15, 20, 30, 60]) {
      const { hz, minGap } = kept(fps, [0, 4, -4, 2])
      expect(hz).toBeGreaterThanOrEqual(9.5); expect(hz).toBeLessThanOrEqual(RECORDING_RATE.maximumHz + .5)
      expect(minGap).toBeGreaterThanOrEqual(RECORDING_RATE.slotMs / 2 - 8)
    }
  })
  it('keeps every frame of a slower tracker and reports a stream below 7 Hz', () => {
    expect(kept(8).hz).toBeCloseTo(8, 1)
    expect(kept(6).hz).toBeLessThan(RECORDING_RATE.minimumHz)
  })
  it('starts a fresh schedule after a tracking gap instead of bursting to catch up', () => {
    const slots = new RecordingSlots(), times: number[] = []
    for (const t of [0, 75, 150, 2000, 2075, 2150, 2225, 2300]) if (slots.keep(times.at(-1) ?? null, t)) times.push(t)
    expect(times).toEqual([0, 150, 2000, 2075, 2150, 2300])
    slots.reset(); expect(slots.keep(null, 2310)).toBe(true)
  })
  it('lets a frame with a non-increasing time through to the engine, which reports it as interrupted', () => {
    const slots = new RecordingSlots()
    expect(slots.keep(null, 1000)).toBe(true)
    expect(slots.keep(1000, 1050)).toBe(false)
    expect(slots.keep(1000, 900)).toBe(true)
  })
  it('waits for two seconds of frames and forgets frames older than the window', () => {
    const rate = new RecordingRate()
    for (let t = 0; t <= 1900; t += 100) rate.add(t)
    expect(rate.hz()).toBeNull()
    rate.add(2000); expect(rate.hz()).toBeCloseTo(10, 5)
    for (let t = 2200; t <= 6000; t += 200) rate.add(t)
    expect(rate.hz()).toBeCloseTo(5, 5)
    rate.add(5000); rate.add(Number.NaN); expect(rate.hz()).toBeCloseTo(5, 5)
    rate.reset(); expect(rate.hz()).toBeNull()
  })
})
