import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_RULES } from '../data/posture'
import {
  KEYS,
  loadLocalState,
  readLocal,
  summary,
  upsertRecord,
  validateProfile,
  validProfile,
  validRecord,
  validRules,
  writeLocal,
  type RecordItem,
} from './serviceStore'
const item: RecordItem = {
  id: 'one',
  startedAt: '2026-09-28T00:00:00Z',
  endedAt: '2026-09-28T01:00:00Z',
  mode: 'demo',
  valid: 100,
  good: 90,
  total: 100,
  events: [],
}
describe('service records', () => {
  it('retries replace the same session instead of duplicating it', () => {
    const records = upsertRecord([item], { ...item, good: 95 })
    expect(records).toHaveLength(1)
    expect(summary(records).rate).toBe(0.95)
  })
  it('weights maintenance by valid duration and leaves empty data unavailable', () => {
    expect(summary([]).rate).toBe(null)
    expect(summary([item, { ...item, id: 'two', valid: 900, good: 0 }]).rate).toBe(0.09)
  })
  it('local data deletion also clears the example-records switch', () => {
    expect(Object.values(KEYS)).toContain('posegood.v2.demo')
  })
  it('trims profile input and rejects missing fields or out-of-range age', () => {
    expect(validateProfile({ name: ' 합성 ', age: 30, occupation: ' 테스트 ' })).toEqual({
      name: '합성',
      age: 30,
      occupation: '테스트',
    })
    expect(validateProfile({ name: '  ', age: 30, occupation: '테스트' })).toBe(null)
    expect(validateProfile({ name: '합성', age: 0, occupation: '테스트' })).toBe(null)
    expect(validateProfile({ name: '합성', age: 121, occupation: '테스트' })).toBe(null)
  })
})

describe('local storage integrity (synthetic data only)', () => {
  let data: Map<string, string>
  beforeEach(() => {
    data = new Map()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => data.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => data.set(key, value)),
      removeItem: vi.fn((key: string) => data.delete(key)),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('accepts legacy complete records and starts new users without fabricated history', () => {
    expect(loadLocalState()).toMatchObject({ records: [], demo: false, issues: [] })
    writeLocal(KEYS.records, [item])
    expect(readLocal(KEYS.records, [])).toEqual([item])
  })
  it.each(['{broken', '{}', 'null', '[{"id":"broken"}]', ''])(
    'reports malformed records without changing the original bytes: %s',
    (raw) => {
      data.set(KEYS.records, raw)
      expect(loadLocalState().issues).toHaveLength(1)
      expect(() => writeLocal(KEYS.records, [item])).toThrow(/기존 자료/)
      expect(data.get(KEYS.records)).toBe(raw)
    },
  )
  it('rejects impossible durations, dates, duplicate IDs and malformed event fields', () => {
    for (const invalid of [
      { ...item, valid: -1 },
      { ...item, good: 101 },
      { ...item, total: NaN },
      { ...item, endedAt: 'invalid-date' },
      { ...item, events: [null] },
      { ...item, events: [{ id: 1 }] },
    ]) {
      expect(validRecord(invalid)).toBe(false)
    }
    expect(() => writeLocal(KEYS.records, [item, item])).toThrow()
  })
  it('rejects unsafe profiles and policy settings instead of coercing them', () => {
    expect(validProfile({ name: 'Synthetic', age: 23.5, occupation: 'Test' })).toBe(false)
    expect(validProfile({ name: ' ', age: 23, occupation: 'Test' })).toBe(false)
    for (const patch of [
      { threshold: -1 },
      { holdSeconds: 0 },
      { realertSeconds: Infinity },
      { recoverSeconds: null },
    ]) {
      expect(validRules({ ...DEFAULT_RULES, ...patch })).toBe(false)
    }
    data.set(KEYS.settings, JSON.stringify({ ...DEFAULT_RULES, threshold: -1 }))
    expect(loadLocalState().issues).toHaveLength(1)
  })
  it('retains existing records when storage is unavailable or full', () => {
    writeLocal(KEYS.records, [item])
    vi.mocked(localStorage.setItem).mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => writeLocal(KEYS.records, [{ ...item, id: 'two' }])).toThrow()
    expect(readLocal(KEYS.records, [])).toEqual([item])
    vi.mocked(localStorage.getItem).mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(loadLocalState().issues).toHaveLength(4) // profile, records, settings, demo (drafts are gone)
    expect(() => writeLocal(KEYS.records, [])).toThrow(/접근/)
  })
})
