import { describe, expect, it } from 'vitest'
import { accountDraftStorage } from './draftStorage'
import { USER_A, USER_B, syntheticRecord } from './testFixtures'
import { DEFAULT_RULES } from '../../data/posture'
import { newMachine } from '../../lib/engine'
import type { Draft } from '../storage/types'
import { validPassword } from './password'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
  }
}
const draft = (id = 'synthetic-draft'): Draft => ({
  id,
  mode: 'demo',
  rules: DEFAULT_RULES,
  startedAt: '2026-10-01T00:00:00Z',
  machine: newMachine(),
})

describe('temporary account retry material', () => {
  it('never loads another account or the legacy local profile/draft', () => {
    const storage = memoryStorage()
    storage.setItem('posegood.v2.draft', JSON.stringify(draft('legacy')))
    const a = accountDraftStorage(USER_A, storage),
      b = accountDraftStorage(USER_B, storage)
    a.saveDraft(draft())
    a.rememberPending(syntheticRecord())
    expect(b.readDraft()).toBeNull()
    expect(b.readPending()).toBeNull()
    expect(a.readDraft()).toEqual(draft())
    expect(storage.getItem('posegood.v2.draft')).toContain('legacy')
  })
  it('preserves damaged retry material and refuses overwriting it', () => {
    const storage = memoryStorage(),
      scoped = accountDraftStorage(USER_A, storage)
    storage.setItem(scoped.keys.draft, '{synthetic-invalid')
    expect(() => scoped.readDraft()).toThrow()
    expect(() => scoped.saveDraft(draft())).toThrow()
    expect(storage.getItem(scoped.keys.draft)).toBe('{synthetic-invalid')
  })
  it('does not overwrite a different unfinished measurement or delete an unrelated retry', () => {
    const storage = memoryStorage(),
      scoped = accountDraftStorage(USER_A, storage)
    scoped.saveDraft(draft())
    expect(() => scoped.saveDraft(draft('different'))).toThrow()
    scoped.removeDraft('different')
    expect(scoped.readDraft()).toEqual(draft())
    scoped.removeDraft('synthetic-draft')
    expect(scoped.readDraft()).toBeNull()
  })
  it('deletes only the current account material on confirmed account deletion', () => {
    const storage = memoryStorage(),
      a = accountDraftStorage(USER_A, storage),
      b = accountDraftStorage(USER_B, storage)
    a.saveDraft(draft())
    b.saveDraft(draft('other'))
    a.clear()
    expect(a.readDraft()).toBeNull()
    expect(b.readDraft()?.id).toBe('other')
  })
  it('enforces the byte limit so multi-byte passwords are never silently truncated', () => {
    expect(validPassword('a'.repeat(72), true)).toBe(true)
    expect(validPassword('a'.repeat(73), true)).toBe(false)
    expect(validPassword('한'.repeat(24), true)).toBe(true)
    expect(validPassword('한'.repeat(25), true)).toBe(false)
    expect(validPassword('short', true)).toBe(false)
  })
})
