import { describe, expect, it } from 'vitest'
import { claimWriter, type WriterState } from './writerLock'

describe('browser writer ownership', () => {
  it('keeps a second tab read-only and releases ownership when the first tab leaves', async () => {
    let held = false
    const manager = {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lock: object | null) => Promise<void>,
      ) => {
        if (held) return callback(null)
        held = true
        try {
          await callback({ name: 'synthetic-lock' })
        } finally {
          held = false
        }
      },
    } as unknown as Pick<LockManager, 'request'>
    const first: WriterState[] = [],
      second: WriterState[] = []
    const release = claimWriter(manager, (state) => first.push(state))
    claimWriter(manager, (state) => second.push(state))
    expect(first).toEqual(['ready'])
    expect(second).toEqual(['busy'])
    release()
    await Promise.resolve()
    await Promise.resolve()
    const releaseNext = claimWriter(manager, (state) => second.push(state))
    expect(second).toEqual(['busy', 'ready'])
    releaseNext()
  })
  it('fails closed when locks are unavailable or the browser rejects access', async () => {
    const states: WriterState[] = []
    claimWriter(undefined, (state) => states.push(state))
    claimWriter(
      { request: () => Promise.reject(new Error('Unavailable')) } as unknown as Pick<
        LockManager,
        'request'
      >,
      (state) => states.push(state),
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(states).toEqual(['unavailable', 'unavailable'])
  })
})
