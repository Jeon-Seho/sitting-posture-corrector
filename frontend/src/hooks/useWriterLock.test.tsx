import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { useWriterLock } from './useWriterLock'

describe('asynchronous writer request cancellation', () => {
  let renderer: ReactTestRenderer | undefined
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = undefined
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  it('waits for a canceled pending request to release before retrying', async () => {
    vi.useFakeTimers()
    let held = false
    const request = vi.fn(
      async (
        _name: string,
        _options: unknown,
        callback: (lock: object | null) => Promise<void>,
      ) => {
        const acquired = !held
        if (acquired) held = true
        await new Promise<void>((resolve) => setTimeout(resolve, 1))
        try {
          await callback(acquired ? { name: 'synthetic-lock' } : null)
        } finally {
          if (acquired) held = false
        }
      },
    )
    vi.stubGlobal('navigator', { locks: { request } })
    let latest!: ReturnType<typeof useWriterLock>
    const states: string[] = []
    function Probe() {
      latest = useWriterLock()
      states.push(latest.state)
      return null
    }
    await act(async () => {
      renderer = create(<Probe />)
    })
    expect(request).toHaveBeenCalledTimes(1)
    act(() => latest.retry())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(latest.state).toBe('ready')
    expect(states).not.toContain('busy')
    expect(request).toHaveBeenCalledTimes(2)
  })
})
