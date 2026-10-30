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
    expect(data.frames[0].world).toHaveLength(33)
    expect(data.pointIndices).toEqual(Array.from({ length: 33 }, (_, i) => i))
    expect(data.frames[0].image[15]).toMatchObject({ visibility: .05 }); expect(data.frames[0].image[23]).toBeNull()
    expect(JSON.stringify(data)).not.toMatch(/data:image|bitmap|videoBlob|features39/)
    data.frames[0].image[0]!.x = .1
    expect(a.snapshot().frames[0].image[0]?.x).toBe(.5)
  })
  it('preserves all 33 points, inference metadata and raw points even for a rejected clock', () => {
    const a = archive(), frame = comparisonDemo(100, 'neutral')
    const extra = Array.from({ length: 10 }, (_, i) => ({ x: i / 20, y: .9, z: .2, visibility: .3 }))
    a.append({ ...frame, extraLandmarks: extra, extraWorldLandmarks: extra, inferenceMs: 12, delegate: 'GPU', shoulders: 'seen' }, 0, context)
    a.append({ ...frame, extraLandmarks: extra, extraWorldLandmarks: extra, inferenceMs: 13, delegate: 'GPU' }, 100, context)
    const result = parseObservationReplay(JSON.stringify(a.snapshot()))
    expect(result.frames[0]).toMatchObject({ inferenceMs: 12, delegate: 'GPU', shoulders: 'seen' })
    expect(result.frames[0].image[32]).toEqual(extra[9]); expect(result.frames[1].observationTimeMs).toBeNull()
    expect(result.frames[1].image[32]).toEqual(extra[9]); expect(replayImageValid(result.frames[1])).toBe(false)
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
    expect(first.image.slice(13, 23)).toEqual(Array(10).fill(null)); expect(first.world.slice(13, 23)).toEqual(Array(10).fill(null))
    expect(first.image[12]).not.toBeNull()
  })
  it('records the run plan and rejects v2 files without one or with old tasks', () => {
    const a = recording(); a.setPlan({ rounds: 3, shuffle: false, cycle: 'stretch', stretchNote: '팔 뻗기' })
    expect(parseObservationReplay(JSON.stringify(a.snapshot())).plan).toEqual({ rounds: 3, shuffle: false, cycle: 'stretch', stretchNote: '팔 뻗기' })
    const missing = JSON.parse(encoded()); delete missing.plan
    expect(() => parseObservationReplay(JSON.stringify(missing))).toThrow()
    const old = JSON.parse(encoded()); old.frames[1].task = 'head'
    expect(() => parseObservationReplay(JSON.stringify(old))).toThrow()
  })
  it('imports v2 plans without changing their meaning and rejects malformed v3 plans', () => {
    const data = JSON.parse(encoded())
    const v2 = { ...data, schema_version: 'observation-keypoint-replay-v2', protocolId: 'front-observation-deviation-stretch-v4', plan: { rounds: 1, shuffle: true }, pointIndices: data.pointIndices.slice(0, 23), frames: data.frames.map((f: any) => ({ ...f, image: f.image.slice(0, 23), world: f.world.slice(0, 23) })) }
    expect(parseObservationReplay(JSON.stringify(v2)).plan).toEqual(v2.plan)
    for (const plan of [{ rounds: 1, shuffle: false }, { rounds: 1, shuffle: true, cycle: 'stretch', stretchNote: '' }, { rounds: 1, shuffle: false, cycle: 'repeat', stretchNote: 'invalid' }, { rounds: 1, shuffle: false, cycle: 'stretch', stretchNote: 'x'.repeat(121) }]) {
      expect(() => parseObservationReplay(JSON.stringify({ ...data, plan }))).toThrow()
    }
  })
  it('round trips each stretch note separately, and reads prior v3 recordings', () => {
    const a = recording(); a.setPlan({ rounds: 5, shuffle: false, cycle: 'stretch', stretchNote: '' })
    a.addStretchNote(1, 2, '팔 뻗기'); a.addStretchNote(2, 4, '기지개')
    const parsed = parseObservationReplay(JSON.stringify(a.snapshot()))
    expect(parsed.stretchNotes).toEqual([{ round: 1, trial: 2, note: '팔 뻗기' }, { round: 2, trial: 4, note: '기지개' }])
    const previous = JSON.parse(encoded()); previous.schema_version = 'observation-keypoint-replay-v3'; previous.protocolId = 'front-observation-optional-stretch-v5'; previous.pointIndices = previous.pointIndices.slice(0, 23); previous.frames = previous.frames.map((f: any) => ({ ...f, image: f.image.slice(0, 23), world: f.world.slice(0, 23) })); delete previous.stretchNotes
    expect(parseObservationReplay(JSON.stringify(previous))).toMatchObject({ schema_version: 'observation-keypoint-replay-v3', protocolId: previous.protocolId })
    for (const notes of [[{ round: 1, trial: 3, note: 'bad' }], [{ round: 6, trial: 12, note: 'bad' }], [{ round: 1, trial: 2, note: 'x'.repeat(121) }], [{ round: 1, trial: 2, note: '' }, { round: 1, trial: 2, note: '' }]]) {
      expect(() => parseObservationReplay(JSON.stringify({ ...a.snapshot(), stretchNotes: notes }))).toThrow()
    }
  })
  it('continues to load v4 23-point recordings', () => {
    const original = JSON.parse(encoded())
    const v4 = { ...original, schema_version: 'observation-keypoint-replay-v4', pointIndices: original.pointIndices.slice(0, 23), frames: original.frames.map((f: any) => ({ ...f, image: f.image.slice(0, 23), world: f.world.slice(0, 23) })) }
    expect(parseObservationReplay(JSON.stringify(v4))).toMatchObject({ schema_version: 'observation-keypoint-replay-v4', pointIndices: v4.pointIndices })
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
