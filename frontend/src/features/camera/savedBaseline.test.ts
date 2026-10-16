import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  baselineFits,
  baselineFor,
  readSavedBaseline,
  readSavedBaselines,
  validSavedBaseline,
  writeSavedBaseline,
} from './savedBaseline'

const entry = {
  deviceId: 'synthetic-camera-a',
  calibrationId: '11111111-1111-4111-8111-111111111111',
  baseline: { headGap: 0.6, offset: 0, tilt: 0, quality: 0.9, turn: 0 },
  summary: null,
}

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  }
}

describe('saved posture on this computer', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('round-trips a registered posture', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    expect(readSavedBaseline()).toBeNull()
    writeSavedBaseline(entry)
    expect(readSavedBaseline()).toMatchObject({ schemaVersion: 1, ...entry })
  })

  it('ignores damaged or foreign values', () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    storage.setItem('posegood.v2.baseline', '{not json')
    expect(readSavedBaseline()).toBeNull()
    const saved = { schemaVersion: 1, savedAt: new Date().toISOString(), ...entry }
    expect(validSavedBaseline(saved)).toBe(true)
    expect(validSavedBaseline({ ...saved, baseline: { ...entry.baseline, tilt: Number.NaN } })).toBe(false)
    expect(validSavedBaseline({ ...saved, calibrationId: 'x' })).toBe(false)
    expect(validSavedBaseline({ ...saved, schemaVersion: 2 })).toBe(false)
  })

  it('works without storage', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(readSavedBaseline()).toBeNull()
    expect(() => writeSavedBaseline(entry)).not.toThrow()
  })

  it('applies only to the camera it was taken with', () => {
    expect(baselineFits(entry, 'synthetic-camera-a')).toBe(true)
    expect(baselineFits(entry, 'synthetic-camera-b')).toBe(false)
    expect(baselineFits(entry, '')).toBe(true)
    expect(baselineFits({ deviceId: '' }, 'synthetic-camera-b')).toBe(true)
  })

  it('keeps one posture per camera, newest first, replacing the earlier one of that camera (plan 0053)', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const b = { ...entry, deviceId: 'synthetic-camera-b', calibrationId: '22222222-2222-4222-8222-222222222222' }
    writeSavedBaseline(entry)
    writeSavedBaseline(b)
    expect(readSavedBaselines().map((s) => s.deviceId)).toEqual(['synthetic-camera-b', 'synthetic-camera-a'])
    const again = { ...entry, calibrationId: '33333333-3333-4333-8333-333333333333' }
    writeSavedBaseline(again)
    const list = readSavedBaselines()
    expect(list.map((s) => s.calibrationId)).toEqual([again.calibrationId, b.calibrationId])
    expect(baselineFor(list, 'synthetic-camera-b')?.calibrationId).toBe(b.calibrationId)
    expect(baselineFor(list, 'synthetic-camera-a')?.calibrationId).toBe(again.calibrationId)
    expect(baselineFor(list, 'synthetic-camera-c')).toBeNull()
    expect(baselineFor(list, '')?.calibrationId).toBe(again.calibrationId)
  })

  it('carries over the posture saved in the older single-camera form', () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    storage.setItem('posegood.v2.baseline', JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), ...entry }))
    expect(readSavedBaselines().map((s) => s.deviceId)).toEqual(['synthetic-camera-a'])
    writeSavedBaseline({ ...entry, deviceId: 'synthetic-camera-b' })
    expect(readSavedBaselines().map((s) => s.deviceId)).toEqual(['synthetic-camera-b', 'synthetic-camera-a'])
    expect(storage.getItem('posegood.v2.baseline')).toBeNull()
  })
})
