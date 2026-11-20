import { describe, expect, it, vi } from 'vitest'
import { moveRenamedKeys, RENAMED_KEYS } from './renamedKeys'
import { KEYS } from './types'

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  }
}

describe('renamed browser keys', () => {
  it('no current key carries a version', () => {
    for (const key of [...Object.values(KEYS), ...RENAMED_KEYS.map(([, current]) => current)]) expect(key).not.toMatch(/\.v\d+\./)
    for (const key of Object.values(KEYS)) expect(RENAMED_KEYS.map(([, current]) => current)).toContain(key)
  })

  it('moves an old value to the new key and removes the old key', () => {
    const store = memoryStore({ 'posegood.v2.mainCamera': 'usb-cam', 'posegood.v2.trackingFps': '15' })
    moveRenamedKeys(store)
    expect(Object.fromEntries(store.data)).toEqual({ 'posegood.mainCamera': 'usb-cam', 'posegood.trackingFps': '15' })
  })

  it('keeps a value already saved under the new key', () => {
    const store = memoryStore({ 'posegood.v2.settings': 'old', 'posegood.settings': 'new' })
    moveRenamedKeys(store)
    expect(Object.fromEntries(store.data)).toEqual({ 'posegood.settings': 'new' })
  })

  it('keeps the old key when the copy fails, and goes on with the others', () => {
    const store = memoryStore({ 'posegood.v2.profile': 'p', 'posegood.v2.demo': 'true' })
    const setItem = store.setItem
    store.setItem = (key, value) => {
      if (key === 'posegood.profile') throw new DOMException('full', 'QuotaExceededError')
      setItem(key, value)
    }
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    moveRenamedKeys(store)
    expect(Object.fromEntries(store.data)).toEqual({ 'posegood.v2.profile': 'p', 'posegood.demo': 'true' })
    log.mockRestore()
  })

  it('does nothing without storage', () => {
    expect(() => moveRenamedKeys(undefined)).not.toThrow()
  })
})
