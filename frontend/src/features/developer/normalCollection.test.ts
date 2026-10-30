import { describe, expect, it, vi } from 'vitest'
import * as normalPosture from '../../../../model/prototype/normalPosture'
import { fitNormalPostureProfile, normalProfileMatchesPoseModel, readNormalPostureProfile, scoreNormalPosture } from '../../../../model/prototype/normalPosture'
import type { Observation } from '../camera/types'
import { NormalCollectionCapture } from './normalCollection'

// Entirely synthetic points and participant codes; no camera/person data.
export const syntheticNormalFrame = (timeMs: number, poor = false): Observation => {
  const landmarks = Array.from({ length: 13 }, (_, i) => ({ x: i === 11 ? .3 : i === 12 ? .7 : .5,
    y: i < 11 ? .3 : .6, z: 0, visibility: poor ? .1 : .95 }))
  return { timeMs, videoTimeMs: timeMs, width: 640, height: 480, inferenceMs: 3, delegate: 'CPU',
    landmarks, worldLandmarks: landmarks.map(p => ({ ...p })), features: null }
}
const metadata = { participantCode: 'synthetic_p01', sessionCode: 'synthetic_session01', purpose: 'personal_calibration' as const }
const capture = () => new NormalCollectionCapture(metadata, 'synthetic_profile', '2026-10-14T00:00:00.000Z', 0)
const completed = () => { const c = capture(); for (let t = 0; t <= 33_000; t += 100) c.observe(syntheticNormalFrame(t)); return c }

describe('explicit normal collection, synthetic inputs only', () => {
  it('excludes preparation and cannot train/export until reviewed', () => {
    const c = capture()
    for (let t = 0; t < 3000; t += 100) c.observe(syntheticNormalFrame(t))
    expect(c.snapshot(2900)).toMatchObject({ phase: 'preparing', samples: 0, validMs: 0 })
    expect(() => c.confirm()).toThrow('30초')
    expect(() => c.exportDataset()).toThrow('확인')
    for (let t = 3000; t <= 33_000; t += 100) c.observe(syntheticNormalFrame(t))
    expect(c.snapshot(33_000)).toMatchObject({ phase: 'review', samples: 301, validMs: 30_000, canConfirm: true })
    expect(() => c.exportDataset()).toThrow('확인')
    const p = c.confirm(), dataset = c.exportDataset()
    expect(p.provenance).toMatchObject({ frames: 301, validMs: 30000, review: 'user_confirmed_normal', purpose: 'personal_calibration' })
    expect(dataset).toMatchObject({ schema_version: 'normal-posture-collection-v1', label: 'normal_assumed', labelDisplay: '정상자세(수동)',
      collectionMethod: 'manual_30s', review: 'user_confirmed_normal', source: 'webcam' })
    expect(dataset.frames[0].timeMs).toBe(3000)
    expect(dataset.frames[0].image).toHaveLength(13)
    expect(dataset.frames[0].world).toHaveLength(13)
    expect(dataset.frames[0].values).toHaveLength(39)
  })

  it('excludes quality failures and missing intervals without bridging them', () => {
    const c = capture()
    c.observe(syntheticNormalFrame(3000)); c.observe(syntheticNormalFrame(3100))
    c.observe(syntheticNormalFrame(3200, true)); c.observe(syntheticNormalFrame(3300)); c.observe(syntheticNormalFrame(3400))
    c.observe(syntheticNormalFrame(6000)); c.observe(syntheticNormalFrame(6100))
    expect(c.snapshot(6100)).toMatchObject({ validMs: 300, rejectedFrames: 1, gaps: 2 })
    c.finish()
    expect(c.snapshot(6100).canConfirm).toBe(false)
    expect(() => c.confirm()).toThrow('30초')
  })

  it('keeps real timestamps at irregular FPS and never invents regular samples', () => {
    const c = capture()
    for (let i = 0; i < 600; i++) c.observe(syntheticNormalFrame(i * (1000 / 11)))
    c.confirm()
    const d = c.exportDataset()
    expect(d.validMs).toBeGreaterThanOrEqual(30_000)
    expect(d.frames[1].timeMs - d.frames[0].timeMs).toBeCloseTo(2000 / 11)
    expect(d.frames.every(f => Math.abs(f.timeMs / (1000 / 11) - Math.round(f.timeMs / (1000 / 11))) < .0001)).toBe(true)
    expect(d.timing.interpolation).toBe(false)
  })

  it('does not count a repeated video frame as fresh valid observation', () => {
    const c = capture()
    c.observe(syntheticNormalFrame(3000))
    c.observe({ ...syntheticNormalFrame(3100), videoTimeMs: 3000 })
    c.observe(syntheticNormalFrame(3200))
    expect(c.snapshot(3200)).toMatchObject({ validMs: 0, samples: 2, rejectedFrames: 1 })
  })

  it('stops on hidden tabs, timestamp reversal, wall timeout and manual interruption', () => {
    const hidden = capture(); hidden.observe(syntheticNormalFrame(3000)); hidden.tick(3050, true)
    expect(hidden.snapshot(3050)).toMatchObject({ phase: 'review', validMs: 0, quality: 'unmeasurable' })
    const reversal = capture(); reversal.observe(syntheticNormalFrame(3000)); reversal.observe(syntheticNormalFrame(2900))
    expect(reversal.snapshot(3000).reason).toContain('역전')
    const timeout = capture(); timeout.tick(120_000)
    expect(timeout.snapshot(120_000)).toMatchObject({ phase: 'review', canConfirm: false })
    const manual = capture(); manual.observe(syntheticNormalFrame(3000)); manual.interrupt('직접 중단', 3100)
    manual.observe(syntheticNormalFrame(3200))
    expect(manual.snapshot(3200)).toMatchObject({ phase: 'review', samples: 1, validMs: 0, reason: '직접 중단' })
  })

  it('owns copies and freezes reviewed data instead of absorbing future deviations', () => {
    const c = completed(), p = c.confirm(), d = c.exportDataset()
    d.frames[0].image[0].x = 0; d.profile.tolerance[0] = 999
    c.observe(syntheticNormalFrame(34000))
    expect(c.exportDataset().frames[0].image[0].x).toBe(.5)
    expect(c.exportDataset().frames).toHaveLength(301)
    expect(p.tolerance[0]).toBe(.12)
  })
  it('exports and imports actual extractor provenance without labeling legacy profiles as known', () => {
    const c = capture()
    for (let t = 0; t <= 33_000; t += 100) c.observe({ ...syntheticNormalFrame(t), poseModelId: 'synthetic-full-v1/tasks-1.0.1' })
    const profile = c.confirm(), d = c.exportDataset(), imported = readNormalPostureProfile(profile)
    expect(d.metadata.poseModelId).toBe('synthetic-full-v1/tasks-1.0.1')
    expect(d.frames.every(frame => frame.poseModelId === d.metadata.poseModelId)).toBe(true)
    expect(imported.provenance.poseModelId).toBe(d.metadata.poseModelId)
    expect(normalProfileMatchesPoseModel(imported, d.metadata.poseModelId)).toBe(true)
    expect(normalProfileMatchesPoseModel(imported, 'synthetic-heavy-v1/tasks-1.0.1')).toBe(false)
    expect(normalProfileMatchesPoseModel(imported, undefined)).toBe(false)
    const legacy = readNormalPostureProfile(completed().confirm())
    expect(legacy.provenance).not.toHaveProperty('poseModelId')
    expect(normalProfileMatchesPoseModel(legacy, 'synthetic-heavy-v1/tasks-1.0.1')).toBe(false)
    expect(() => readNormalPostureProfile({ ...profile, provenance: { ...profile.provenance, poseModelId: '' } })).toThrow()
  })
  it.each(['synthetic-heavy-v1', undefined])('stops instead of fitting mixed extractor data (%s)', poseModelId => {
    const c = capture()
    c.observe({ ...syntheticNormalFrame(3000), poseModelId: 'synthetic-full-v1' })
    c.observe({ ...syntheticNormalFrame(3100), poseModelId })
    expect(c.snapshot(3100)).toMatchObject({ phase: 'review', samples: 1, validMs: 0, canConfirm: false })
    expect(c.snapshot(3100).reason).toContain('모델')
    expect(() => c.confirm()).toThrow('30초')
  })
})

describe('explicit forecast evaluation capture, synthetic inputs only', () => {
  it('requires 30 valid seconds and review, exports no normal label, and never fits a profile', () => {
    const fit = vi.spyOn(normalPosture, 'fitNormalPostureProfile')
    try {
      const c = new NormalCollectionCapture({ ...metadata, purpose: 'forecast_evaluation' },
        'synthetic_evaluation', '2026-10-15T00:00:00.000Z', 0)
      for (let time = 0; time <= 3000; time += 100) c.observe(syntheticNormalFrame(time))
      expect(c.snapshot(3000)).toMatchObject({ validMs: 0, samples: 1, canConfirm: false })
      expect(() => c.confirm()).toThrow('30초')
      expect(() => c.exportDataset()).toThrow('확인')
      for (let time = 3100; time <= 33000; time += 100) c.observe(syntheticNormalFrame(time))
      expect(c.snapshot(33000)).toMatchObject({ phase: 'review', validMs: 30000, samples: 301, canConfirm: true })
      expect(() => c.exportDataset()).toThrow('확인')
      expect(c.confirm()).toBeNull()
      expect(fit).not.toHaveBeenCalled()
      expect(c.snapshot(33000).phase).toBe('confirmed')
      const dataset = c.exportDataset()
      expect(dataset).toMatchObject({ schema_version: 'forecast-evaluation-collection-v1', dataRole: 'evaluation_only',
        trainingAllowed: false, review: 'user_confirmed_evaluation', collectionMethod: 'manual_30s',
        metadata: { ...metadata, purpose: 'forecast_evaluation' }, validMs: 30000 })
      for (const field of ['profile', 'label', 'labelDisplay']) expect(dataset).not.toHaveProperty(field)
      expect(dataset.frames[0].timeMs).toBe(3000)
      expect(dataset.frames[0].values).toHaveLength(39)
      dataset.frames[0].image[0].x = 0
      c.observe(syntheticNormalFrame(34000))
      expect(c.exportDataset().frames).toHaveLength(301)
      expect(c.exportDataset().frames[0].image[0].x).toBe(.5)
    } finally { fit.mockRestore() }
  })

  it('preserves evaluation-only purpose across quality gaps without treating low quality as valid time', () => {
    const c = new NormalCollectionCapture({ ...metadata, purpose: 'forecast_evaluation' },
      'synthetic_evaluation_gaps', '2026-10-15T00:00:00.000Z', 0)
    c.observe(syntheticNormalFrame(3000)); c.observe(syntheticNormalFrame(3100))
    c.observe(syntheticNormalFrame(3200, true)); c.observe(syntheticNormalFrame(3300))
    expect(c.snapshot(3300)).toMatchObject({ validMs: 100, rejectedFrames: 1, gaps: 1 })
    for (let time = 3400; time <= 33200; time += 100) c.observe(syntheticNormalFrame(time))
    expect(c.confirm()).toBeNull()
    const dataset = c.exportDataset()
    expect(dataset.metadata.purpose).toBe('forecast_evaluation')
    expect(dataset.gaps).toEqual([{ timeMs: 3200, reason: 'quality' }])
    expect(dataset.frames[2].segment).not.toBe(dataset.frames[1].segment)
  })
})

describe('normal-only robust envelope fitting, synthetic inputs only', () => {
  it('fits reviewed actual variation and keeps a steady offset outside the learned center', () => {
    const c = completed(), p = c.confirm(), baseline = p.baseline
    expect(scoreNormalPosture(p, baseline)?.score).toBe(0)
    const shifted = baseline.map((v, i) => i < 33 && i % 3 === 0 ? v + .25 : v)
    expect(scoreNormalPosture(p, shifted)?.score).toBeGreaterThan(1)
    expect(scoreNormalPosture({ ...p, baseline: shifted }, shifted)?.score).toBeGreaterThan(1)
    expect(scoreNormalPosture(p, [NaN])).toBeNull()
    const samples = Array.from({ length: 301 }, (_, i) => ({ timeMs: i * 100,
      values: baseline.map((v, axis) => axis < 33 && axis % 3 === 0 ? v + .3 * Math.sin(i) : v) }))
    const varied = fitNormalPostureProfile(samples, { ...metadata, id: 'synthetic_varied', createdAt: '2026-10-14T00:00:00Z' })
    expect(varied.tolerance[0]).toBeGreaterThan(p.tolerance[0])
    expect(varied.domainValidated).toBe(false)
  })

  it('rejects insufficient, disjoint or non-monotonic calibration input', () => {
    const p = completed().confirm(), meta = { ...metadata, id: 'synthetic_test', createdAt: '2026-10-14T00:00:00Z' }
    expect(() => fitNormalPostureProfile([{ timeMs: 0, values: p.baseline }], meta)).toThrow('30초')
    expect(() => fitNormalPostureProfile(Array.from({ length: 301 }, (_, i) => ({ timeMs: i * 1000, values: p.baseline })), meta)).toThrow('30초')
    expect(() => fitNormalPostureProfile([{ timeMs: 100, values: p.baseline }, { timeMs: 50, values: p.baseline }], meta)).toThrow('시간 순서')
    expect(() => fitNormalPostureProfile(Array.from({ length: 301 }, (_, i) => ({ timeMs: i * 100, values: p.baseline, segment: i })), meta)).toThrow('30초')
  })

  it('validates imported dimensions, provenance, numeric floors and unvalidated status', () => {
    const p = completed().confirm()
    expect(readNormalPostureProfile(p)).toEqual(p)
    for (const invalid of [null, {}, { ...p, domainValidated: true }, { ...p, tolerance: Array(9).fill(0) },
      { ...p, center: [NaN] }, { ...p, provenance: { ...p.provenance, participantCode: undefined } },
      { ...p, provenance: { ...p.provenance, review: 'automatic' } }]) expect(() => readNormalPostureProfile(invalid)).toThrow()
    expect(readNormalPostureProfile({ ...p, irrelevantRaw: ['discard this'] })).not.toHaveProperty('irrelevantRaw')
  })
})
