import { useCallback, useEffect, useRef, useState } from 'react'
import { FORECAST_OBSERVATION_MAX_GAP_MS, LiveForecastExperiment, liveForecastPoints, readForecastWeights, forecastModelMatchesPoseModel,
  type ForecastDisplay, type ForecastPredictionStatus, type ForecastReading, type ForecastWeights } from '../../../../model/prototype/forecast'
import { DeveloperGuide, GUIDANCE_SETTINGS, emptyGuidance, guideFrame, syntheticGuideFrame,
  type GuideFrame } from '../../../../model/prototype/developerGuidance'
import type { NormalPostureProfile } from '../../../../model/prototype/normalPosture'
import { validateNormalReference, type NormalReferenceValidation } from '../../../../model/prototype/referenceValidation'
import type { CameraController } from '../../hooks/useCamera'
import { LAB_LIMITS, LabAccumulator, emptySummary, exportLabRecord, syntheticForecastValues } from './session'
import { ALERT_SETTINGS, DeveloperAlertTracker } from './alerts'
import { DeveloperAlertAudio } from './alertAudio'
import type { DeveloperSession, LabAlertBasis, LabAudioStatus, LabPhase, LabPredictor, LabRecord, LabSource } from './types'
import type { AutoNormalObservation } from './autoNormalCollection'
import { measurePipeline, recordPipelineDuration } from './pipelinePerformance'
import { readTrackingDiagnostics } from '../mediapipe/trackingDiagnostics'

export interface DeveloperCollectionSink {
  observe: (observation: AutoNormalObservation) => void
  markGap: (reason?: string) => void
  endRun: () => void
}

const MODEL_LIMIT = 1_000_000
const DEMO_DURATION = 40_000
interface Run {
  id: string
  startedAt: string
  started: number
  source: LabSource
  predictor: LabPredictor
  model: ForecastWeights | null
  normalProfile: NormalPostureProfile | null
  engine: LiveForecastExperiment | null
  guide: DeveloperGuide | null
  registrationAt: number | null
  lastGuidedAt: number
  accumulator: LabAccumulator
  alertTracker: DeveloperAlertTracker
  timer?: ReturnType<typeof setInterval>
  unsubscribe?: () => void
  lastRawFrame: number | null
  lastTime: number | null
  lastFrameAt: number
  poseModelId?: string
  cameraMetadata?: LabRecord['cameraMetadata']
  referenceCandidates: { time: number; values: number[] }[]
}
function referenceMessage(check: NormalReferenceValidation) {
  const group = check.strongestFeature && { face: '얼굴', ears: '귀', shoulders: '어깨' }[check.strongestFeature.group]
  return check.status === 'rejected' ? {
    instruction: '수집한 정상 자세와 달라 등록을 기다리고 있어요',
    detail: `${group ?? '관측 좌표'} 변화가 정상 허용 폭의 ${check.score?.toFixed(2)}배입니다. 수집 때의 자세로 돌아오면 자동으로 다시 등록합니다.`,
  } : {
    instruction: '정상 자료와 카메라 추출 모델을 확인해 주세요',
    detail: '같은 MediaPipe 모델로 수집한 개인 정상 자료가 필요합니다. 측정을 종료하고 수집 또는 카메라 설정을 확인해 주세요.',
  }
}
const parseModel = (text: string) => {
  if (new TextEncoder().encode(text).length > MODEL_LIMIT) throw new Error('모델 JSON은 1MB 이하로 준비해 주세요.')
  if (text.trimStart().startsWith('<')) throw new Error('모델 JSON 파일을 찾지 못했습니다.')
  return readForecastWeights(JSON.parse(text))
}
const idle = (phase: LabPhase) => !['connecting', 'guiding', 'registering', 'measuring'].includes(phase)

export function useDeveloperSession(camera: CameraController, normalProfile: NormalPostureProfile | null = null,
  collectionSink?: DeveloperCollectionSink): DeveloperSession {
  const [phase, setPhase] = useState<LabPhase>('idle')
  const phaseRef = useRef<LabPhase>('idle')
  const [source, setSource] = useState<LabSource>('camera')
  const [predictor, updatePredictor] = useState<LabPredictor>('hold_last')
  const predictorRef = useRef<LabPredictor>('hold_last')
  const predictorChosen = useRef(false)
  const [model, setModel] = useState<ForecastWeights | null>(null)
  const modelRef = useRef<ForecastWeights | null>(null)
  const [modelStatus, setModelStatus] = useState<DeveloperSession['modelStatus']>('loading')
  const [modelError, setModelError] = useState('')
  const [error, setError] = useState('')
  const [reading, setReading] = useState<ForecastReading | null>(null)
  const [forecast, setForecast] = useState<ForecastDisplay | null>(null)
  const [predictionStatus, setPredictionStatus] = useState<ForecastPredictionStatus | null>(null)
  const [referenceValidation, setReferenceValidation] = useState<NormalReferenceValidation | null>(null)
  const forecastExpiry = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [readings, setReadings] = useState<ForecastReading[]>([])
  const [events, setEvents] = useState<DeveloperSession['events']>([])
  const [summary, setSummary] = useState(emptySummary)
  const [records, setRecords] = useState<LabRecord[]>([])
  const [visiblePoints, setVisiblePoints] = useState(0)
  const [observationUsable, setObservationUsable] = useState<boolean | null>(null)
  const [guidance, setGuidance] = useState(emptyGuidance)
  const [alerts, setAlerts] = useState<DeveloperSession['alerts']>([])
  const [alertCount, setAlertCount] = useState(0)
  const [alertPeakDeviation, setAlertPeakDeviation] = useState<number | null>(null)
  const [alertBasis, updateAlertBasis] = useState<LabAlertBasis>('rule')
  const alertBasisRef = useRef<LabAlertBasis>('rule')
  const [soundEnabled, updateSoundEnabled] = useState(false)
  const soundRef = useRef(false)
  const [audioStatus, setAudioStatus] = useState<LabAudioStatus>('inactive')
  const audio = useRef<DeveloperAlertAudio | null>(null)
  const audioGeneration = useRef(0)
  const latestCamera = useRef(camera)
  latestCamera.current = camera
  const latestNormalProfile = useRef(normalProfile)
  latestNormalProfile.current = normalProfile
  const latestCollection = useRef(collectionSink)
  latestCollection.current = collectionSink
  const active = useRef<Run | null>(null)
  const generation = useRef(0)
  const loadGeneration = useRef(0)
  const mounted = useRef(true)
  const lastRecord = useRef<LabRecord | null>(null)

  const changePhase = useCallback((next: LabPhase) => { phaseRef.current = next; setPhase(next) }, [])
  const clearForecast = useCallback(() => {
    if (forecastExpiry.current !== null) clearTimeout(forecastExpiry.current)
    forecastExpiry.current = null
    setForecast(null)
  }, [])
  const clearDisplayedRun = useCallback(() => {
    lastRecord.current = null
    clearForecast()
    setPredictionStatus(null)
    setReferenceValidation(null)
    setObservationUsable(null)
    setReading(null); setReadings([]); setEvents([]); setSummary(emptySummary()); setVisiblePoints(0); setError('')
    setGuidance(emptyGuidance()); setAlerts([]); setAlertCount(0); setAlertPeakDeviation(null)
    changePhase('idle')
  }, [changePhase, clearForecast])
  // Invoked only by start, unmute or sound-test controls, never a timer/frame.
  const prepareSound = useCallback((test = false) => {
    if (!soundRef.current) return
    const device = audio.current ??= new DeveloperAlertAudio()
    const token = ++audioGeneration.current
    void device.arm().then(status => {
      if (!mounted.current || token !== audioGeneration.current || !soundRef.current) return
      setAudioStatus(status)
      if (test && status === 'ready' && document.visibilityState !== 'hidden' && !device.beep()) setAudioStatus('blocked')
    })
  }, [])
  const cancelSound = useCallback(() => {
    audioGeneration.current++
    audio.current?.cancel()
    setAudioStatus('inactive')
  }, [])
  const publish = useCallback((run: Run, next?: ForecastReading | null) => measurePipeline('publishScheduling', () => {
    if (!mounted.current || active.current !== run) return
    setPredictionStatus(run.engine?.predictionStatus ?? null)
    if (forecastExpiry.current !== null) clearTimeout(forecastExpiry.current)
    forecastExpiry.current = null
    const prediction = run.engine?.ready && run.guide?.current.step === 'tracking' ? run.engine.predictionDisplay : null
    const remaining = prediction ? prediction.targetAtMs - (performance.now() - run.started) : 0
    setForecast(remaining > 0 ? prediction : null)
    if (remaining > 0) forecastExpiry.current = setTimeout(() => {
      forecastExpiry.current = null
      if (mounted.current && active.current === run) setForecast(null)
    }, remaining)
    if (next && run.accumulator.add(next)) {
      const alert = run.alertTracker.observe(next)
      if (alert) {
        run.accumulator.event(alert.timeMs, `${run.source === 'synthetic' ? '합성 시연 · ' : ''}${alert.kind === 'reminder' ? '이탈 재알림' : '이탈 알림'} · ${alert.postureScore != null ? `종합 이탈 ${alert.postureScore.toFixed(2)}배 · 상대 모양 거리 ` : alert.normalScore != null ? `정상 범위 ${alert.normalScore.toFixed(2)}배 · 참고 거리 ` : '거리 '}${(alert.deviation * 100).toFixed(1)}% · ${(alert.durationMs / 1000).toFixed(1)}초`, 'warning')
        if (soundRef.current && document.visibilityState !== 'hidden' && !audio.current?.beep()) setAudioStatus(previous => previous === 'unsupported' ? previous : 'blocked')
      }
      setAlerts([...run.alertTracker.alerts]); setAlertCount(run.alertTracker.count)
      setAlertPeakDeviation(run.alertTracker.peakDeviation)
      setReading(next); setReadings([...run.accumulator.readings]); setEvents([...run.accumulator.events])
    }
    if (run.guide) changePhase(['intro', 'framing'].includes(run.guide.current.step) ? 'guiding' : run.engine?.ready ? 'measuring' : 'registering')
    setSummary(run.accumulator.snapshot(performance.now() - run.started))
  }), [changePhase])
  const unavailable = useCallback((run: Run, reason: 'quality' | 'gap' | 'time' | 'reset' = 'quality') => {
    if (!run.engine || !run.guide || active.current !== run) return
    run.referenceCandidates = []
    clearForecast()
    if (run.source === 'camera') latestCollection.current?.markGap('관측이 끊겨 수집을 기다립니다.')
    const t = Math.max(performance.now() - run.started, (run.lastTime ?? -1) + 1)
    run.lastTime = t
    setVisiblePoints(0)
    setObservationUsable(false)
    const previousStep = run.guide.current.step
    const view = run.guide.observe(t, null)
    if (previousStep === 'reference') {
      if (view.step === 'reference') {
        run.engine.pauseReference()
        setGuidance(view); publish(run); return
      }
      run.engine.register(); run.registrationAt = null
      setGuidance(view); setReading(null)
      run.accumulator.event(t, '관측이 오래 끊겨 구도부터 다시 확인합니다', 'unknown')
      publish(run)
    } else {
      setGuidance(view)
      publish(run, previousStep === 'tracking' ? run.engine.unavailable(t, reason) : null)
    }
  }, [publish, clearForecast])

  // A delayed callback is not evidence of invalid landmarks. Hide stale output,
  // but let the predictor wait briefly for the next real endpoint. Rules still
  // receive an unmeasurable reading and cannot accumulate time across the gap.
  const delayed = useCallback((run: Run) => {
    if (!run.engine?.ready || run.guide?.current.step !== 'tracking') { unavailable(run, 'gap'); return }
    clearForecast()
    latestCollection.current?.markGap('관측이 늦어져 수집을 기다립니다.')
    const t = Math.max(performance.now() - run.started, (run.lastTime ?? -1) + 1)
    // Keep lastTime on the source/hard-reset clock. A valid frame can have
    // started inference before this watchdog and arrive after it.
    setVisiblePoints(0)
    setObservationUsable(false)
    setGuidance(run.guide.observe(t, null))
    publish(run, run.engine.delayed(t))
  }, [clearForecast, publish, unavailable])

  const observeGuided = useCallback((run: Run, t: number, frame: GuideFrame | null, values: number[] | null) => {
    if (!run.engine || !run.guide || active.current !== run) return
    const previousStep = run.guide.current.step
    run.lastGuidedAt = t
    let view = run.guide.observe(t, values ? frame : null)
    if (view.step === 'framing' && values) {
      run.referenceCandidates = [...run.referenceCandidates.filter(sample => t - sample.time <= GUIDANCE_SETTINGS.stable_ms), { time: t, values }]
    } else run.referenceCandidates = []
    if (previousStep === 'reference' && view.step === 'framing') {
      run.engine.register(); run.registrationAt = null
      setReading(null)
      run.accumulator.event(t, '관측이 오래 끊겨 구도부터 다시 확인합니다', 'unknown')
    }
    if (view.step === 'framing' && view.ready && frame && values) {
      if (run.normalProfile) {
        // Use the existing framing interval's median. A single noisy frame must not restart the guide.
        const candidate = Array.from({ length: 39 }, (_, index) => {
          const samples = run.referenceCandidates.map(sample => sample.values[index]).sort((a, b) => a - b)
          return samples[Math.floor((samples.length - 1) / 2)]
        })
        const check = validateNormalReference(run.normalProfile, { values: candidate, poseModelId: run.poseModelId })
        setReferenceValidation(check)
        if (check.status !== 'accepted') {
          view = { ...view, ready: false, holdProgress: 0, ...referenceMessage(check) }
          setReading(null); setGuidance(view); publish(run); return
        }
      }
      if (view.ready) {
        view = run.guide.startReference(); run.engine.register(); run.registrationAt = t
        run.accumulator.event(t, '구도 확인 완료 · 8초 기준 등록 시작')
      }
    }
    if (view.step === 'intro' || view.step === 'framing') {
      setGuidance(view); setEvents([...run.accumulator.events]); publish(run); return
    }
    if (view.step === 'reference' && !view.ready) {
      run.engine.pauseReference()
      setGuidance(view); publish(run); return
    }
    const next = measurePipeline('engineStep', () => run.engine!.step(t, values, run.poseModelId, frame))
    if (next && frame && view.step === 'reference') {
      run.guide.captureReference(frame)
      const check = run.engine.referenceValidation
      if (check) setReferenceValidation(check)
      if (run.engine.ready) {
        view = run.guide.completeReference()
        run.accumulator.event(t, check?.status === 'accepted' ? '정상 자료로 등록 자세 검증 완료 · 자동 측정 시작' : '개인 기준 등록 완료 · 정상 자료 검증 없이 측정 시작', 'good')
      } else if (check && check.status !== 'accepted' && check.reason !== 'profile_missing') {
        view = { ...run.guide.realign(), live: frame, ready: false, ...referenceMessage(check) }
        run.registrationAt = null
        run.accumulator.event(t, '정상 자료와 다른 등록 후보를 거부했습니다', 'warning')
      }
    }
    setGuidance(view)
    if (next) publish(run, next)
    return next
  }, [publish])
  const makeRecord = useCallback((run: Run): LabRecord => ({
    id: run.id, startedAt: run.startedAt, source: run.source, predictor: run.predictor,
    summary: run.accumulator.snapshot(performance.now() - run.started),
    readings: [...run.accumulator.readings], events: [...run.accumulator.events],
    modelId: run.predictor === 'lstm' ? run.model!.model_id : run.predictor,
    modelSha256: run.predictor === 'lstm' ? run.model!.source_sha256 : null,
    normalProfileId: run.normalProfile?.id ?? null,
    poseModelId: run.poseModelId ?? null,
    forecastSchema: run.predictor === 'lstm' ? run.model?.schema_version : undefined,
    referenceValidation: run.engine?.referenceValidation ?? null,
    cameraMetadata: run.cameraMetadata ? { ...run.cameraMetadata } : null,
    alerts: [...run.alertTracker.alerts], alertCount: run.alertTracker.count,
    alertSettings: { basis: run.alertTracker.basis, reminderMs: ALERT_SETTINGS.reminder_ms },
  }), [])

  const finish = useCallback((message = '') => {
    const run = active.current
    generation.current++
    cancelSound()
    clearForecast()
    if (run) {
      if (run.timer) clearInterval(run.timer)
      run.unsubscribe?.()
      if (run.engine && run.lastTime !== null && performance.now() - run.started - run.lastTime > 250) unavailable(run)
      run.accumulator.event(Math.max(0, performance.now() - run.started), message ? '측정 중단' : '측정 종료', message ? 'unknown' : 'neutral')
      const record = makeRecord(run)
      if (run.accumulator.readings.length) {
        lastRecord.current = record
        setRecords(previous => [record, ...previous].slice(0, LAB_LIMITS.records))
      }
      setEvents(record.events); setSummary(record.summary)
      active.current = null
    }
    latestCollection.current?.endRun()
    // Capture the caller's camera error first: camera.stop clears its own error.
    latestCamera.current.stop()
    setVisiblePoints(0)
    setGuidance(emptyGuidance())
    setError(message)
    changePhase(message ? 'error' : run ? 'finished' : phaseRef.current === 'error' ? 'finished' : phaseRef.current)
  }, [cancelSound, changePhase, clearForecast, makeRecord, unavailable])

  const activateCamera = useCallback((run: Run) => {
    if (run.engine || active.current !== run) return
    run.engine = new LiveForecastExperiment(run.model, run.predictor, { mode: 'observed', normalProfile: run.normalProfile, imagePostureGuard: true })
    run.guide = new DeveloperGuide(performance.now() - run.started)
    run.accumulator.event(performance.now() - run.started, '카메라 연결됨 · 자동 안내 시작')
    setEvents([...run.accumulator.events])
    run.lastFrameAt = performance.now()
    changePhase('guiding')
    run.unsubscribe = latestCamera.current.subscribe(frame => measurePipeline('cameraConsumer', () => {
      if (!mounted.current || active.current !== run || !run.engine) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { unavailable(run, 'reset'); return }
      if (!Number.isFinite(frame.timeMs) || frame.timeMs < 0 ||
        (run.lastRawFrame !== null && frame.timeMs <= run.lastRawFrame)) {
        unavailable(run, 'time'); return
      }
      const wallTime = performance.now()
      recordPipelineDuration('captureToConsumer', wallTime - frame.timeMs)
      run.lastRawFrame = frame.timeMs
      // Camera frames use performance.now() at inference start. Do not align
      // their clock to first delivery: warm-up inference latency would shift
      // every forecast target into the future for the entire session.
      const t = frame.timeMs - run.started
      if (t < 0 || (run.lastTime !== null && t <= run.lastTime)) { unavailable(run, 'time'); return }
      run.lastTime = t; run.lastFrameAt = wallTime
      if (run.predictor === 'lstm' && run.model && !forecastModelMatchesPoseModel(run.model, frame.poseModelId)) {
        finish('학습에 사용한 MediaPipe 모델과 현재 카메라가 다릅니다. 설정에서 학습 당시의 추출 모델을 선택하고 다시 시작해 주세요.')
        return
      }
      run.poseModelId = frame.poseModelId
      run.cameraMetadata ??= { poseModelId: frame.poseModelId ?? null, delegate: frame.delegate,
        width: frame.width, height: frame.height, pacing: readTrackingDiagnostics()?.pacing ?? null }
      const count = frame.landmarks.slice(0, 13).filter(p => p &&
        [p.x, p.y, p.visibility].every(Number.isFinite) && (p.visibility ?? 0) >= .5 &&
        p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1).length
      setVisiblePoints(count)
      try {
        const values = liveForecastPoints(frame.landmarks, frame.worldLandmarks)
        setObservationUsable(values !== null)
        const next = observeGuided(run, t, guideFrame(frame.landmarks, frame.width, frame.height, t), values)
        const baseline = run.engine.referenceValues
        if (next && baseline && run.guide?.current.step === 'tracking') {
          latestCollection.current?.observe({ frame, reading: next, observationTimeMs: t, runId: run.id, baseline, source: run.source })
        } else latestCollection.current?.markGap('기준 등록을 마치면 자동으로 수집합니다.')
      }
      catch { unavailable(run) }
    }))
    run.timer = setInterval(() => {
      if (active.current !== run) return
      if (performance.now() - run.lastFrameAt > FORECAST_OBSERVATION_MAX_GAP_MS) delayed(run)
      else publish(run)
    }, 250)
    publish(run)
  }, [changePhase, delayed, finish, observeGuided, publish, unavailable])

  const begin = useCallback((nextSource: LabSource) => {
    if (active.current) finish()
    else latestCamera.current.stop()
    const selected = modelRef.current && !predictorChosen.current ? 'lstm' : predictorRef.current
    predictorRef.current = selected; updatePredictor(selected)
    if (selected === 'lstm' && !modelRef.current) {
      setError('LSTM을 사용하려면 검증된 모델 JSON을 먼저 불러와 주세요.')
      changePhase('error'); return
    }
    if (nextSource === 'synthetic' && selected === 'lstm' && modelRef.current?.schema_version === 'forecast-weights-v2') {
      setError('MediaPipe 재학습 모델은 실제 카메라에서 비교해 주세요. 합성 시연은 설정에서 위치 유지 또는 등속 비교군을 선택하면 실행할 수 있습니다.')
      changePhase('error'); return
    }
    prepareSound()
    const token = ++generation.current
    const started = performance.now()
    const run: Run = {
      id: `lab-${Date.now()}-${token}`, startedAt: new Date().toISOString(), started,
      source: nextSource, predictor: selected, model: modelRef.current, engine: null,
      normalProfile: nextSource === 'camera' && latestNormalProfile.current ? structuredClone(latestNormalProfile.current) : null,
      guide: null, registrationAt: null, lastGuidedAt: -Infinity, referenceCandidates: [],
      accumulator: new LabAccumulator(alertBasisRef.current), alertTracker: new DeveloperAlertTracker(alertBasisRef.current, nextSource), lastRawFrame: null, lastTime: null, lastFrameAt: started,
    }
    active.current = run; lastRecord.current = null
    clearForecast()
    setPredictionStatus(null)
    setReferenceValidation(null)
    setObservationUsable(null)
    latestCollection.current?.markGap(nextSource === 'camera' ? '기준 등록을 기다립니다.' : '합성 데모는 수집하지 않습니다.')
    setSource(nextSource); setReading(null); setReadings([]); setSummary(emptySummary()); setVisiblePoints(0); setError('')
    setGuidance(emptyGuidance()); setAlerts([]); setAlertCount(0); setAlertPeakDeviation(null)
    run.accumulator.event(0, nextSource === 'camera' ? '실제 카메라 연결 중' : '합성 시연 시작 · 실제 측정 아님')
    setEvents([...run.accumulator.events])
    if (nextSource === 'camera') {
      changePhase('connecting')
      void latestCamera.current.connect().then(() => {
        // useCamera cancels pending permission/model work; also release a late
        // completion when this adapter has already been stopped or unmounted.
        if (generation.current !== token && !active.current) latestCamera.current.stop()
      }).catch(cause => {
        if (mounted.current && active.current === run && generation.current === token) {
          finish(cause instanceof Error ? cause.message : '카메라를 연결하지 못했습니다.')
        }
      })
    } else {
      run.engine = new LiveForecastExperiment(run.model, run.predictor, { mode: 'observed', imagePostureGuard: true })
      run.guide = new DeveloperGuide(0); changePhase('guiding')
      // The engine uses the same wall clock as unavailable()/visibility events.
      // The scenario advances only on visible, timely callbacks so throttling
      // cannot reverse engine timestamps or skip the demonstration's actions.
      let scenarioTime = 0, previousTick = performance.now() - run.started
      observeGuided(run, previousTick, syntheticGuideFrame(0), syntheticForecastValues(0))
      run.lastTime = previousTick
      run.timer = setInterval(() => {
        if (active.current !== run || !run.engine) return
        const elapsed = performance.now() - run.started, gap = elapsed - previousTick
        previousTick = elapsed
        if (document.visibilityState === 'hidden' || gap > FORECAST_OBSERVATION_MAX_GAP_MS) { unavailable(run); return }
        const time = Math.max(elapsed, (run.lastTime ?? -1) + 1)
        scenarioTime = run.registrationAt === null ? 0 : scenarioTime + 100
        const frame = syntheticGuideFrame(scenarioTime)
        if (frame) frame.timeMs = time
        run.lastTime = time
        observeGuided(run, time, frame, syntheticForecastValues(scenarioTime))
        if (run.registrationAt !== null && scenarioTime >= DEMO_DURATION) finish()
      }, 100)
    }
  }, [changePhase, clearForecast, finish, observeGuided, prepareSound, unavailable])

  useEffect(() => {
    const run = active.current
    if (!run || run.source !== 'camera') return
    if (camera.state === 'on') activateCamera(run)
    else if (camera.state === 'error') finish(camera.error || '카메라 연결이 중단되었습니다.')
    else if (run.engine && camera.state !== 'loading') finish('카메라 연결이 중단되었습니다. 다시 시작해 주세요.')
  }, [camera.state, camera.error, activateCamera, finish])

  useEffect(() => {
    const hidden = () => {
      const run = active.current
      if (document.visibilityState === 'hidden') cancelSound()
      if (run) unavailable(run, 'reset')
    }
    document.addEventListener('visibilitychange', hidden)
    return () => document.removeEventListener('visibilitychange', hidden)
  }, [cancelSound, unavailable])

  useEffect(() => {
    mounted.current = true
    // Fast Refresh keeps React state after cleanup has released the active run
    // and camera. Never present that abandoned reading as a live measurement.
    if (!active.current && !idle(phaseRef.current)) clearDisplayedRun()
    const controller = new AbortController(), token = ++loadGeneration.current
    void fetch(`${import.meta.env.BASE_URL}research-model/forecast.json`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) return null
        if (Number(response.headers.get('content-length')) > MODEL_LIMIT) throw new Error('모델 JSON은 1MB 이하로 준비해 주세요.')
        const text = await response.text()
        return text.trimStart().startsWith('<') ? null : parseModel(text)
      }).then(next => {
        if (!mounted.current || token !== loadGeneration.current) return
        // Optional discovery never changes the configuration of an active run.
        modelRef.current = next; setModel(next); setModelStatus(next ? 'ready' : 'missing'); setModelError('')
        if (next && phaseRef.current === 'idle' && !predictorChosen.current) {
          predictorRef.current = 'lstm'; updatePredictor('lstm')
        }
      }).catch(cause => {
        if (!mounted.current || controller.signal.aborted || token !== loadGeneration.current) return
        setModelStatus(cause instanceof TypeError ? 'missing' : 'invalid')
        setModelError(cause instanceof TypeError ? '' : cause instanceof Error ? cause.message : '모델을 읽지 못했습니다.')
      })
    return () => {
      mounted.current = false; generation.current++; loadGeneration.current++
      controller.abort()
      const run = active.current; active.current = null
      if (run?.timer) clearInterval(run.timer)
      run?.unsubscribe?.()
      if (forecastExpiry.current !== null) clearTimeout(forecastExpiry.current)
      forecastExpiry.current = null
      latestCollection.current?.endRun()
      latestCamera.current.stop()
      audioGeneration.current++; audio.current?.dispose(); audio.current = null
    }
  }, [])

  const loadModel = useCallback(async (file: File) => {
    if (!idle(phaseRef.current)) return
    const token = ++loadGeneration.current
    setModelError(''); setModelStatus('loading')
    try {
      if (file.size > MODEL_LIMIT) throw new Error('모델 JSON은 1MB 이하로 준비해 주세요.')
      const next = parseModel(await file.text())
      if (!mounted.current || token !== loadGeneration.current) return
      if (!idle(phaseRef.current)) { setModelStatus(modelRef.current ? 'ready' : 'missing'); return }
      modelRef.current = next; setModel(next); setModelStatus('ready'); clearDisplayedRun()
      predictorChosen.current = true; predictorRef.current = 'lstm'; updatePredictor('lstm')
    } catch (cause) {
      if (!mounted.current || token !== loadGeneration.current) return
      if (!idle(phaseRef.current)) { setModelStatus(modelRef.current ? 'ready' : 'missing'); return }
      setModelStatus(modelRef.current ? 'ready' : 'invalid')
      setModelError(cause instanceof Error ? cause.message : '모델 JSON을 읽지 못했습니다.')
    }
  }, [clearDisplayedRun])
  const setPredictor = useCallback((next: LabPredictor) => {
    if (!idle(phaseRef.current) || !['hold_last', 'constant_velocity', 'lstm'].includes(next)) return
    if (next === 'lstm' && !modelRef.current) { setModelError('LSTM 모델 JSON을 먼저 불러와 주세요.'); return }
    predictorChosen.current = true
    if (next === predictorRef.current) return
    predictorRef.current = next; updatePredictor(next); clearDisplayedRun()
  }, [clearDisplayedRun])
  const setAlertBasis = useCallback((next: LabAlertBasis) => {
    if (!idle(phaseRef.current) || !['predictor', 'rule'].includes(next) || next === alertBasisRef.current) return
    alertBasisRef.current = next; updateAlertBasis(next); clearDisplayedRun()
  }, [clearDisplayedRun])
  const setSoundEnabled = useCallback((enabled: boolean) => {
    soundRef.current = enabled; updateSoundEnabled(enabled)
    if (enabled) prepareSound()
    else cancelSound()
  }, [cancelSound, prepareSound])
  const download = useCallback((record?: LabRecord) => {
    const selected = record ?? (active.current ? makeRecord(active.current) : lastRecord.current)
    if (!selected?.readings.length) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportLabRecord(selected), null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${selected.id}.json`; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }, [makeRecord])

  return { phase, source, predictor, setPredictor, model, modelStatus, modelError, loadModel,
    error, reading, forecast, predictionStatus, referenceValidation, readings, events, summary, records, visiblePoints, observationUsable, guidance,
    alerts, alertCount, alertPeakDeviation, alertBasis, setAlertBasis, soundEnabled, setSoundEnabled,
    audioStatus, testAlertSound: () => prepareSound(true),
    start: () => begin('camera'), startDemo: () => begin('synthetic'), stop: () => finish(), download }
}
