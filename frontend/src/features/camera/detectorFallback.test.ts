import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectorFallback } from './detectorFallback'
afterEach(() => vi.useRealTimers())
describe('detector deadlines and late cleanup', () => {
  it('times out and closes a model that arrives later without retrying CPU', async () => {
    vi.useFakeTimers()
    let resolve!: (value: { close: () => void }) => void
    const close = vi.fn()
    const factory = vi.fn(() => new Promise<{ close: () => void }>(done => { resolve = done }))
    const result = detectorFallback(factory, () => true, 'GPU', 100)
    const assertion = expect(result).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(101)
    await assertion
    resolve({ close })
    await Promise.resolve()
    expect(close).toHaveBeenCalledOnce()
    expect(factory).toHaveBeenCalledOnce()
  })
  it('closes a canceled CPU result after GPU failure', async () => {
    let current = true
    const close = vi.fn()
    const result = await detectorFallback(async delegate => {
      if (delegate === 'GPU') throw new Error('Synthetic GPU failure')
      current = false
      return { close }
    }, () => current)
    expect(result).toBeNull()
    expect(close).toHaveBeenCalledOnce()
  })
})
