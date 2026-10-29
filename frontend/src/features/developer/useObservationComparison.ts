import { useCallback, useEffect, useRef, useState } from 'react'
import { ObservationComparison, COMPARISON_POLICY, type ComparisonFrame, type ComparisonValues } from '../../../../model/prototype/observationComparison'
import type { CameraController } from '../../hooks/useCamera'
import { comparisonDemo, type ComparisonAction } from './comparisonDemo'
import { COMPARISON_TRACE_LIMIT, comparisonSummaryCsv, comparisonTraceCsv, downloadComparisonCsv, type ComparisonCapture, type ComparisonTrace } from './observationCsv'
import { DEFAULT_GUIDE_PLAN, OBSERVATION_REFERENCE_MS, ObservationProtocol, type GuideMode, type GuidePauseReason, type GuidePlan, type GuideSnapshot } from './observationProtocol'
import { automaticComparisonCaptures } from './observationAutoSummary'
import { ObservationReplayArchive, type ReplayPhase } from './observationReplay'

export type ReferenceSetup = { status: 'idle' | 'connecting' | 'preparing' | 'registering' | 'interrupted'; remainingMs: number }
export { OBSERVATION_REFERENCE_MS } from './observationProtocol'
const locked = (guide: GuideSnapshot) => ['running', 'waiting', 'paused'].includes(guide.status)
const measuring = (guide: GuideSnapshot) => guide.status === 'running' && guide.step?.phase === 'hold' && guide.remainingMs > 0

export function useObservationComparison(camera: CameraController, mode: 'camera' | 'synthetic' = 'camera') {
  const engine = useRef(new ObservationComparison(mode === 'camera' ? OBSERVATION_REFERENCE_MS : COMPARISON_POLICY.referenceMs))
  const cameraRef = useRef(camera); cameraRef.current = camera
  const activeRef = useRef<'camera' | 'synthetic' | null>(null)
  const actionRef = useRef<ComparisonAction>('neutral')
  const selectedAt = useRef(0), receivedAt = useRef(0), frameAt = useRef<number | null>(null), token = useRef(0)
  const [source, setSource] = useState<'camera' | 'synthetic'>(mode)
  const [active, setActive] = useState(false)
  const modeRef = useRef<GuideMode>('auto'), [guideMode, setGuideMode] = useState<GuideMode>('auto')
  const planRef = useRef<GuidePlan>(DEFAULT_GUIDE_PLAN), [guidePlan, setGuidePlan] = useState<GuidePlan>(DEFAULT_GUIDE_PLAN)
  const setupRef = useRef<ReferenceSetup>({ status: 'idle', remainingMs: 0 })
  const [setup, setSetup] = useState(setupRef.current)
  const updateSetup = useCallback((status: ReferenceSetup['status'], remainingMs = 0) => {
    setupRef.current = { status, remainingMs }; setSetup(setupRef.current)
  }, [])
  const [action, setAction] = useState<ComparisonAction>('neutral')
  const [notice, setNotice] = useState(mode === 'synthetic' ? '가상 점으로 화면 표시만 확인합니다. 실제 측정 자료를 모으지 않습니다.' : '')
  const [captures, setCaptures] = useState<Partial<Record<ComparisonAction, ComparisonCapture>> | null>({})
  const protocol = useRef(new ObservationProtocol()), guideSequence = useRef(0)
  const [guide, setGuide] = useState(() => protocol.current.snapshot(0))
  const trace = useRef<ComparisonTrace[]>([]), dropped = useRef(0), segment = useRef(0)
  const exportReference = useRef<ObservationComparison['reference']>(null)
  const [pendingReset, setPendingReset] = useState<'start' | 'register' | 'clear' | null>(null)
  const run = useRef({ runId: '', startedAt: '', start: 0 })
  const replay = useRef(new ObservationReplayArchive('', ''))
  const getReplay = useCallback(() => replay.current.count ? replay.current.snapshot() : null, [])
  const resetExport = useCallback(() => {
    trace.current = []; dropped.current = 0; segment.current = 0
    exportReference.current = null
    protocol.current = new ObservationProtocol(); guideSequence.current = 0; setGuide(protocol.current.snapshot(0))
    run.current = { runId: `${Date.now()}-${++token.current}`, startedAt: new Date().toISOString(), start: performance.now() }
    replay.current = new ObservationReplayArchive(run.current.runId, run.current.startedAt)
    setCaptures({})
  }, [])
  const appendTrace = useCallback((event: ComparisonTrace['event'], observationTimeMs: number | null, values: ComparisonValues | null, guidance = protocol.current.snapshot(performance.now())) => {
    if (mode !== 'camera' || !(engine.current.reference || exportReference.current)) return
    // Tracking is needed for preview and safety; only the timed hold is a measurement.
    if (event === 'observation' && !measuring(guidance)) return
    if (event === 'interrupted' && trace.current.at(-1)?.event === 'interrupted') return
    const current = event === 'observation' ? engine.current.current : null
    trace.current.push({ elapsedMs: performance.now() - run.current.start, observationTimeMs, action: actionRef.current, segment: segment.current, event, status: !values ? 'unmeasurable' : values.relativeZ === null ? 'depth_unavailable' : 'measured', imageValid: !!current?.image, worldValid: !!current?.world, values, zMeters: current?.world?.relativeZ ?? null, guidance: guidance.step ? guidance : null })
    if (trace.current.length > COMPARISON_TRACE_LIMIT) { trace.current.shift(); dropped.current++ }
  }, [mode])
  const [view, setView] = useState(() => ({ current: engine.current.current, reference: engine.current.reference, samples: engine.current.samples, registering: false, progress: 0, frame: null as ComparisonFrame | null }))
  const publish = useCallback((frame?: ComparisonFrame | null) => setView(old => ({ current: engine.current.current, reference: engine.current.reference, samples: [...engine.current.samples], registering: engine.current.registering, progress: engine.current.progress, frame: frame === undefined ? old.frame : frame })), [])
  const assignAction = useCallback((next: ComparisonAction) => { actionRef.current = next; setAction(next); selectedAt.current = frameAt.current ?? 0 }, [])
  const guideAction = useCallback((snapshot: GuideSnapshot) => {
    if (snapshot.step) {
      assignAction(snapshot.step.phase === 'return' ? 'neutral' : snapshot.step.action)
      // A manual next click can occur between frames; its previous preview frame is not a hold sample.
      selectedAt.current = (frameAt.current ?? 0) + 0.001
    }
  }, [assignAction])
  const recordPause = useCallback(() => {
    const snapshot = protocol.current.snapshot(performance.now())
    appendTrace('protocol_paused', null, null, snapshot); segment.current++; setGuide(snapshot)
    setNotice('안내를 일시 정지했어요. 아래 동작 안내와 추적을 확인한 뒤 재개하면 현재 단계를 처음부터 다시 셉니다. 기존 구간은 보존합니다.')
  }, [appendTrace])
  const pauseGuide = useCallback((reason: GuidePauseReason) => {
    if (protocol.current.pause(reason)) recordPause()
  }, [recordPause])
  const interrupt = useCallback((event: ComparisonTrace['event'] = 'interrupted') => {
    if (mode === 'camera') replay.current.mark(performance.now() - run.current.start, event === 'hidden' ? 'hidden' : event === 'stopped' ? 'stopped' : 'interrupted')
    pauseGuide(event === 'hidden' ? 'hidden' : 'tracking_lost')
    engine.current.interrupt(frameAt.current ?? 0); appendTrace(event, null, null); publish(null)
  }, [publish, appendTrace, pauseGuide, mode])
  const guideReady = useCallback(() => activeRef.current === 'camera' && cameraRef.current.state === 'on' && document.visibilityState !== 'hidden' && !engine.current.registering && !!engine.current.reference && !!engine.current.current?.image && performance.now() - receivedAt.current <= COMPARISON_POLICY.gapMs, [])
  const startGuide = useCallback(() => {
    if (mode !== 'camera' || locked(protocol.current.snapshot(performance.now())) || !guideReady()) return
    const now = performance.now()
    if (!protocol.current.start(now, `${run.current.runId}-guide-${++guideSequence.current}`, modeRef.current, planRef.current)) return
    replay.current.setPlan(planRef.current)
    const snapshot = protocol.current.snapshot(now)
    segment.current++; guideAction(snapshot); appendTrace('protocol_phase_started', null, null, snapshot)
    if (snapshot.status === 'waiting') appendTrace('protocol_phase_completed', null, null, snapshot)
    setGuide(snapshot)
    setNotice(modeRef.current === 'manual' ? '기준 등록 완료. 자세를 잡고 준비되면 측정을 시작하세요.' : '기준 등록 완료. 준비 2초 → 측정(이탈 5초·스트레칭 8초) → 복귀 준비 5초로 진행합니다. 측정 시간에만 자료를 모읍니다.')
  }, [mode, guideReady, guideAction, appendTrace])
  const finishGuideTransition = useCallback((result: 'none' | 'phase' | 'completed' | 'paused' | 'waiting', now: number) => {
    const next = protocol.current.snapshot(now)
    if (result === 'phase') { segment.current++; guideAction(next); appendTrace('protocol_phase_started', null, null, next); if (next.status === 'waiting') appendTrace('protocol_phase_completed', null, null, next) }
    setGuide(next)
    if (result === 'completed') {
      appendTrace('protocol_completed', null, null, next)
      token.current++; activeRef.current = null; setActive(false); cameraRef.current.stop()
      replay.current.mark(performance.now() - run.current.start, 'stopped')
      engine.current.registering = false; interrupt('stopped')
      setNotice(`이탈·스트레칭 ${next.plan.rounds}바퀴 안내를 마쳤어요. 카메라를 끄고 자료를 보존했습니다. JSON과 CSV를 내려받으세요. 실제 수행을 자동 확인한 결과는 아닙니다.`)
    }
  }, [appendTrace, guideAction, interrupt])
  const advanceGuide = useCallback(() => {
    const now = performance.now(), before = protocol.current.snapshot(now)
    if (before.status !== 'running') return
    if (!guideReady()) { pauseGuide('tracking_lost'); return }
    const result = protocol.current.advance(now)
    if (result === 'paused') { recordPause(); return }
    if (result === 'phase' || result === 'completed' || result === 'waiting') appendTrace('protocol_phase_completed', null, null, before)
    finishGuideTransition(result, now)
  }, [appendTrace, finishGuideTransition, guideReady, pauseGuide, recordPause])
  const advanceSetup = useCallback(() => {
    if (mode !== 'camera' || activeRef.current !== 'camera' || cameraRef.current.state !== 'on' || document.visibilityState === 'hidden') return
    if (setupRef.current.status === 'connecting') {
      updateSetup('preparing')
      setNotice('편안한 기준 자세를 잡고 준비되면 등록을 시작하세요.')
    }
  }, [mode, updateSetup])
  const canStartReference = mode === 'camera' && active && camera.state === 'on' && setup.status === 'preparing' && !!view.current?.image && typeof document !== 'undefined' && document.visibilityState !== 'hidden' && performance.now() - receivedAt.current <= COMPARISON_POLICY.gapMs
  const startReference = () => {
    if (mode !== 'camera' || activeRef.current !== 'camera' || cameraRef.current.state !== 'on' || setupRef.current.status !== 'preparing' || document.visibilityState === 'hidden' || !engine.current.current?.image || performance.now() - receivedAt.current > COMPARISON_POLICY.gapMs) return
    engine.current.beginReference(); updateSetup('registering', OBSERVATION_REFERENCE_MS); publish(null)
    setNotice('기준 자세 등록 중 · 8초 동안 편안하게 유지하세요. 추적이 끊기면 8초를 다시 셉니다.')
  }
  const receive = useCallback((frame: ComparisonFrame) => {
    if (!activeRef.current || document.visibilityState === 'hidden') return
    if (frameAt.current !== null && frame.timeMs > frameAt.current && frame.timeMs - frameAt.current < 100) return
    const previousReceive = receivedAt.current
    receivedAt.current = performance.now()
    advanceSetup()
    const before = engine.current.reference, previousTime = frameAt.current
    engine.current.accept(frame); frameAt.current = frame.timeMs
    if (before && !engine.current.reference) {
      // Do not erase the previous buffer or export it against the new extraction context.
      if (protocol.current.cancel(performance.now())) { appendTrace('protocol_cancelled', null, null); setGuide(protocol.current.snapshot(performance.now())) }
      token.current++; activeRef.current = null; setActive(false); cameraRef.current.stop()
      replay.current.mark(performance.now() - run.current.start, 'stopped')
      publish(null); setNotice('영상 크기 또는 추출 모델이 바뀌어 측정을 멈췄어요. 기존 자료는 보존했습니다. CSV를 내려받은 뒤 새 기준을 등록하세요.'); return
    }
    if (!before && engine.current.reference) {
      exportReference.current = engine.current.reference
      updateSetup('idle')
      setNotice(mode === 'synthetic' ? '화면 조작 예시입니다. 수집·비교표 저장·CSV 다운로드는 하지 않습니다.' : engine.current.reference.world ? '기준 등록 완료. 기준 자세에서 안내를 시작하세요.' : '2D 기준만 등록했어요. z 기준이 필요하면 추적을 확인하고 다시 등록하세요.')
      if (mode === 'camera') startGuide()
    }
    if (mode === 'camera' && engine.current.registering) updateSetup('registering', (1 - engine.current.progress) * OBSERVATION_REFERENCE_MS)
    if (previousTime !== null && (frame.timeMs - previousTime > COMPARISON_POLICY.gapMs || receivedAt.current - previousReceive > COMPARISON_POLICY.gapMs)) { pauseGuide('tracking_lost'); appendTrace('interrupted', null, null) }
    advanceGuide()
    if (!activeRef.current) return
    if (mode === 'camera') {
      const guide = protocol.current.snapshot(performance.now()), step = guide.step
      const phase: ReplayPhase = setupRef.current.status !== 'idle' ? setupRef.current.status : guide.status === 'running' ? step?.phase ?? 'idle' : guide.status
      replay.current.append(frame, performance.now() - run.current.start, { phase, task: actionRef.current,
        round: step?.round ?? null, trial: step?.trial ?? null, attempt: guide.attempt, segment: segment.current, measurement: measuring(guide) })
    }
    const sample = engine.current.samples.at(-1)
    appendTrace('observation', Number.isFinite(frame.timeMs) ? frame.timeMs : null, sample?.values ?? null)
    publish(frame)
  }, [publish, appendTrace, mode, advanceGuide, pauseGuide, advanceSetup, startGuide, updateSetup])
  const stop = useCallback(() => {
    if (!activeRef.current && !active) return
    if (protocol.current.cancel(performance.now())) { appendTrace('protocol_cancelled', null, null); setGuide(protocol.current.snapshot(performance.now())) }
    token.current++; activeRef.current = null; setActive(false); cameraRef.current.stop()
    engine.current.registering = false; updateSetup('idle'); interrupt('stopped'); setNotice(mode === 'synthetic' ? '화면 예시를 종료했어요. 측정 자료는 수집하지 않았습니다.' : '측정을 종료했어요. 기존 자료를 보존했습니다. CSV를 내려받을 수 있어요.')
  }, [active, interrupt, mode, appendTrace, updateSetup])
  const startNow = useCallback((next: 'camera' | 'synthetic') => {
    if (next !== mode || activeRef.current) return
    cameraRef.current.stop(); resetExport(); const id = ++token.current
    engine.current.reset(); frameAt.current = null; receivedAt.current = performance.now(); selectedAt.current = 0
    actionRef.current = 'neutral'; setAction('neutral'); setSource(next); activeRef.current = next; setActive(true); publish(null)
    if (next === 'synthetic') { engine.current.beginReference(); setNotice('합성 예시의 기준을 등록하고 있어요. 실제 동작의 측정 결과가 아닙니다.') }
    else {
      updateSetup('connecting'); setNotice('카메라 연결 후 기준 등록 안내가 자동으로 시작됩니다.')
      void cameraRef.current.connect(undefined, { variant: 'heavy', delegate: 'auto', pacing: 'responsive' }).catch(() => {
        if (token.current === id) { activeRef.current = null; setActive(false); updateSetup('idle'); interrupt(); setNotice('카메라를 연결하지 못했어요. 권한과 장치 상태를 확인하세요.') }
      })
    }
  }, [interrupt, publish, resetExport, mode, updateSetup])
  useEffect(() => camera.subscribe(frame => { if (activeRef.current === 'camera') receive(frame) }), [camera.subscribe, receive])
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      advanceSetup()
      if (activeRef.current === 'synthetic') receive(comparisonDemo(performance.now(), actionRef.current))
      else if (performance.now() - receivedAt.current > COMPARISON_POLICY.gapMs) interrupt()
      else advanceGuide()
    }, 100)
    return () => clearInterval(timer)
  }, [active, receive, interrupt, advanceGuide, advanceSetup])
  useEffect(() => {
    const visibility = () => { if (document.visibilityState === 'hidden' && activeRef.current) { if (['connecting', 'preparing', 'registering'].includes(setupRef.current.status)) updateSetup('interrupted'); engine.current.registering = false; interrupt('hidden'); if (protocol.current.snapshot(performance.now()).status !== 'paused') setNotice('탭이 숨겨져 관측을 끊었어요. 진행 중이던 기준 등록은 다시 시작하세요.') } }
    document.addEventListener('visibilitychange', visibility)
    return () => { document.removeEventListener('visibilitychange', visibility); token.current++; cameraRef.current.stop() }
  }, [interrupt, updateSetup])
  useEffect(() => {
    if ((activeRef.current === 'camera' || (active && source === 'camera')) && (camera.state === 'error' || camera.state === 'off')) {
      engine.current.registering = false; interrupt()
      if (protocol.current.cancel(performance.now())) {
        appendTrace('protocol_cancelled', null, null); setGuide(protocol.current.snapshot(performance.now()))
      }
      if (!engine.current.reference) updateSetup('interrupted')
      // A disconnected stream requires a new connection, not just another registration timer.
      activeRef.current = null; setActive(false)
      setNotice('카메라 연결이 끊겼어요. 기존 자료를 보존했습니다. 카메라를 다시 켜 주세요.')
    }
  }, [camera.state, active, source, interrupt, updateSetup, appendTrace])
  const effectiveCaptures = captures === null ? {} : { ...automaticComparisonCaptures(trace.current), ...captures }
  const hasData = trace.current.length > 0 || Object.keys(captures ?? {}).length > 0 || replay.current.count > 0
  useEffect(() => {
    if (!hasData || typeof window === 'undefined') return
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [hasData])
  const guideLocked = locked(guide)
  const choose = (next: ComparisonAction) => { if (!guideLocked) { segment.current++; assignAction(next) } }
  const changeGuideMode = (next: GuideMode) => {
    if (locked(protocol.current.snapshot(performance.now()))) return
    modeRef.current = next; setGuideMode(next)
  }
  const changeGuidePlan = (next: GuidePlan) => {
    if (locked(protocol.current.snapshot(performance.now()))) return
    planRef.current = { ...next }; setGuidePlan(planRef.current)
  }
  const nextGuide = () => {
    if (!guideReady()) return
    const now = performance.now()
    finishGuideTransition(protocol.current.next(now), now)
  }
  const resumeGuide = () => {
    if (!guideReady()) { setNotice('현재 관측이 없어요. 얼굴과 양어깨·카메라 연결을 확인하세요.'); return }
    const now = performance.now()
    if (!protocol.current.resume(now)) return
    const snapshot = protocol.current.snapshot(now)
    segment.current++; guideAction(snapshot); appendTrace('protocol_phase_started', null, null, snapshot); setGuide(snapshot)
    setNotice('현재 단계를 처음부터 다시 셉니다. 이전 시도와 재개한 시도는 CSV에서 구분됩니다.')
  }
  const registerNow = () => {
    if (document.visibilityState === 'hidden') return
    // A protected re-registration has stopped the stream. Start it again only after confirmation.
    const restarting = !activeRef.current
    if (restarting) { startNow(mode); if (mode === 'synthetic') return }
    if (!restarting) resetExport()
    if (mode === 'synthetic') { engine.current.beginReference(); publish(null); setNotice('합성 예시의 기준을 다시 등록합니다. 실제 측정 자료는 모으지 않습니다.'); return }
    engine.current.reset(); assignAction('neutral')
    updateSetup('connecting'); publish(null); advanceSetup()
    setNotice('편안한 기준 자세를 잡고 준비되면 등록을 시작하세요.')
  }
  const capture = () => {
    if (mode !== 'camera' || !measuring(protocol.current.snapshot(performance.now()))) return
    if (!activeRef.current || document.visibilityState === 'hidden' || performance.now() - receivedAt.current > COMPARISON_POLICY.gapMs) { setNotice('현재 관측이 없어요. 추적을 확인해 주세요.'); return }
    const values = engine.current.capture(selectedAt.current)
    if (!values) { setNotice('선택한 동작에서 유효한 관측을 약 1초 이상 유지해 주세요.'); return }
    const end = engine.current.samples.at(-1)!.timeMs
    const window = engine.current.samples.filter(s => s.timeMs >= Math.max(selectedAt.current, end - COMPARISON_POLICY.captureMs))
    setCaptures(old => ({ ...old, [actionRef.current]: { values, elapsedMs: performance.now() - run.current.start, windowStartMs: window[0].timeMs, windowEndMs: end, sampleCount: window.length, segment: segment.current, guidance: protocol.current.snapshot(performance.now()) } })); setNotice('측정 구간의 최근 약 1초 중앙값을 비교표에 담았어요. 동작 안내는 수행 정답이 아닙니다.')
  }
  const requestReset = (kind: 'start' | 'register' | 'clear') => {
    if (hasData) {
      stop(); setPendingReset(kind); setNotice('기존 자료를 보존하고 측정을 멈췄어요. CSV를 내려받거나 취소해 자료를 유지하세요.'); return
    }
    if (kind === 'start') startNow(mode)
    else if (kind === 'register') registerNow()
    else setCaptures({})
  }
  const start = (next: 'camera' | 'synthetic') => {
    if (next !== mode) { setNotice('실제 측정과 화면 예시는 분리되어 있습니다. 기존 자료는 그대로 유지합니다.'); return }
    if (!activeRef.current) requestReset('start')
  }
  const register = () => { if (!activeRef.current) return; if (mode === 'camera') setPendingReset('register'); else if (!guideLocked) requestReset('register') }
  const clear = () => { if (Object.keys(effectiveCaptures).length) requestReset('clear') }
  const cancelReset = () => { setPendingReset(null); setNotice('초기화를 취소했어요. 기존 자료와 CSV는 그대로 유지합니다.') }
  const confirmReset = () => {
    const kind = pendingReset; setPendingReset(null)
    if (kind === 'start') startNow(mode)
    if (kind === 'register') { stop(); registerNow() }
    if (kind === 'clear') { setCaptures(null); setNotice('비교표만 비웠어요. 관측 시계열은 유지합니다.') }
  }
  const exportCsv = (kind: 'summary' | 'trace') => {
    if (mode !== 'camera') return
    if (kind === 'summary' ? !Object.keys(effectiveCaptures).length : !trace.current.length) return
    const context = { runId: run.current.runId, startedAt: run.current.startedAt, source, reference: exportReference.current, dropped: dropped.current }
    downloadComparisonCsv(kind, kind === 'summary' ? comparisonSummaryCsv(effectiveCaptures, context) : comparisonTraceCsv(trace.current, context), source)
  }
  const rows = Object.fromEntries(Object.entries(effectiveCaptures).map(([key, capture]) => [key, capture.values])) as Partial<Record<ComparisonAction, ComparisonValues>>
  return { ...view, source, active, action, notice, rows, replayCount: replay.current.count, replayDropped: replay.current.droppedFrames, getReplay, traceCount: trace.current.length, droppedRows: dropped.current, guide, guideLocked, guideMode, changeGuideMode, guidePlan, changeGuidePlan, setup, canStartReference: canStartReference && !pendingReset, startReference, measuring: measuring(guide), nextGuide, canGuide: mode === 'camera' && !pendingReset && guideReady(), startGuide, pauseGuide: () => pauseGuide('user'), resumeGuide, pendingReset, cancelReset, confirmReset, exportCsv, start, stop, choose, register, capture, clear }
}
