import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ForecastWeights } from '../../../../model/prototype/forecast'
import { liveForecastPoints } from '../../../../model/prototype/forecast'
import { fitNormalPostureProfile, type NormalPostureProfile } from '../../../../model/prototype/normalPosture'
import type { CameraController, Observation } from '../../hooks/useCamera'
import type { DeveloperSession } from './types'
import { useDeveloperSession, type DeveloperCollectionSink } from './useDeveloperSession'
import { exportLabRecord } from './session'
import { readPipelinePerformance, resetPipelinePerformance } from './pipelinePerformance'

const sound = vi.hoisted(() => ({ arm: vi.fn(), beep: vi.fn(), cancel: vi.fn(), dispose: vi.fn() }))
vi.mock('./alertAudio', () => ({ DeveloperAlertAudio: class {
  arm = sound.arm; beep = sound.beep; cancel = sound.cancel; dispose = sound.dispose
} }))

// Explicit synthetic weights exercise validation/provenance, not model performance.
const weights = (): ForecastWeights => ({ schema_version: 'forecast-weights-v1', model_id: 'explicit-synthetic-test',
  source_sha256: 'a'.repeat(64), domain_validated: false,
  config: { steps: 30, dimensions: 39, hidden: 48, horizon: 3, point_definition: 'Panoptic-face9-body4-not-MediaPipe' },
  mean: Array(39).fill(0), scale: Array(39).fill(1), weights: {
    'lstm.weight_ih_l0': Array(192 * 39).fill(0), 'lstm.weight_hh_l0': Array(192 * 48).fill(0),
    'lstm.bias_ih_l0': Array(192).fill(0), 'lstm.bias_hh_l0': Array(192).fill(0),
    'output.weight': Array(39 * 48).fill(0), 'output.bias': Array(39).fill(0),
  } })
const file = (value: unknown, size = 100) => ({ size, text: async () => JSON.stringify(value) }) as File
const defer = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const frame = (timeMs: number, poor = false): Observation => {
  const landmarks = Array.from({ length: 13 }, (_, i) => ({
    x: i === 11 ? .3 : i === 12 ? .7 : .5, y: i < 11 ? .3 : .6, z: 0, visibility: poor ? .1 : .95,
  }))
  return { timeMs, videoTimeMs: timeMs, width: 640, height: 480, inferenceMs: 3, delegate: 'CPU', poseModelId: 'mediapipe-pose-full-f16-v1/tasks-vision-1.0.1',
    landmarks, worldLandmarks: landmarks.map(p => ({ ...p })), features: null }
}

describe('developer lifecycle with synthetic frames and fake camera only', () => {
  let renderer: ReactTestRenderer | undefined, session: DeveloperSession, camera: CameraController
  let listeners: Set<(frame: Observation) => void>
  let visibility: string, visibilityChanged: (() => void) | undefined
  let normalProfile: NormalPostureProfile | null = null
  let collectionSink: DeveloperCollectionSink
  function Probe() { session = useDeveloperSession(camera, normalProfile, collectionSink); return null }
  const rerender = () => act(() => { renderer!.update(<Probe />) })
  const emit = (observation: Observation) => act(() => { for (const listener of listeners) listener(observation) })
  const feed = (milliseconds: number) => {
    for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) {
      act(() => { vi.advanceTimersByTime(100) }); emit(frame(Date.now()))
    }
  }
  const openCamera = async () => {
    await act(async () => session.start())
    camera.state = 'on'; rerender()
  }
  beforeEach(async () => {
    resetPipelinePerformance()
    vi.clearAllMocks(); sound.arm.mockResolvedValue('ready'); sound.beep.mockReturnValue(true)
    normalProfile = null
    collectionSink = { observe: vi.fn(), markGap: vi.fn(), endRun: vi.fn() }
    vi.useFakeTimers(); vi.setSystemTime(0)
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
    listeners = new Set(); visibility = 'visible'; visibilityChanged = undefined
    vi.stubGlobal('document', {
      get visibilityState() { return visibility },
      addEventListener: vi.fn((name, callback) => { if (name === 'visibilitychange') visibilityChanged = callback }),
      removeEventListener: vi.fn(), createElement: vi.fn(() => ({ click: vi.fn() })),
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), text: async () => '<!doctype html><html></html>' }))
    camera = { state: 'off', error: '', connect: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(() => { camera.state = 'off'; camera.error = '' }), calibrate: vi.fn(),
      subscribe: vi.fn((listener: (frame: Observation) => void) => { listeners.add(listener); return () => listeners.delete(listener) }),
    } as unknown as CameraController
    await act(async () => { renderer = create(<Probe />) })
  })
  afterEach(() => {
    act(() => renderer?.unmount()); renderer = undefined
    vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  })

  it('enters without requesting camera permission and treats HTML fallback as a missing optional model', () => {
    expect(camera.connect).not.toHaveBeenCalled()
    expect(session).toMatchObject({ phase: 'idle', predictor: 'hold_last', model: null, modelStatus: 'missing', modelError: '' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(session.alertBasis).toBe('rule')
    expect(collectionSink.observe).not.toHaveBeenCalled()
  })

  it('measures delivered camera processing and engine work without collecting coordinate payloads', async () => {
    await openCamera(); feed(14000)
    const snapshot = readPipelinePerformance()
    expect(snapshot.cameraConsumer.count).toBe(140)
    expect(snapshot.captureToConsumer.count).toBe(140)
    expect(snapshot.engineStep.count).toBeGreaterThanOrEqual(100)
    expect(snapshot.publishScheduling.count).toBeGreaterThanOrEqual(140)
    expect(snapshot.cameraConsumer.totalMs).toBe(0) // The test clock does not advance inside callbacks.
    expect(JSON.stringify(snapshot)).not.toMatch(/landmarks|worldLandmarks|inputValues|baseline|runId/)
    act(() => { vi.advanceTimersByTime(125) }); emit(frame(Date.now() - 20))
    expect(readPipelinePerformance().captureToConsumer.maxMs).toBe(20)
    const count = readPipelinePerformance().cameraConsumer.count
    act(() => session.stop())
    emit(frame(Date.now()))
    expect(readPipelinePerformance().cameraConsumer.count).toBe(count)
  })

  it('routes real post-registration frames with matching readings and actual baseline to automatic collection', async () => {
    await openCamera(); feed(3000)
    expect(collectionSink.observe).not.toHaveBeenCalled()
    feed(11000)
    const matched = vi.mocked(collectionSink.observe).mock.calls.at(-1)![0]
    expect(matched.source).toBe('camera')
    expect(matched.runId).toMatch(/^lab-/)
    expect(matched.observationTimeMs).toBe(matched.reading.timeMs)
    expect(matched.reading.deviation).toBe(0)
    expect(matched.baseline).toEqual(liveForecastPoints(matched.frame.landmarks, matched.frame.worldLandmarks))
    expect(matched.frame.videoTimeMs).toBe(14000)
    const oldCalls = vi.mocked(collectionSink.observe).mock.calls.length
    act(() => { visibility = 'hidden'; visibilityChanged!() })
    emit(frame(Date.now()))
    expect(collectionSink.observe).toHaveBeenCalledTimes(oldCalls)
    expect(collectionSink.markGap).toHaveBeenCalledWith('관측이 끊겨 수집을 기다립니다.')
    act(() => session.stop())
    expect(collectionSink.endRun).toHaveBeenCalled()
    act(() => { visibility = 'visible'; session.startDemo(); vi.advanceTimersByTime(14000) })
    expect(collectionSink.observe).toHaveBeenCalledTimes(oldCalls)
  })

  it('exposes only a future forecast for display and removes it on quality loss, stop and expiry', async () => {
    await openCamera(); feed(14000)
    expect(session.forecast).toMatchObject({ predictor: 'hold_last', modelId: 'hold_last' })
    expect(session.forecast!.targetAtMs).toBeGreaterThan(session.reading!.timeMs)
    expect(session.forecast!.values).toHaveLength(39)
    act(() => { vi.advanceTimersByTime(100) }); emit(frame(Date.now(), true))
    expect(session.forecast).toBeNull()
    feed(4000)
    expect(session.forecast).not.toBeNull()
    act(() => { vi.advanceTimersByTime(310) })
    expect(session.forecast).toBeNull()
    feed(4000)
    act(() => session.stop())
    expect(session.forecast).toBeNull()
    expect(JSON.stringify(exportLabRecord(session.records[0]))).not.toMatch(/inputValues|targetAtMs|"forecast"/)
  })

  it('detects sustained whole-image retreat through the camera adapter with invariant world pose and muted delivery', async () => {
    await openCamera(); feed(14000)
    expect(session.soundEnabled).toBe(false)
    expect(session.reading?.imagePosture).toMatchObject({ status: 'ready', score: 0 })
    for (let i = 0; i < 50; i++) {
      act(() => { vi.advanceTimersByTime(100) })
      const observation = frame(performance.now())
      observation.landmarks = observation.landmarks.map(p => ({ ...p, x: .5 + (p.x - .5) * .6, y: .5 + (p.y - .5) * .6 }))
      emit(observation)
    }
    expect(session.reading).toMatchObject({ deviation: 0, ruleState: 'persistent_deviation_candidate' })
    expect(session.reading?.postureScore).toBeGreaterThan(1)
    expect(session.alertCount).toBe(1)
    expect(sound.arm).not.toHaveBeenCalled(); expect(sound.beep).not.toHaveBeenCalled()
    expect(session.alerts[0].postureScore).toBeGreaterThan(1)
    act(() => session.stop())
    expect(exportLabRecord(session.records[0]).readings.at(-1)?.imagePosture?.policy).toBe('image-posture-anchor-v2')
  })

  it.each([5, 11, 30])('forwards raw camera observations at %s FPS and delivers sustained departure without throttling alias', async fps => {
    await openCamera()
    feed(14000)
    for (let i = 0; i < fps * 4; i++) {
      act(() => { vi.advanceTimersByTime(1000 / fps) })
      const shifted = frame(performance.now())
      shifted.worldLandmarks = shifted.worldLandmarks.map((p, index) => index < 11 ? { ...p, x: p.x + .12 } : p)
      emit(shifted)
    }
    expect(session.reading).toMatchObject({ evaluationMode: 'observed-v2', ruleState: 'persistent_deviation_candidate' })
    expect(session.alertCount).toBe(1)
    expect(session.reading!.durationMs).toBeGreaterThanOrEqual(3000)
  })

  it('recovers predictions through periodic short camera stalls without counting the stalls as valid posture', async () => {
    await act(async () => session.loadModel(file(weights())))
    await openCamera(); feed(14100)
    let recovered = 0
    for (let cycle = 0; cycle < 4; cycle++) {
      // This arrival crosses the 250ms watchdog before the real endpoint arrives.
      act(() => { vi.advanceTimersByTime(450) })
      expect(session.forecast).toBeNull()
      expect(session.reading!.ruleState).toBe('unmeasurable')
      expect(session.predictionStatus!.collectedSteps).toBe(30)
      emit(frame(Date.now()))
      expect(session.reading!.ruleState).toBe('unmeasurable')
      feed(300)
      expect(session.forecast?.predictor).toBe('lstm')
      expect(session.predictionStatus!.collectedSteps).toBe(30)
      recovered++
      feed(1000)
    }
    expect(recovered).toBe(4)
    expect(session.summary.unavailableMs).toBeGreaterThanOrEqual(4 * 450)
    expect(session.alertCount).toBe(0)
    // A real invalid-coordinate frame still discards the predictor input.
    act(() => { vi.advanceTimersByTime(100) }); emit(frame(Date.now(), true))
    expect(session.predictionStatus).toMatchObject({ collectedSteps: 0, lastResetReason: 'quality' })
    expect(session.forecast).toBeNull()
    feed(4000)
    expect(session.forecast).not.toBeNull()
    act(() => { vi.advanceTimersByTime(800) })
    expect(session.predictionStatus).toMatchObject({ collectedSteps: 0, lastResetReason: 'gap' })
  })

  it('keeps capture timestamps on the run clock instead of shifting them by first-inference latency', async () => {
    await openCamera()
    act(() => { vi.advanceTimersByTime(200) }); emit(frame(100))
    feed(14000)
    expect(session.reading!.timeMs).toBe(Date.now())
    expect(session.forecast!.inputAtMs).toBeLessThanOrEqual(Date.now())
    expect(session.forecast!.targetAtMs).toBeLessThanOrEqual(Date.now() + 300)
    const captured = Date.now() + 100
    act(() => { vi.advanceTimersByTime(450) }); emit(frame(captured))
    // A result delivered after its target is never presented as future movement.
    expect(session.forecast).toBeNull()
  })

  it('accepts a later source frame captured before a soft watchdog notification without a false time reset', async () => {
    await openCamera(); feed(14100)
    const resets = session.predictionStatus!.resetCount
    act(() => { vi.advanceTimersByTime(450) })
    expect(session.reading!.timeMs).toBe(14500)
    expect(session.reading!.ruleState).toBe('unmeasurable')
    emit(frame(14400))
    expect(session.predictionStatus!.resetCount).toBe(resets)
    expect(session.predictionStatus!.collectedSteps).toBe(30)
    // Do not rewrite the already-published unavailable interval with a late result.
    expect(session.reading!.timeMs).toBe(14500)
    feed(300)
    expect(session.forecast).not.toBeNull()
    expect(session.readings.every((r, i, all) => i === 0 || r.timeMs > all[i - 1].timeMs)).toBe(true)
  })

  it('snapshots the normal profile at camera start and never applies it to the synthetic demo', async () => {
    const base = frame(0)
    const normalized = liveForecastPoints(base.landmarks, base.worldLandmarks)!
    normalProfile = fitNormalPostureProfile(Array.from({ length: 301 }, (_, i) => ({ timeMs: i * 100, values: normalized })), {
      poseModelId: 'mediapipe-pose-full-f16-v1/tasks-vision-1.0.1',
      id: 'synthetic-original', participantCode: 'synthetic-person', sessionCode: 'synthetic-session', purpose: 'personal_calibration',
      createdAt: '2026-10-14T00:00:00.000Z',
    })
    rerender(); await openCamera()
    normalProfile = { ...normalProfile, id: 'synthetic-replacement', provenance: { ...normalProfile.provenance, id: 'synthetic-replacement' } }
    rerender(); feed(14000)
    expect(session.reading).toMatchObject({ normalProfileId: 'synthetic-original', normalScore: 0 })
    act(() => session.stop())
    expect(session.records[0].normalProfileId).toBe('synthetic-original')
    act(() => session.startDemo()); act(() => { vi.advanceTimersByTime(14000) })
    expect(session.reading).not.toHaveProperty('normalProfileId')
  })

  it('waits outside the confirmed normal range, then automatically registers after returning', async () => {
    const base = frame(0), normalized = liveForecastPoints(base.landmarks, base.worldLandmarks)!
    normalProfile = fitNormalPostureProfile(Array.from({ length: 301 }, (_, i) => ({ timeMs: i * 100, values: normalized })), {
      id: 'synthetic-normal', participantCode: 'synthetic-person', sessionCode: 'synthetic-session', purpose: 'personal_calibration',
      poseModelId: base.poseModelId, createdAt: '2026-10-14T00:00:00.000Z',
    })
    rerender(); await openCamera()
    for (let i = 0; i < 140; i++) {
      act(() => { vi.advanceTimersByTime(100) })
      const shifted = frame(Date.now())
      shifted.worldLandmarks = shifted.worldLandmarks.map((point, index) => index < 11 ? { ...point, x: point.x + .2 } : point)
      emit(shifted)
    }
    expect(session.phase).toBe('guiding')
    expect(session.guidance.instruction).toContain('정상 자세와 달라')
    expect(session.referenceValidation?.status).toBe('rejected')
    expect(session.guidance.reference).toBeNull()
    expect(session.alertCount).toBe(0)
    expect(collectionSink.observe).not.toHaveBeenCalled()
    feed(10000)
    expect(session.phase).toBe('measuring')
    expect(session.referenceValidation).toMatchObject({ status: 'accepted', score: 0 })
    act(() => session.stop())
    const exported = exportLabRecord(session.records[0])
    expect(exported.reference_validation).toMatchObject({ status: 'accepted' })
    expect(exported.camera_metadata).toMatchObject({ pose_model_id: base.poseModelId, delegate: 'CPU', width: 640, height: 480 })
    expect(exported.reference_validation).not.toHaveProperty('strongestFeature')
  })

  it('distinguishes 13 visible points from unusable world input', async () => {
    await openCamera(); feed(14000)
    act(() => { vi.advanceTimersByTime(100) })
    const badWorld = frame(Date.now()); badWorld.worldLandmarks[0].z = NaN
    emit(badWorld)
    expect(session.visiblePoints).toBe(13)
    expect(session.observationUsable).toBe(false)
    expect(session.reading?.ruleState).toBe('unmeasurable')
  })

  it('loads MediaPipe pilot weights, uses matching frames and stops a mismatched extractor', async () => {
    const old = weights()
    const v2 = { ...old, schema_version: 'forecast-weights-v2', data_domain: 'mediapipe',
      pose_model_id: frame(0).poseModelId, feature_definition: 'mediapipe-world13-shoulder-normalized-xyz-v1',
      config: { ...old.config, point_definition: 'MediaPipe-13-world-shoulder-normalized-v1' },
      training: { mode: 'pilot', evaluation_scope: 'training_fit_only', participant_generalization_evaluated: false,
        labels_used: { manual_confirmed_windows: 1, automatic_weak_windows: 0 },
        split_window_counts: { train: 1, validation: 0, test: 0 }, split_participant_counts: { train: 1, validation: 0, test: 0 } } }
    await act(async () => session.loadModel(file(v2)))
    expect(session.model?.schema_version).toBe('forecast-weights-v2')
    await openCamera(); feed(14000)
    expect(session.phase).toBe('measuring')
    expect(session.forecast?.predictor).toBe('lstm')
    act(() => session.stop())
    expect(exportLabRecord(session.records[0])).toMatchObject({ forecast_schema: 'forecast-weights-v2', approximate_point_mapping: false })
    await openCamera()
    act(() => { vi.advanceTimersByTime(100) })
    emit({ ...frame(Date.now()), poseModelId: 'mediapipe-pose-heavy-f16-v1/tasks-vision-1.0.1' })
    expect(session.phase).toBe('error')
    expect(session.error).toContain('MediaPipe 모델과 현재 카메라가 다릅니다')
    expect(listeners.size).toBe(0)
    expect(session.forecast).toBeNull()
    act(() => session.startDemo())
    expect(session.phase).toBe('error')
    expect(session.error).toContain('실제 카메라')
  })

  it('selects a discovered valid local LSTM by default and records its model plus rule readings', async () => {
    act(() => renderer!.unmount())
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, headers: new Headers(), text: async () => JSON.stringify(weights()) } as Response)
    await act(async () => { renderer = create(<Probe />) })
    expect(session).toMatchObject({ modelStatus: 'ready', predictor: 'lstm' })
    expect(camera.connect).not.toHaveBeenCalled()
    act(() => session.startDemo()); act(() => { vi.advanceTimersByTime(14000) })
    expect(session.phase).toBe('measuring')
    expect(session.reading).toMatchObject({ modelId: 'explicit-synthetic-test', domainValidated: false })
    expect(session.reading?.ruleState).toBeDefined()
    act(() => session.stop())
    expect(session.records[0]).toMatchObject({ predictor: 'lstm', modelSha256: 'a'.repeat(64) })
  })

  it('keeps an explicit basic predictor choice when local model discovery finishes later', async () => {
    act(() => renderer!.unmount())
    const pending = defer<Response>()
    vi.mocked(fetch).mockReturnValueOnce(pending.promise)
    await act(async () => { renderer = create(<Probe />) })
    act(() => session.setPredictor('hold_last'))
    await act(async () => { pending.resolve({ ok: true, headers: new Headers(), text: async () => JSON.stringify(weights()) } as Response) })
    expect(session).toMatchObject({ modelStatus: 'ready', predictor: 'hold_last' })
    act(() => session.startDemo()); act(() => { vi.advanceTimersByTime(14000) })
    expect(session.reading?.modelId).toBe('hold_last')
  })

  it('keeps a running experiment fixed when a model is discovered and uses it only for the next automatic selection', async () => {
    act(() => renderer!.unmount())
    const pending = defer<Response>()
    vi.mocked(fetch).mockReturnValueOnce(pending.promise)
    await act(async () => { renderer = create(<Probe />) })
    act(() => session.startDemo())
    await act(async () => { pending.resolve({ ok: true, headers: new Headers(), text: async () => JSON.stringify(weights()) } as Response) })
    expect(session.predictor).toBe('hold_last')
    act(() => { vi.advanceTimersByTime(14000) })
    expect(session.reading?.modelId).toBe('hold_last')
    act(() => session.stop()); act(() => session.startDemo())
    expect(session.predictor).toBe('lstm')
    act(() => { vi.advanceTimersByTime(14000) })
    expect(session.reading?.modelId).toBe('explicit-synthetic-test')
  })

  it('does not relabel a finished basic run as LSTM when discovery completes after stopping', async () => {
    act(() => renderer!.unmount())
    const pending = defer<Response>()
    vi.mocked(fetch).mockReturnValueOnce(pending.promise)
    await act(async () => { renderer = create(<Probe />) })
    act(() => session.startDemo()); act(() => { vi.advanceTimersByTime(14000) }); act(() => session.stop())
    await act(async () => { pending.resolve({ ok: true, headers: new Headers(), text: async () => JSON.stringify(weights()) } as Response) })
    expect(session).toMatchObject({ phase: 'finished', predictor: 'hold_last', modelStatus: 'ready' })
    expect(session.reading?.modelId).toBe('hold_last')
    expect(session.records[0]).toMatchObject({ predictor: 'hold_last', modelSha256: null })
    act(() => session.startDemo())
    expect(session).toMatchObject({ predictor: 'lstm', reading: null, readings: [] })
  })

  it('one click guides and aligns before eight-second registration, then measures without LSTM weights', async () => {
    await openCamera()
    expect(session.phase).toBe('guiding')
    feed(3500)
    expect(session.guidance.step).toBe('intro')
    expect(session.readings).toHaveLength(0)
    feed(1600)
    expect(session.phase).toBe('registering')
    expect(session.guidance.step).toBe('reference')
    feed(8900)
    expect(session.phase).toBe('measuring')
    expect(session.visiblePoints).toBe(13)
    expect(session.reading?.state).toBe('near_reference')
    expect(session.summary.validMs).toBeGreaterThan(0)
    expect(session.summary.nearPercent).toBe(100)
    expect(session.guidance.reference?.points).toHaveLength(13)
    expect(session.guidance.lateralPercent).toBeCloseTo(0)
    expect(camera.calibrate).not.toHaveBeenCalled()
    act(() => session.stop())
    expect(session.phase).toBe('finished')
    expect(session.guidance.live).toBeNull()
    expect(session.guidance.reference).toBeNull()
    expect(listeners.size).toBe(0)
    expect(session.records[0]).toMatchObject({ source: 'camera', predictor: 'hold_last', modelId: 'hold_last', modelSha256: null })
  })

  it('retains a camera error even when stopping clears the camera hook error', async () => {
    await act(async () => session.start())
    camera.state = 'error'; camera.error = '카메라 권한이 거부되었습니다.'; rerender()
    expect(session.phase).toBe('error')
    expect(session.error).toBe('카메라 권한이 거부되었습니다.')
    expect(camera.error).toBe('')
    expect(session.records).toHaveLength(0)
  })

  it('cancels permission preparation and releases late completion without starting a run', async () => {
    const pending = defer<void>(); vi.mocked(camera.connect).mockReturnValueOnce(pending.promise)
    act(() => session.start()); act(() => session.stop())
    const stopped = vi.mocked(camera.stop).mock.calls.length
    await act(async () => { pending.resolve() })
    expect(camera.stop).toHaveBeenCalledTimes(stopped + 1)
    expect(session.phase).toBe('finished')
    expect(camera.subscribe).not.toHaveBeenCalled()
  })

  it('does not let an older connection completion stop a newer active run', async () => {
    const pending = defer<void>(); vi.mocked(camera.connect).mockReturnValueOnce(pending.promise)
    act(() => session.start()); act(() => session.startDemo())
    const stopped = vi.mocked(camera.stop).mock.calls.length
    await act(async () => { pending.resolve() })
    expect(camera.stop).toHaveBeenCalledTimes(stopped)
    act(() => { vi.advanceTimersByTime(14000) })
    expect(session.phase).toBe('measuring')
    expect(session.source).toBe('synthetic')
  })

  it('breaks continuity for stale frames, hidden pages and missing frames without inventing valid time', async () => {
    await openCamera(); feed(14000)
    const valid = session.summary.validMs
    emit(frame(Date.now() - 500))
    expect(session.reading?.state).toBe('unmeasurable')
    expect(session.guidance.live).toBeNull()
    expect(session.guidance.lateralPercent).toBeNull()
    expect(session.guidance.reference).not.toBeNull()
    act(() => { visibility = 'hidden'; visibilityChanged?.(); vi.advanceTimersByTime(2000) })
    expect(session.summary.validMs).toBe(valid)
    expect(session.summary.unavailableMs).toBeGreaterThanOrEqual(1750)
    act(() => { visibility = 'visible'; visibilityChanged?.() })
    feed(200)
    expect(session.phase).toBe('measuring')
    expect(session.reading?.state).toBe('warming')
    expect(session.summary.validMs).toBe(valid + 100) // Two fresh valid observations form one measured rule interval.
  })

  it('stops camera processing and timers on unmount', async () => {
    await openCamera(); feed(1000)
    act(() => renderer!.unmount()); renderer = undefined
    expect(listeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(camera.stop).toHaveBeenCalled()
  })

  it('runs the same guide then a clearly synthetic forty-second scenario without requesting a camera', () => {
    act(() => session.startDemo()); act(() => { vi.advanceTimersByTime(46000) })
    expect(camera.connect).not.toHaveBeenCalled()
    expect(session).toMatchObject({ phase: 'finished', source: 'synthetic', visiblePoints: 0 })
    expect(session.records[0].source).toBe('synthetic')
    expect(session.summary.deviations).toBe(1)
    expect(session.summary.unavailableMs).toBeGreaterThan(0)
    expect(session.events.some(e => e.label.includes('실제 측정 아님'))).toBe(true)
  })

  it('freezes configuration during a run and clears displayed results when changing it afterwards', () => {
    act(() => session.startDemo()); act(() => session.setPredictor('constant_velocity'))
    expect(session.predictor).toBe('hold_last')
    act(() => { vi.advanceTimersByTime(9000) }); act(() => session.stop())
    expect(session.readings.length).toBeGreaterThan(0)
    act(() => session.setPredictor('constant_velocity'))
    expect(session).toMatchObject({ phase: 'idle', predictor: 'constant_velocity', reading: null, readings: [], events: [] })
    expect(session.summary.validMs).toBe(0)
    expect(session.records).toHaveLength(1)
    expect(session.records[0].predictor).toBe('hold_last')
  })

  it('validates local model files, retains exact provenance, and rejects oversized or malformed files', async () => {
    await act(async () => session.loadModel(file({}, 1000001)))
    expect(session.modelStatus).toBe('invalid'); expect(session.model).toBeNull()
    await act(async () => session.loadModel(file({ schema_version: 'bad' })))
    expect(session.modelStatus).toBe('invalid')
    await act(async () => session.loadModel(file(weights())))
    expect(session.modelStatus).toBe('ready')
    act(() => session.setPredictor('lstm')); act(() => session.startDemo())
    act(() => { vi.advanceTimersByTime(5300) }); act(() => session.stop())
    expect(session.records[0]).toMatchObject({ source: 'synthetic', predictor: 'lstm', modelId: 'explicit-synthetic-test', modelSha256: 'a'.repeat(64) })
  })

  it('does not leave model loading pending when a run starts during an upload', async () => {
    const pending = defer<string>()
    let loading!: Promise<void>
    act(() => { loading = session.loadModel({ size: 100, text: () => pending.promise } as File) })
    expect(session.modelStatus).toBe('loading')
    act(() => session.startDemo())
    await act(async () => { pending.resolve(JSON.stringify(weights())); await loading })
    expect(session.modelStatus).toBe('missing')
    expect(session.model).toBeNull()
    expect(session.phase).toBe('guiding')
  })

  it('bounds in-memory records at eight runs', () => {
    for (let i = 0; i < 10; i++) {
      act(() => session.startDemo()); act(() => { vi.advanceTimersByTime(5300) }); act(() => session.stop())
    }
    expect(session.records).toHaveLength(8)
    expect(new Set(session.records.map(r => r.id)).size).toBe(8)
  })

  it('waits for genuine in-frame observations rather than starting baseline after a timer', async () => {
    await openCamera()
    for (let i = 0; i < 70; i++) {
      act(() => { vi.advanceTimersByTime(100) })
      const far = frame(Date.now())
      far.landmarks = far.landmarks.map(p => ({ ...p, x: .5 + (p.x - .5) * .3 }))
      emit(far)
    }
    expect(session.phase).toBe('guiding')
    expect(session.guidance).toMatchObject({ step: 'framing', cue: 'far', ready: false })
    expect(session.readings).toHaveLength(0)
    expect(session.summary.validMs).toBe(0)
    act(() => session.stop())
    expect(session.records).toHaveLength(0)
  })

  it('keeps reference registration through ordinary screen drift instead of realigning', async () => {
    await openCamera(); feed(6000)
    expect(session.phase).toBe('registering')
    const before = session.reading?.progress ?? 0
    for (let i = 0; i < 80; i++) {
      act(() => { vi.advanceTimersByTime(100) })
      const moved = frame(Date.now())
      moved.landmarks = moved.landmarks.map(p => ({ ...p, x: p.x + .1 }))
      emit(moved)
    }
    expect(session.phase).toBe('measuring')
    expect(session.guidance.reference?.points[0].x).toBeGreaterThan(.5)
    expect(session.events.some(event => event.label.includes('구도부터 다시'))).toBe(false)
    expect(before).toBeGreaterThan(0)
  })

  it('automatically registers natural image sway and isolated tracker jitter without demanding motionless landmarks', async () => {
    await openCamera()
    for (let i = 0; i < 140; i++) {
      act(() => { vi.advanceTimersByTime(100) })
      const observation = frame(Date.now())
      observation.landmarks = observation.landmarks.map((p, point) => ({ ...p,
        x: p.x + .025 * Math.sin(i / 4) + (point === 3 ? .07 * Math.sin(i) : 0),
      }))
      emit(observation)
    }
    expect(session.phase).toBe('measuring')
    expect(session.guidance.reference?.points).toHaveLength(13)
    expect(session.events.filter(event => event.label.includes('구도가 바뀌어'))).toHaveLength(0)
  })

  it('allows intended screen-position changes during measurement and keeps guide frames out of records/exports', async () => {
    await openCamera(); feed(14000)
    act(() => { vi.advanceTimersByTime(100) })
    const moved = frame(Date.now())
    moved.landmarks = moved.landmarks.map(p => ({ ...p, x: p.x + .18 }))
    emit(moved)
    expect(session.phase).toBe('measuring')
    expect(session.guidance.step).toBe('tracking')
    expect(session.guidance.lateralPercent).toBeCloseTo(18)
    const guidance = session.guidance
    act(() => session.stop())
    expect(session.records[0]).not.toHaveProperty('guidance')
    const extraRecord = { ...session.records[0], guidance, live: guidance.live, reference: guidance.reference }
    const payload = exportLabRecord(extraRecord)
    expect(payload).toHaveProperty('guidance_settings')
    expect(payload).not.toHaveProperty('guidance')
    expect(payload).not.toHaveProperty('live')
    expect(payload).not.toHaveProperty('reference')
    expect(JSON.stringify(payload)).not.toContain('"points"')
  })

  it('breaks registration on hidden state and resets transient display on camera disconnect', async () => {
    await openCamera(); feed(6000)
    act(() => { visibility = 'hidden'; visibilityChanged?.() })
    expect(session.phase).toBe('registering')
    act(() => { vi.advanceTimersByTime(800) })
    expect(session.phase).toBe('guiding')
    expect(session.guidance.live).toBeNull()
    expect(session.guidance.reference).toBeNull()
    act(() => { visibility = 'visible'; visibilityChanged?.() })
    feed(1700)
    expect(session.phase).toBe('registering')
    camera.state = 'error'; camera.error = '카메라 연결 끊김'; rerender()
    expect(session.error).toBe('카메라 연결 끊김')
    expect(session.guidance.live).toBeNull()
    expect(session.guidance.reference).toBeNull()
    expect(listeners.size).toBe(0)
  })

  it('preserves reference progress across a 200ms observation delay', async () => {
    await openCamera(); feed(6000)
    const before = session.reading?.progress ?? 0
    act(() => { vi.advanceTimersByTime(200) }); emit(frame(Date.now()))
    expect(session.phase).toBe('registering')
    expect(session.guidance.step).toBe('reference')
    expect(session.reading?.state).toBe('registering')
    expect(session.reading?.progress).toBeGreaterThanOrEqual(before)
    feed(7500)
    expect(session.phase).toBe('measuring')
  })

  it('resumes a background-throttled synthetic run with monotonic timestamps and its remaining scenario intact', () => {
    act(() => session.startDemo()); act(() => { vi.advanceTimersByTime(15000) })
    expect(session.phase).toBe('measuring')
    const validBefore = session.summary.validMs
    act(() => { visibility = 'hidden'; visibilityChanged?.() })
    // Simulate a suspended tab: the monotonic clock advances without delivering
    // the interval callbacks that previously drove the separate logical clock.
    act(() => { vi.setSystemTime(Date.now() + 60000) })
    act(() => { visibility = 'visible'; visibilityChanged?.() })
    expect(() => act(() => { vi.advanceTimersByTime(300) })).not.toThrow()
    expect(session.phase).toBe('measuring')
    expect(session.reading?.state).toBe('warming')
    expect(session.summary.validMs).toBe(validBefore + 100) // Predictor warmup no longer hides resumed rule observations.
    expect(session.summary.unavailableMs).toBeGreaterThanOrEqual(60000)
    act(() => { vi.advanceTimersByTime(31000) })
    expect(session.phase).toBe('finished')
    expect(session.summary.deviations).toBe(1)
    expect(session.readings.some(r => r.returnedExcursions === 1)).toBe(true)
    expect(session.readings.every((r, i, all) => i === 0 || r.timeMs > all[i - 1].timeMs)).toBe(true)
    expect(session.error).toBe('')
    expect(camera.connect).not.toHaveBeenCalled()
  })

  it('realigns synthetic registration after a delayed foreground callback and completes a fresh baseline', () => {
    act(() => session.startDemo()); act(() => { vi.advanceTimersByTime(6000) })
    expect(session.phase).toBe('registering')
    act(() => { vi.setSystemTime(Date.now() + 5000) })
    expect(() => act(() => { vi.advanceTimersByTime(100) })).not.toThrow()
    expect(session.phase).toBe('guiding')
    expect(session.guidance.reference).toBeNull()
    expect(session.reading).toBeNull()
    act(() => { vi.advanceTimersByTime(1700) })
    expect(session.phase).toBe('registering')
    act(() => { vi.advanceTimersByTime(8100) })
    expect(session.phase).toBe('measuring')
    expect(session.guidance.reference?.points).toHaveLength(13)
    expect(session.readings.every((r, i, all) => i === 0 || r.timeMs > all[i - 1].timeMs)).toBe(true)
  })
  it('creates and exports one real core synthetic alert, locks its basis, and keeps muted visual feedback', async () => {
    act(() => session.setAlertBasis('rule'))
    expect(session.soundEnabled).toBe(false)
    await act(async () => session.startDemo())
    act(() => session.setAlertBasis('predictor'))
    expect(session.alertBasis).toBe('rule')
    act(() => { vi.advanceTimersByTime(46000) })
    expect(session.phase).toBe('finished')
    expect(session.alertCount).toBe(1)
    expect(session.alerts[0]).toMatchObject({ source: 'synthetic', basis: 'rule', kind: 'first' })
    expect(session.alerts[0].deviation).toBeGreaterThanOrEqual(.12)
    expect(session.alerts[0].durationMs).toBeGreaterThanOrEqual(3000)
    expect(sound.arm).not.toHaveBeenCalled(); expect(sound.beep).not.toHaveBeenCalled()
    expect(session.events.some(e => e.label.includes('합성 시연 · 이탈 알림'))).toBe(true)
    expect(exportLabRecord(session.records[0])).toMatchObject({ alert_count: 1, alert_settings: { basis: 'rule', reminder_ms: 60000 }, alerts: session.alerts })
    act(() => session.setAlertBasis('predictor'))
    expect(session.alertCount).toBe(0); expect(session.records[0].alerts).toHaveLength(1)
  })

  it('prepares audio only on gesture, plays on a core alert, and never counts a sound test', async () => {
    expect(sound.arm).not.toHaveBeenCalled()
    await act(async () => session.setSoundEnabled(true))
    await act(async () => session.testAlertSound())
    expect(sound.beep).toHaveBeenCalledTimes(1); expect(session.alertCount).toBe(0)
    await act(async () => session.startDemo())
    act(() => { vi.advanceTimersByTime(31000) })
    expect(session.alertCount).toBe(1); expect(sound.beep).toHaveBeenCalledTimes(2)
    act(() => session.stop())
    expect(sound.cancel).toHaveBeenCalled()
    expect(session.audioStatus).toBe('inactive')
    act(() => renderer!.unmount()); renderer = undefined
    expect(sound.dispose).toHaveBeenCalledTimes(1)
  })

  it('keeps visual alerts when playback is blocked and cancels sound on hiding without auto-resume', async () => {
    await act(async () => session.setSoundEnabled(true))
    sound.beep.mockReturnValue(false)
    await act(async () => session.startDemo())
    act(() => { vi.advanceTimersByTime(31000) })
    expect(session.alertCount).toBe(1); expect(session.audioStatus).toBe('blocked')
    const armCount = sound.arm.mock.calls.length
    act(() => { visibility = 'hidden'; visibilityChanged!() })
    expect(session.audioStatus).toBe('inactive'); expect(sound.cancel).toHaveBeenCalled()
    act(() => { visibility = 'visible'; visibilityChanged!() })
    expect(sound.arm).toHaveBeenCalledTimes(armCount)
    expect(session.reading?.state).toBe('unmeasurable')
  })

  it('ignores late audio preparation after mute or stop and lets an explicit unmute rearm', async () => {
    await act(async () => session.setSoundEnabled(true))
    const pending = defer<string>()
    sound.arm.mockReturnValueOnce(pending.promise)
    act(() => session.startDemo())
    act(() => session.setSoundEnabled(false))
    await act(async () => pending.resolve('ready'))
    expect(session).toMatchObject({ soundEnabled: false, audioStatus: 'inactive', alertCount: 0 })
    await act(async () => session.setSoundEnabled(true))
    expect(session.audioStatus).toBe('ready')
    const pendingStop = defer<string>()
    sound.arm.mockReturnValueOnce(pendingStop.promise)
    act(() => session.testAlertSound()); act(() => session.stop())
    await act(async () => pendingStop.resolve('ready'))
    expect(session.audioStatus).toBe('inactive'); expect(sound.beep).not.toHaveBeenCalled()
  })

  it('keeps audio unsupported distinct from autoplay blocking after a visual notification', async () => {
    await act(async () => session.setSoundEnabled(true))
    sound.arm.mockResolvedValue('unsupported'); sound.beep.mockReturnValue(false)
    await act(async () => session.startDemo())
    act(() => { vi.advanceTimersByTime(31000) })
    expect(session.alertCount).toBe(1); expect(session.audioStatus).toBe('unsupported')
  })

})
