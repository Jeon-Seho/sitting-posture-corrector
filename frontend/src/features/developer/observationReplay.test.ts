import { describe, expect, it } from 'vitest'
import { comparisonDemo } from './comparisonDemo'
import { ObservationReplayArchive, parseObservationReplay, replayFeatures, replayFrameAt, replayImageValid, REPLAY_LIMIT, type ReplayContext } from './observationReplay'
const context: ReplayContext = { phase: 'hold', task: 'deviation', round: 1, trial: 1, attempt: 1, segment: 1, measurement: true }
const archive = () => new ObservationReplayArchive('explicit-synthetic-test', '2026-10-21T00:00:00.000Z')
const recording = () => { const a = archive(); a.append(comparisonDemo(100, 'neutral'), 0, context); a.append(comparisonDemo(200, 'deviation'), 100, context); return a }
const encoded = () => JSON.stringify({ ...recording().snapshot(), source: 'synthetic' })
describe('bounded keypoint-only replay archive', () => {
  it('copies raw image/world points, metadata and missing values without video or derived features', () => {
    const a = archive(), frame = comparisonDemo(100, 'deviation')
    frame.landmarks[1].x = NaN
    a.append({ ...frame, videoTimeMs: 90 }, 0, { ...context, phase: 'preparing', measurement: false })
    frame.landmarks[0].x = .8
    const data = a.snapshot()
    expect(data.frames[0].image[0]?.x).toBe(.5)
    expect(data.frames[0].image[1]).toBeNull()
    expect(data.frames[0]).toMatchObject({ observationTimeMs: 100, videoTimeMs: 90, phase: 'preparing', measurement: false, width: 640, height: 480 })
    expect(data.frames[0].world).toHaveLength(23)
    expect(data.pointIndices).toEqual(Array.from({ length: 23 }, (_, i) => i))
    expect(data.frames[0].image[15]).toMatchObject({ visibility: .05 })
    expect(JSON.stringify(data)).not.toMatch(/data:image|bitmap|videoBlob|features39/)
    data.frames[0].image[0]!.x = .1
    expect(a.snapshot().frames[0].image[0]?.x).toBe(.5)
  })
  it('keeps invalid observations and tracking gaps empty, never holds a stale pose across interruption', () => {
    const a = recording()
    expect(replayImageValid(a.snapshot().frames[0])).toBe(true)
    expect(replayFeatures(a.snapshot().frames[0])).toHaveLength(39)
    expect(replayFrameAt(a.snapshot(), 601)).toBeNull()
    a.mark(150, 'hidden'); a.mark(160, 'hidden')
    expect(a.snapshot().markers).toHaveLength(1)
    expect(replayFrameAt(a.snapshot(), 150)).toBeNull()
    a.append(comparisonDemo(300, 'stretch'), 200, context)
    expect(replayFrameAt(a.snapshot(), 200)?.task).toBe('deviation')
    a.append(comparisonDemo(200, 'neutral'), 300, context)
    expect(a.snapshot().frames.at(-1)?.observationTimeMs).toBeNull()
    expect(replayFeatures(a.snapshot().frames.at(-1)!)).toBeNull()
    expect(replayImageValid(a.snapshot().frames.at(-1)!)).toBe(false)
    expect(() => parseObservationReplay(JSON.stringify(a.snapshot()))).not.toThrow()
  })
  it('retains the first bounded archive and reports additional frames rather than silently dropping its beginning', () => {
    const a = archive(), frame = comparisonDemo(0,'neutral')
    for (let i = 0; i < REPLAY_LIMIT + 2; i++) a.append({ ...frame, timeMs: i * 100 }, i * 100, context)
    expect(a.count).toBe(REPLAY_LIMIT); expect(a.droppedFrames).toBe(2)
    expect(a.snapshot().frames[0].elapsedMs).toBe(0)
  })
})
describe('untrusted replay JSON validation', () => {
  it('round trips only the versioned format with explicit coordinate order and provenance', () => {
    const data = parseObservationReplay(encoded())
    expect(data.source).toBe('synthetic')
    expect(data.forecastOrder).toHaveLength(13)
    expect(data.frames).toHaveLength(2)
    expect(data.scope).toBe('all_phases_replay_only')
  })
  it('keeps arm points null when a frame carries none, never zero or copied', () => {
    const a = archive(), { armLandmarks: _arms, armWorldLandmarks: _world, ...frame } = comparisonDemo(100, 'neutral')
    a.append(frame, 0, context)
    const [first] = a.snapshot().frames
    expect(first.image.slice(13)).toEqual(Array(10).fill(null)); expect(first.world.slice(13)).toEqual(Array(10).fill(null))
    expect(first.image[12]).not.toBeNull()
  })
  it('records the run plan and rejects v2 files without one or with old tasks', () => {
    const a = recording(); a.setPlan({ rounds: 3, shuffle: false })
    expect(parseObservationReplay(JSON.stringify(a.snapshot())).plan).toEqual({ rounds: 3, shuffle: false })
    const missing = JSON.parse(encoded()); delete missing.plan
    expect(() => parseObservationReplay(JSON.stringify(missing))).toThrow()
    const old = JSON.parse(encoded()); old.frames[1].task = 'head'
    expect(() => parseObservationReplay(JSON.stringify(old))).toThrow()
  })
  it.each(['front-observation-2-5-5x3-v2', 'front-observation-manual-ready-5-5x3-v3'])('still imports an older 13-point v1 recording of %s', protocolId => {
    const data = JSON.parse(encoded())
    const legacy = { ...data, schema_version: 'observation-keypoint-replay-v1', protocolId, pointIndices: data.pointIndices.slice(0, 13),
      frames: data.frames.map((f: { image: unknown[]; world: unknown[] }) => ({ ...f, task: 'head', image: f.image.slice(0, 13), world: f.world.slice(0, 13) })) }
    delete legacy.plan
    const parsed = parseObservationReplay(JSON.stringify(legacy))
    expect(parsed).toMatchObject({ schema_version: 'observation-keypoint-replay-v1', protocolId, plan: null })
    expect(parsed.frames[0].image).toHaveLength(13); expect(parsed.frames[0].task).toBe('head')
    expect(() => parseObservationReplay(JSON.stringify({ ...legacy, pointIndices: data.pointIndices }))).toThrow()
  })
  it.each(['schema_version','pointIndices','forecastOrder','mirrored','labelKind','scope','protocolId','source'])('rejects incompatible %s', field => {
    const data = JSON.parse(encoded()); data[field] = 'unsupported'
    expect(() => parseObservationReplay(JSON.stringify(data))).toThrow()
  })
  it.each(['elapsedMs','observationTimeMs','width','image','measurement','phase','task','segment','round','poseModelId'])('rejects malformed frame %s without accepting a training dataset', field => {
    const data = JSON.parse(encoded()); data.frames[1][field] = field === 'elapsedMs' ? 0 : field === 'poseModelId' ? 42 : 'bad'
    expect(() => parseObservationReplay(JSON.stringify(data))).toThrow()
  })
  it('rejects nonmonotonic observation clocks, invalid point values, oversized arrays and impossible markers', () => {
    for (const mutate of [
      (d: any) => { d.frames[1].observationTimeMs = 50 },
      (d: any) => { d.frames[0].image[0].visibility = 2 },
      (d: any) => { d.frames = Array(REPLAY_LIMIT + 1).fill(d.frames[0]) },
      (d: any) => { d.markers = [{ elapsedMs: 50, afterFrame: 20, reason: 'hidden' }] },
    ]) { const data = JSON.parse(encoded()); mutate(data); expect(() => parseObservationReplay(JSON.stringify(data))).toThrow() }
    expect(() => parseObservationReplay('{')).toThrow()
    expect(() => parseObservationReplay('{"schema_version":"normal-posture-collection-v1"}')).toThrow()
  })
})
