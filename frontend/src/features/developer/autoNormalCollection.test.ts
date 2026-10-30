import { describe, expect, it } from 'vitest'
import { liveForecastPoints, pointDistance, type ForecastReading } from '../../../../model/prototype/forecast'
import type { Observation } from '../camera/types'
import { AutoNormalCapture, AUTO_NORMAL_CLEAN_SELECTION, AUTO_NORMAL_LIMITS, type AutoNormalObservation } from './autoNormalCollection'

// Synthetic camera-shaped input only; no actual people or recordings.
const observation = (timeMs: number, deviation = 0): AutoNormalObservation => {
  const landmarks = Array.from({ length: 13 }, (_, i) => ({ x: i === 11 ? .3 : i === 12 ? .7 : .5,
    y: i < 11 ? .3 : .6, z: 0, visibility: .95 }))
  const frame: Observation = { timeMs, videoTimeMs: timeMs, width: 640, height: 480, inferenceMs: 3,
    delegate: 'CPU', landmarks, worldLandmarks: landmarks.map(p => ({ ...p })), features: null }
  const values = liveForecastPoints(frame.landmarks, frame.worldLandmarks)!
  const baseline = values.map((value, i) => i % 3 === 0 ? value - deviation : value)
  const reading: ForecastReading = { schema_version: 'forecast-experiment-v1', timeMs, state: 'warming', ruleState: 'near_reference',
    deviation, error: null, errorLimit: .02, durationMs: 0, progress: 1, returnedExcursions: 0,
    modelId: 'synthetic_hold_last', domainValidated: false, evaluationMode: 'observed-v2' }
  return { frame, reading, runId: 'synthetic_run', baseline, source: 'camera', observationTimeMs: timeMs }
}
const capture = () => new AutoNormalCapture('synthetic_anon', 'synthetic_capture', '2026-10-14T00:00:00Z')
const cleanObservation = (time: number, score = .2): AutoNormalObservation => {
  const input = observation(time)
  input.reading.imagePosture = { policy: 'image-posture-anchor-v2', status: 'ready', score, translation: score * .18,
    shrink: 0, translationLimit: .18, shrinkLimit: .12, strongest: score ? 'position' : null }
  input.reading.postureScore = score
  return input
}
describe('clean normal selection with explicit synthetic observations', () => {
  it('waits a continuous second, includes the half-boundary, and starts a new segment after leaving it', () => {
    const c = capture()
    for (let t = 0; t <= 1100; t += 100) c.observe(cleanObservation(t, .5))
    expect(c.exportDataset().rows.map(row => row.timeMs)).toEqual([1000, 1100])
    c.observe(cleanObservation(1200, .50001))
    for (let t = 1300; t <= 2300; t += 100) c.observe(cleanObservation(t))
    const d = c.exportDataset()
    expect(d.rows.map(row => row.segment)).toEqual([0, 0, 1])
    expect(d.rows.at(-1)).toMatchObject({ selectionPolicy: 'auto-normal-clean-v1', postureScore: .2, stableForMs: 1000, imagePosturePolicy: 'image-posture-anchor-v2' })
    expect(d.selection.cleanGate).toEqual(AUTO_NORMAL_CLEAN_SELECTION)
    expect(d.reviewGate).toBeUndefined()
    expect(c.snapshot().requiresReviewRows).toBe(0)
    expect(c.snapshot().diagnostics.excluded.stability).toBe(20)
  })
  it('never stores a below-alarm but above-collection body score even at zero relative distance', () => {
    const c = capture()
    for (let t = 0; t <= 5000; t += 100) c.observe(cleanObservation(t, .8))
    expect(c.snapshot()).toMatchObject({ total: 0, status: 'outside' })
    expect(c.snapshot().diagnostics.excluded.outside).toBe(51)
  })
  it('does not treat pending/recovery states as normal or backfill the qualification period', () => {
    const c = capture()
    for (const [index, ruleState] of ['deviation_pending', 'recovery_pending', 'persistent_deviation_candidate'].entries()) {
      const row = cleanObservation(index * 100); row.reading.ruleState = ruleState as ForecastReading['ruleState']; c.observe(row)
    }
    for (let t = 300; t < 1300; t += 100) c.observe(cleanObservation(t))
    expect(c.snapshot().total).toBe(0)
    c.observe(cleanObservation(1300))
    expect(c.exportDataset().rows.map(row => row.timeMs)).toEqual([1300])
  })
  it('resets qualification on quality loss and gaps without counting absent time as stable', () => {
    const c = capture()
    for (let t = 0; t <= 800; t += 100) c.observe(cleanObservation(t))
    const bad = cleanObservation(900); bad.frame.landmarks[0].visibility = .1; c.observe(bad)
    for (let t = 1000; t <= 1700; t += 100) c.observe(cleanObservation(t))
    for (let t = 2100; t < 3100; t += 100) c.observe(cleanObservation(t))
    expect(c.snapshot().total).toBe(0)
    c.observe(cleanObservation(3100))
    expect(c.exportDataset().rows[0].timeMs).toBe(3100)
  })
  it('restarts qualification when a not-yet-stored reference or configured threshold changes', () => {
    const c = capture()
    for (let t = 0; t <= 500; t += 100) c.observe(cleanObservation(t))
    const changed = (t: number) => {
      const input = cleanObservation(t); input.baseline[0] += .001
      input.reading.deviation = pointDistance(liveForecastPoints(input.frame.landmarks, input.frame.worldLandmarks)!, input.baseline)
      return input
    }
    for (let t = 600; t < 1600; t += 100) c.observe(changed(t))
    expect(c.snapshot().total).toBe(0)
    c.observe(changed(1600)); expect(c.snapshot().total).toBe(1)
    c.setMaximumDeviation(.03)
    for (let t = 1700; t < 2700; t += 100) c.observe(changed(t))
    expect(c.snapshot().total).toBe(1)
    c.observe(changed(2700)); expect(c.exportDataset().rows.map(row => row.segment)).toEqual([0, 1])
  })
  it('refuses unknown composite scores and preserves legacy rows as review-required without rewriting their labels', () => {
    const c = capture(); c.observe(observation(0))
    const bad = cleanObservation(100); bad.reading.postureScore = null; c.observe(bad)
    const mismatch = cleanObservation(150, .4); mismatch.reading.postureScore = .1; c.observe(mismatch)
    for (let t = 200; t <= 1200; t += 100) c.observe(cleanObservation(t))
    const d = c.exportDataset()
    expect(d.rows).toHaveLength(2)
    expect(d.rows[0]).not.toHaveProperty('selectionPolicy')
    expect(d.rows[0].label).toBe('normal_auto_assumed')
    expect(d).toMatchObject({ trainingAllowed: false, reviewGate: { status: 'requires_review', affectedRows: 1 } })
    expect(c.snapshot().requiresReviewRows).toBe(1)
  })
})
describe('automatic normal pseudo-label capture with synthetic fixtures', () => {
  it('excludes whole-body retreat despite zero normalized distance and records applied guard provenance', () => {
    const c = capture()
    const guarded = (t: number, score: number): AutoNormalObservation => {
      const row = observation(t)
      row.reading.imagePosture = { policy: 'image-posture-anchor-v1', status: 'ready', score, translation: 0,
        shrink: score * .2, translationLimit: .45, shrinkLimit: .2, strongest: score ? 'scale' : null }
      row.reading.postureScore = score
      return row
    }
    c.observe(guarded(0, 0)); c.observe(guarded(100, 2)); c.observe(guarded(200, 0))
    expect(c.snapshot().total).toBe(2)
    expect(c.snapshot().diagnostics.excluded.outside).toBe(1)
    expect(c.exportDataset().rows.map(r => r.segment)).toEqual([0, 1])
    expect(c.exportDataset().rows[0]).toMatchObject({ imagePosturePolicy: 'image-posture-anchor-v1', imagePostureScore: 0 })
    const unknown = guarded(300, 0); unknown.reading.imagePosture!.status = 'unmeasurable'; unknown.reading.imagePosture!.score = null
    c.observe(unknown); expect(c.snapshot().total).toBe(2)
  })
  it('appends every eligible observation, includes the .5% boundary and does not wait for prediction warmup', () => {
    const c = capture(); c.setMaximumDeviation(.005)
    c.observe(observation(0, .0049)); c.observe(observation(100, .005)); c.observe(observation(200, .00500001))
    expect(c.snapshot()).toMatchObject({ enabled: true, total: 2, status: 'outside' })
    expect(c.exportDataset().rows.map(row => row.deviation)).toEqual([.0049, .005])
    expect(c.exportDataset()).toMatchObject({ label: 'normal_auto_assumed', displayLabel: '정상자세(자동)',
      labelSource: 'auto_rule', review: 'not_reviewed', purpose: 'early_experiment_only', domainValidated: false })
  })
  it('keeps actual timestamps and limits the rate even across rejected frames', () => {
    const c = capture(); c.setMaximumDeviation(.005)
    for (let t = 0; t <= 1000; t += 20) c.observe(observation(t, t === 20 ? .006 : 0))
    expect(c.snapshot().total).toBe(11)
    const d = c.exportDataset()
    expect(d.rows[1]).toMatchObject({ timeMs: 100, observationTimeMs: 100, videoTimeMs: 100 })
    expect(d.rows.every((row, i, rows) => i === 0 || row.timeMs - rows[i - 1].timeMs >= 100)).toBe(true)
    expect(d.rows[0].image).toHaveLength(13); expect(d.rows[0].world).toHaveLength(13); expect(d.rows[0].values).toHaveLength(39)
    expect(d.selection.interpolation).toBe(false)
  })
  it('separates eligible islands around outliers, quality loss, duplicate frames and gaps', () => {
    const c = capture(); c.observe(observation(0))
    c.observe(observation(100, .1)); c.observe(observation(200))
    const poor = observation(300); poor.frame.landmarks[0].visibility = .1; c.observe(poor)
    c.observe(observation(400))
    const duplicate = observation(500); duplicate.frame.videoTimeMs = 400; c.observe(duplicate)
    c.observe(observation(600)); c.observe(observation(1000))
    expect(c.exportDataset().rows.map(row => row.segment)).toEqual([0, 1, 2, 3, 4])
  })
  it('rejects synthetic, unregistered, unmeasurable or stale mismatched readings', () => {
    const c = capture()
    const demo = observation(0); demo.source = 'synthetic'; c.observe(demo)
    const registering = observation(100); registering.reading.ruleState = 'registering'; c.observe(registering)
    const unknown = observation(200); unknown.reading.state = 'unmeasurable'; c.observe(unknown)
    const staleTime = observation(300); staleTime.reading.timeMs = 200; c.observe(staleTime)
    const staleDistance = observation(400); staleDistance.reading.deviation = .001; c.observe(staleDistance)
    const invalid = observation(500); invalid.baseline[0] = NaN; c.observe(invalid)
    const nonFinite = observation(600); nonFinite.frame.videoTimeMs = NaN; c.observe(nonFinite)
    expect(c.snapshot().total).toBe(0); expect(() => c.exportDataset()).toThrow('아직')
    c.observe(observation(700)); expect(c.snapshot().total).toBe(1)
  })
  it('copies immutable references and participant identity for each run or re-registration', () => {
    const c = capture(), initial = observation(1000)
    c.observe(initial); initial.baseline[0] = 100; initial.frame.landmarks[0].x = 0
    const changed = observation(1100); changed.baseline[0] += .001; changed.reading.deviation = pointDistance(liveForecastPoints(changed.frame.landmarks, changed.frame.worldLandmarks)!, changed.baseline); c.observe(changed)
    c.setEnabled(false); c.setParticipantCode('synthetic_second'); c.setEnabled(true)
    c.observe(observation(1200))
    c.endRun(); const nextRun = observation(50); nextRun.runId = 'synthetic_run_two'; c.observe(nextRun)
    const d = c.exportDataset()
    expect(d.references).toHaveLength(4)
    expect(d.rows.map(row => row.participantCode)).toEqual(['synthetic_anon', 'synthetic_anon', 'synthetic_second', 'synthetic_second'])
    expect(d.rows.map(row => row.segment)).toEqual([0, 1, 2, 3])
    expect(d.rows[0].image[0].x).toBe(.5); expect(d.references[0].values[0]).not.toBe(100)
    d.rows[0].values[0] = 999; d.references[0].values[0] = 999
    expect(c.exportDataset().rows[0].values[0]).not.toBe(999); expect(c.exportDataset().references[0].values[0]).not.toBe(999)
  })
  it('preserves oldest rows at the memory cap until explicit discard', () => {
    const c = capture()
    for (let i = 0; i <= AUTO_NORMAL_LIMITS.maximumRows + 2; i++) c.observe(observation(i * 100))
    expect(c.snapshot()).toMatchObject({ status: 'full', full: true, total: 6000 })
    expect(c.snapshot().recentRows).toHaveLength(20)
    expect(c.exportDataset().rows[0].timeMs).toBe(0)
    c.markGap(); c.endRun(); expect(c.snapshot().status).toBe('full')
    c.discard(); expect(c.snapshot()).toMatchObject({ total: 0, full: false, enabled: true })
    c.observe(observation(0)); expect(c.snapshot().total).toBe(1)
  })
  it('pauses collection and blocks identity changes while enabled', () => {
    const c = capture(); expect(() => c.setParticipantCode('synthetic_next')).toThrow('멈춘')
    c.observe(observation(0)); c.setEnabled(false); c.observe(observation(100)); c.markGap()
    expect(c.snapshot()).toMatchObject({ total: 1, status: 'paused' })
    expect(() => c.setParticipantCode('이름')).toThrow('익명')
    c.setEnabled(true); c.observe(observation(200))
    expect(c.exportDataset().rows.map(row => row.segment)).toEqual([0, 1])
  })
  it('preserves actual extractor identity and separates variants even when reference coordinates match', () => {
    const c = capture()
    for (const [index, poseModelId] of [undefined, 'synthetic-heavy-v1', 'synthetic-full-v1', 'synthetic-full-v1'].entries()) {
      const input = observation(index * 100)
      input.frame.poseModelId = poseModelId
      c.observe(input)
    }
    const d = c.exportDataset()
    expect(d.rows.map(row => row.poseModelId)).toEqual([undefined, 'synthetic-heavy-v1', 'synthetic-full-v1', 'synthetic-full-v1'])
    expect(d.references.map(reference => reference.poseModelId)).toEqual([undefined, 'synthetic-heavy-v1', 'synthetic-full-v1'])
    expect(d.rows.map(row => row.segment)).toEqual([0, 1, 2, 2])
    expect(d.rows[2].referenceId).toBe(d.rows[3].referenceId)
    expect(d.rows[0]).not.toHaveProperty('poseModelId')
    d.references[1].poseModelId = 'changed-outside'
    expect(c.exportDataset().references[1].poseModelId).toBe('synthetic-heavy-v1')
  })
  it('defaults to 6% inclusively and preserves each historical threshold in v2 rows', () => {
    const c = capture()
    expect(c.snapshot().maximumDeviation).toBe(.06)
    c.observe(observation(0, .06)); c.observe(observation(100, .060001))
    c.setMaximumDeviation(.03); c.observe(observation(200, .03)); c.observe(observation(300, .030001))
    c.setMaximumDeviation(.005); c.observe(observation(400, .005)); c.observe(observation(500, .005001))
    const d = c.exportDataset()
    expect(d.schema_version).toBe('normal-posture-auto-collection-v2')
    expect(d.rows.map(row => row.maximumDeviation)).toEqual([.06, .03, .005])
    expect(d.rows.map(row => row.deviation)).toEqual([.06, .03, .005])
    expect(d.selection).toMatchObject({ thresholdSource: 'row.maximumDeviation', configuredMaximumDeviation: .005, allowedMaximumDeviations: [.005, .03, .06] })
    expect(d.rows.map(row => row.segment)).toEqual([0, 1, 2])
    expect(() => c.setMaximumDeviation(.12)).toThrow('0.5%')
    expect(c.snapshot().maximumDeviation).toBe(.005)
  })
  it('counts 33-grid-point candidate windows and never joins threshold changes or interruptions', () => {
    const c = capture()
    for (let t = 0; t <= 3100; t += 100) c.observe(observation(t))
    expect(c.snapshot().diagnostics).toMatchObject({ candidateWindows: 0, longestSegmentMs: 3100 })
    c.observe(observation(3200)); c.observe(observation(3300))
    expect(c.snapshot().diagnostics).toMatchObject({ candidateWindows: 2, longestSegmentMs: 3300 })
    c.setMaximumDeviation(.03)
    for (let t = 3400; t <= 6500; t += 100) c.observe(observation(t))
    expect(c.snapshot().diagnostics.candidateWindows).toBe(2)
    c.observe(observation(6600))
    expect(c.snapshot().diagnostics.candidateWindows).toBe(3)
    c.markGap()
    for (let t = 6700; t <= 9900; t += 100) c.observe(observation(t))
    expect(c.snapshot().diagnostics).toMatchObject({ candidateWindows: 4, longestSegmentMs: 3300, interruptions: 1 })
    expect(c.exportDataset().rows.filter(row => row.timeMs === 3300 || row.timeMs === 3400).map(row => row.segment)).toEqual([0, 1])
  })
  it('splits stored gaps above 250ms even when raw frames passed the rate cap', () => {
    const c = capture()
    c.observe(observation(0)); c.observe(observation(90)); c.observe(observation(339))
    expect(c.exportDataset().rows.map(row => row.segment)).toEqual([0, 1])
    expect(c.snapshot().diagnostics).toMatchObject({ longestSegmentMs: 0, candidateWindows: 0, excluded: { rate: 1 }, interruptions: 1 })
  })
  it('reports coordinate-free exclusion counts without treating skipped rate frames as quality failures', () => {
    const c = capture()
    c.observe(observation(0)); c.observe(observation(50))
    c.observe(observation(100, .07))
    const poor = observation(200); poor.frame.landmarks[0].visibility = .1; c.observe(poor)
    const stale = observation(300); stale.reading.timeMs = 200; c.observe(stale)
    const wrong = observation(400); wrong.reading.deviation = .001; c.observe(wrong)
    const demo = observation(500); demo.source = 'synthetic'; c.observe(demo)
    const registering = observation(600); registering.reading.ruleState = 'registering'; c.observe(registering)
    c.setEnabled(false); c.observe(observation(700))
    const diagnostics = c.snapshot().diagnostics
    expect(diagnostics.received).toBe(9)
    expect(diagnostics.excluded).toEqual({ outside: 1, stability: 0, quality: 1, registration: 1, timing: 1, provenance: 1, rate: 1, synthetic: 1, paused: 1, full: 0 })
    expect(Object.values(diagnostics.excluded).reduce((sum, n) => sum + n, 0) + c.snapshot().total).toBe(diagnostics.received)
    expect(JSON.stringify(diagnostics)).not.toMatch(/landmarks|image|world|values|participant/)
    diagnostics.excluded.outside = 999
    expect(c.snapshot().diagnostics.excluded.outside).toBe(1)
    c.discard(); expect(c.snapshot().diagnostics).toMatchObject({ received: 0, candidateWindows: 0, longestSegmentMs: 0 })
  })
})
