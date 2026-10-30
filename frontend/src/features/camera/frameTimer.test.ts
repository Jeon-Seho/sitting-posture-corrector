import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFrameTimer } from './frameTimer'

class FakeWorker {
  static made: FakeWorker[] = []
  onmessage: (() => void) | null = null
  posted: number[] = []
  terminated = false
  constructor() { FakeWorker.made.push(this) }
  postMessage(delay: number) { this.posted.push(delay) }
  terminate() { this.terminated = true }
  /** The worker's own timer fired. */
  fire() { this.onmessage?.() }
}

describe('frame loop timer', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    FakeWorker.made = []
  })

  it('asks the worker for one tick per request and runs it', () => {
    vi.stubGlobal('Worker', FakeWorker)
    const timer = createFrameTimer()
    const worker = FakeWorker.made[0]
    const tick = vi.fn()
    timer.next(33, tick)
    expect(worker.posted).toEqual([33])
    worker.fire()
    expect(tick).toHaveBeenCalledTimes(1)
    // A late message with nothing requested does nothing.
    worker.fire()
    expect(tick).toHaveBeenCalledTimes(1)
  })

  it('stops the worker and drops a tick that was already on its way', () => {
    vi.stubGlobal('Worker', FakeWorker)
    const timer = createFrameTimer()
    const worker = FakeWorker.made[0]
    const tick = vi.fn()
    timer.next(33, tick)
    timer.stop()
    worker.fire()
    expect(worker.terminated).toBe(true)
    expect(tick).not.toHaveBeenCalled()
  })

  it('falls back to setTimeout without workers', () => {
    vi.stubGlobal('Worker', undefined)
    vi.useFakeTimers()
    const timer = createFrameTimer()
    const tick = vi.fn()
    timer.next(33, tick)
    vi.advanceTimersByTime(32)
    expect(tick).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(tick).toHaveBeenCalledTimes(1)
    timer.next(33, tick)
    timer.stop()
    vi.advanceTimersByTime(100)
    expect(tick).toHaveBeenCalledTimes(1)
  })
})
