import { afterEach, describe, expect, it, vi } from 'vitest'
import { readSavedBaseline, validSavedBaseline, writeSavedBaseline } from './savedBaseline'

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

  it('keeps one posture whatever camera took it, replacing it on a new registration (plan 0053)', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    writeSavedBaseline(entry)
    const b = { ...entry, deviceId: 'synthetic-camera-b', calibrationId: '22222222-2222-4222-8222-222222222222' }
    writeSavedBaseline(b)
    expect(readSavedBaseline()).toMatchObject({ deviceId: 'synthetic-camera-b', calibrationId: b.calibrationId })
  })

  it('folds the short-lived per-camera list into the one posture, keeping the newest', () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    const older = { schemaVersion: 1, savedAt: '2026-10-16T01:00:00.000Z', ...entry }
    const newer = {
      schemaVersion: 1,
      savedAt: '2026-10-16T02:00:00.000Z',
      ...entry,
      deviceId: 'synthetic-camera-b',
      calibrationId: '22222222-2222-4222-8222-222222222222',
    }
    storage.setItem('posegood.v2.baseline', JSON.stringify(older))
    storage.setItem('posegood.v2.baselines', JSON.stringify([newer, older]))
    expect(readSavedBaseline()?.calibrationId).toBe(newer.calibrationId)
    writeSavedBaseline(entry)
    expect(storage.getItem('posegood.v2.baselines')).toBeNull()
    expect(readSavedBaseline()?.deviceId).toBe('synthetic-camera-a')
  })
})
