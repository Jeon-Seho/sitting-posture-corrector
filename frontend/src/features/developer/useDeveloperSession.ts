import { useCallback, useEffect, useRef, useState } from 'react'
import { FORECAST_MAX_SAMPLE_GAP_MS, LiveForecastExperiment, liveForecastPoints, readForecastWeights,
  type ForecastReading, type ForecastWeights } from '../../../../model/prototype/forecast'
import { DeveloperGuide, emptyGuidance, guideFrame, syntheticGuideFrame,
  type GuideFrame } from '../../../../model/prototype/developerGuidance'
import type { CameraController } from '../../hooks/useCamera'
import { LAB_LIMITS, LabAccumulator, emptySummary, exportLabRecord, syntheticForecastValues } from './session'
import { ALERT_SETTINGS, DeveloperAlertTracker } from './alerts'
import { DeveloperAlertAudio } from './alertAudio'
import type { DeveloperSession, LabAlertBasis, LabAudioStatus, LabPhase, LabPredictor, LabRecord, LabSource } from './types'

const MODEL_LIMIT = 1_000_000
const DEMO_DURATION = 40_000
interface Run {
  id: string
  startedAt: string
  started: number
  source: LabSource
  predictor: LabPredictor
  model: ForecastWeights | null
  engine: LiveForecastExperiment | null
  guide: DeveloperGuide | null
  registrationAt: number | null
  lastGuidedAt: number
  accumulator: LabAccumulator
  alertTracker: DeveloperAlertTracker
  timer?: ReturnType<typeof setInterval>
  unsubscribe?: () => void
  frameOrigin: number | null
  lastRawFrame: number | null
  lastTime: number | null
  lastFrameAt: number
}
const parseModel = (text: string) => {
  if (new TextEncoder().encode(text).length > MODEL_LIMIT) throw new Error('모델 JSON은 1MB 이하로 준비해 주세요.')
  if (text.trimStart().startsWith('<')) throw new Error('모델 JSON 파일을 찾지 못했습니다.')
  return readForecastWeights(JSON.parse(text))
}
const idle = (phase: LabPhase) => !['connecting', 'guiding', 'registering', 'measuring'].includes(phase)

export function useDeveloperSession(camera: CameraController): DeveloperSession {
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
  const [readings, setReadings] = useState<ForecastReading[]>([])
  const [events, setEvents] = useState<DeveloperSession['events']>([])
  const [summary, setSummary] = useState(emptySummary)
  const [records, setRecords] = useState<LabRecord[]>([])
  const [visiblePoints, setVisiblePoints] = useState(0)
  const [guidance, setGuidance] = useState(emptyGuidance)
  const [alerts, setAlerts] = useState<DeveloperSession['alerts']>([])
  const [alertCount, setAlertCount] = useState(0)
  const [alertPeakDeviation, setAlertPeakDeviation] = useState<number | null>(null)
  const [alertBasis, updateAlertBasis] = useState<LabAlertBasis>('predictor')
  const alertBasisRef = useRef<LabAlertBasis>('predictor')
  const [soundEnabled, updateSoundEnabled] = useState(true)
  const soundRef = useRef(true)
  const [audioStatus, setAudioStatus] = useState<LabAudioStatus>('inactive')
  const audio = useRef<DeveloperAlertAudio | null>(null)
  const audioGeneration = useRef(0)
  const latestCamera = useRef(camera)
  latestCamera.current = camera
  const active = useRef<Run | null>(null)
  const generation = useRef(0)
  const loadGeneration = useRef(0)
  const mounted = useRef(true)
  const lastRecord = useRef<LabRecord | null>(null)

  const changePhase = useCallback((next: LabPhase) => { phaseRef.current = next; setPhase(next) }, [])
  const clearDisplayedRun = useCallback(() => {
    lastRecord.current = null
    setReading(null); setReadings([]); setEvents([]); setSummary(emptySummary()); setVisiblePoints(0); setError('')
    setGuidance(emptyGuidance()); setAlerts([]); setAlertCount(0); setAlertPeakDeviation(null)
    changePhase('idle')
  }, [changePhase])
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
  const publish = useCallback((run: Run, next?: ForecastReading | null) => {
    if (!mounted.current || active.current !== run) return
    if (next && run.accumulator.add(next)) {
      const alert = run.alertTracker.observe(next)
      if (alert) {
        run.accumulator.event(alert.timeMs, `${run.source === 'synthetic' ? '합성 시연 · ' : ''}${alert.kind === 'reminder' ? '이탈 재알림' : '이탈 알림'} · 거리 ${(alert.deviation * 100).toFixed(1)}% · ${(alert.durationMs / 1000).toFixed(1)}초`, 'warning')
        if (soundRef.current && document.visibilityState !== 'hidden' && !audio.current?.beep()) setAudioStatus(previous => previous === 'unsupported' ? previous : 'blocked')
      }
      setAlerts([...run.alertTracker.alerts]); setAlertCount(run.alertTracker.count)
      setAlertPeakDeviation(run.alertTracker.peakDeviation)
      setReading(next); setReadings([...run.accumulator.readings]); setEvents([...run.accumulator.events])
    }
    if (run.guide) changePhase(['intro', 'framing'].includes(run.guide.current.step) ? 'guiding' : run.engine?.ready ? 'measuring' : 'registering')
    setSummary(run.accumulator.snapshot(performance.now() - run.started))
  }, [changePhase])
  const unavailable = useCallback((run: Run) => {
    if (!run.engine || !run.guide || active.current !== run) return
    const t = Math.max(performance.now() - run.started, (run.lastTime ?? -1) + 1)
    run.lastTime = t
    setVisiblePoints(0)
    const previousStep = run.guide.current.step
    const view = run.guide.observe(t, null)
    if (previousStep === 'reference') {
      run.engine.register(); run.registrationAt = null
      setGuidance(run.guide.realign()); setReading(null)
      run.accumulator.event(t, '관측이 끊겨 구도부터 다시 확인합니다', 'unknown')
      publish(run)
    } else {
      setGuidance(view)
      publish(run, previousStep === 'tracking' ? run.engine.unavailable(t) : null)
    }
  }, [publish])

  const observeGuided = useCallback((run: Run, t: number, frame: GuideFrame | null, values: number[] | null) => {
    if (!run.engine || !run.guide || active.current !== run) return
    const referenceGap = run.guide.current.step === 'reference' &&
      Number.isFinite(run.lastGuidedAt) && t - run.lastGuidedAt > FORECAST_MAX_SAMPLE_GAP_MS
    run.lastGuidedAt = t
    let view = run.guide.observe(t, values ? frame : null)
    if (view.step === 'reference' && (!view.ready || referenceGap)) {
      run.engine.register(); run.registrationAt = null
      view = run.guide.realign(); setReading(null)
      run.accumulator.event(t, '구도가 바뀌어 정렬부터 다시 확인합니다', 'unknown')
    }
    if (view.step === 'framing' && view.ready && frame && values) {
      view = run.guide.startReference(); run.engine.register(); run.registrationAt = t
      run.accumulator.event(t, '구도 확인 완료 · 8초 기준 등록 시작')
    }
    if (view.step === 'intro' || view.step === 'framing') {
      setGuidance(view); setEvents([...run.accumulator.events]); publish(run); return
    }
    const next = run.engine.step(t, values)
    if (next && frame && view.step === 'reference') {
      run.guide.captureReference(frame)
      if (run.engine.ready) {
        view = run.guide.completeReference()
        run.accumulator.event(t, '개인 기준 등록 완료 · 자동 측정 시작', 'good')
      }
    }
    setGuidance(view)
    if (next) publish(run, next)
  }, [publish])
  const makeRecord = useCallback((run: Run): LabRecord => ({
    id: run.id, startedAt: run.startedAt, source: run.source, predictor: run.predictor,
    summary: run.accumulator.snapshot(performance.now() - run.started),
    readings: [...run.accumulator.readings], events: [...run.accumulator.events],
    modelId: run.predictor === 'lstm' ? run.model!.model_id : run.predictor,
    modelSha256: run.predictor === 'lstm' ? run.model!.source_sha256 : null,
    alerts: [...run.alertTracker.alerts], alertCount: run.alertTracker.count,
    alertSettings: { basis: run.alertTracker.basis, reminderMs: ALERT_SETTINGS.reminder_ms },
  }), [])

  const finish = useCallback((message = '') => {
    const run = active.current
    generation.current++
    cancelSound()
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
    // Capture the caller's camera error first: camera.stop clears its own error.
    latestCamera.current.stop()
    setVisiblePoints(0)
    setGuidance(emptyGuidance())
    setError(message)
    changePhase(message ? 'error' : run ? 'finished' : phaseRef.current === 'error' ? 'finished' : phaseRef.current)
  }, [cancelSound, changePhase, makeRecord, unavailable])

  const activateCamera = useCallback((run: Run) => {
    if (run.engine || active.current !== run) return
    run.engine = new LiveForecastExperiment(run.model, run.predictor)
    run.guide = new DeveloperGuide(performance.now() - run.started)
    run.accumulator.event(performance.now() - run.started, '카메라 연결됨 · 자동 안내 시작')
    setEvents([...run.accumulator.events])
    run.lastFrameAt = performance.now()
    changePhase('guiding')
    run.unsubscribe = latestCamera.current.subscribe(frame => {
      if (!mounted.current || active.current !== run || !run.engine) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { unavailable(run); return }
      if (!Number.isFinite(frame.timeMs) || frame.timeMs < 0 ||
        (run.lastRawFrame !== null && frame.timeMs <= run.lastRawFrame)) {
        unavailable(run); return
      }
      const wallTime = performance.now()
      run.frameOrigin ??= frame.timeMs - (wallTime - run.started)
      run.lastRawFrame = frame.timeMs
      const t = Math.max(frame.timeMs - run.frameOrigin, (run.lastTime ?? -1) + 1)
      run.lastTime = t; run.lastFrameAt = wallTime
      const count = frame.landmarks.slice(0, 13).filter(p => p &&
        [p.x, p.y, p.visibility].every(Number.isFinite) && (p.visibility ?? 0) >= .5 &&
        p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1).length
      setVisiblePoints(count)
      try {
        const values = liveForecastPoints(frame.landmarks, frame.worldLandmarks)
        if (values && t - run.lastGuidedAt < 95) return
        observeGuided(run, t, guideFrame(frame.landmarks, frame.width, frame.height, t), values)
      }
      catch { unavailable(run) }
    })
    run.timer = setInterval(() => {
      if (active.current !== run) return
      if (performance.now() - run.lastFrameAt > 250) unavailable(run)
      else publish(run)
    }, 250)
    publish(run)
  }, [changePhase, observeGuided, publish, unavailable])

  const begin = useCallback((nextSource: LabSource) => {
    if (active.current) finish()
    else latestCamera.current.stop()
    const selected = modelRef.current && !predictorChosen.current ? 'lstm' : predictorRef.current
    predictorRef.current = selected; updatePredictor(selected)
    if (selected === 'lstm' && !modelRef.current) {
      setError('LSTM을 사용하려면 검증된 모델 JSON을 먼저 불러와 주세요.')
      changePhase('error'); return
    }
    prepareSound()
    const token = ++generation.current
    const started = performance.now()
    const run: Run = {
      id: `lab-${Date.now()}-${token}`, startedAt: new Date().toISOString(), started,
      source: nextSource, predictor: selected, model: modelRef.current, engine: null,
      guide: null, registrationAt: null, lastGuidedAt: -Infinity,
      accumulator: new LabAccumulator(), alertTracker: new DeveloperAlertTracker(alertBasisRef.current, nextSource), frameOrigin: null, lastRawFrame: null, lastTime: null, lastFrameAt: started,
    }
    active.current = run; lastRecord.current = null
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
      run.engine = new LiveForecastExperiment(run.model, run.predictor)
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
        if (document.visibilityState === 'hidden' || gap > FORECAST_MAX_SAMPLE_GAP_MS) { unavailable(run); return }
        const time = Math.max(elapsed, (run.lastTime ?? -1) + 1)
        scenarioTime = run.registrationAt === null ? 0 : scenarioTime + 100
        const frame = syntheticGuideFrame(scenarioTime)
        if (frame) frame.timeMs = time
        run.lastTime = time
        observeGuided(run, time, frame, syntheticForecastValues(scenarioTime))
        if (run.registrationAt !== null && scenarioTime >= DEMO_DURATION) finish()
      }, 100)
    }
  }, [changePhase, finish, observeGuided, prepareSound, unavailable])

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
      if (run) unavailable(run)
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
    error, reading, readings, events, summary, records, visiblePoints, guidance,
    alerts, alertCount, alertPeakDeviation, alertBasis, setAlertBasis, soundEnabled, setSoundEnabled,
    audioStatus, testAlertSound: () => prepareSound(true),
    start: () => begin('camera'), startDemo: () => begin('synthetic'), stop: () => finish(), download }
}
