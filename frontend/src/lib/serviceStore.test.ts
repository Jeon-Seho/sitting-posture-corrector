import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeOpenEvent, newMachine, sampleAt, step } from './engine'
import { DEFAULT_RULES } from '../data/posture'
import {
  KEYS,
  loadLocalState,
  readLocal,
  recordFromDraft,
  removeSavedDraft,
  resumeMachine,
  saveDraft,
  summary,
  upsertRecord,
  validateProfile,
  validDraft,
  validMachine,
  validProfile,
  validRecord,
  validRules,
  writeLocal,
  type Draft,
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
  it('restores accumulated data without carrying an active confirmation timer', () => {
    const machine = newMachine()
    machine.total = 50
    machine.good = 40
    machine.hold = 2
    machine.onsetAt = 48
    const restored = resumeMachine(machine)
    expect(restored.total).toBe(50)
    expect(restored.good).toBe(40)
    expect(restored.hold).toBe(0)
    expect(restored.onsetAt).toBe(null)
    expect(machine.hold).toBe(2)
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
  it('closes an interrupted draft as a record without counting paused or unknown time as valid', () => {
    const machine = newMachine()
    Object.assign(machine, { total: 200, paused: 10, unknown: 20, good: 150, collapse: 20 })
    const active = {
      id: 1,
      type: 'tilt' as const,
      startAt: 180,
      confirmedAt: 183,
      endAt: null,
      durationSec: 0,
      alerts: 1,
      firstAlertAt: 183,
      recovered: false,
      recoverySec: null,
      endedBySession: false,
      endReason: null,
      blockId: 0,
    }
    machine.active = active
    machine.events = [active]
    const record = recordFromDraft(
      {
        id: 'draft',
        startedAt: '2026-09-28T00:00:00Z',
        mode: 'camera',
        rules: DEFAULT_RULES,
        machine,
      },
      '2026-09-28T00:04:00Z',
    )
    expect(record).toMatchObject({ id: 'draft', mode: 'camera', total: 200, valid: 170, good: 150 })
    expect(record.events[0]).toMatchObject({ endAt: 200, endReason: 'paused' })
    expect(machine.events[0].endAt).toBe(null)
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
  const draft = (): Draft => ({
    id: 'synthetic-draft',
    startedAt: '2026-09-30T00:00:00Z',
    mode: 'demo',
    rules: DEFAULT_RULES,
    machine: newMachine(),
  })

  it('accepts legacy complete records and drafts and starts new users without fabricated history', () => {
    expect(loadLocalState()).toMatchObject({ records: [], draft: null, demo: false, issues: [] })
    writeLocal(KEYS.records, [item])
    writeLocal(KEYS.draft, draft())
    expect(readLocal(KEYS.records, [])).toEqual([item])
    expect(loadLocalState().draft).toEqual(draft())
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
  it('validates full machine state, including open events and cumulative counters', () => {
    const m = newMachine()
    step(m, 4, 'running', DEFAULT_RULES, {
      ...sampleAt(0),
      prob: 0.9,
      state: 'collapse',
      collapse: 'tilt',
    })
    expect(validMachine(m)).toBe(true)
    expect(
      validMachine({ ...m, active: Object.fromEntries(Object.entries(m.active!).reverse()) }),
    ).toBe(true)
    expect(validMachine({ ...m, nextId: 1 })).toBe(false)
    expect(validMachine({ ...m, alertTick: 0 })).toBe(false)
    expect(validMachine({ ...m, unknown: 10 })).toBe(false)
    const restored = resumeMachine(m)
    expect(validMachine(restored)).toBe(true)
    expect(restored.events[0]).toMatchObject({ endReason: 'paused', endAt: 4, recovered: false })
    expect(m.events[0].endAt).toBeNull()
    closeOpenEvent(m)
    expect(validRecord({ ...item, total: 4, valid: 4, good: 0, events: m.events })).toBe(true)
    expect(validDraft({ ...draft(), machine: { total: 4, good: 4 } })).toBe(false)
  })
  it('preserves a draft from another session and only removes the saved session draft', () => {
    saveDraft(draft())
    expect(() => saveDraft({ ...draft(), id: 'another' })).toThrow(/다른 중간 기록/)
    removeSavedDraft('another')
    expect(loadLocalState().draft?.id).toBe(draft().id)
    removeSavedDraft(draft().id)
    expect(loadLocalState().draft).toBeNull()
  })
  it('does not offer recovery for a session whose final result is already saved', () => {
    saveDraft({ ...draft(), id: item.id })
    writeLocal(KEYS.records, [item])
    expect(loadLocalState().draft).toBeNull()
    expect(data.has(KEYS.draft)).toBe(true)
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
    expect(loadLocalState().issues).toHaveLength(5)
    expect(() => writeLocal(KEYS.records, [])).toThrow(/접근/)
  })
})
