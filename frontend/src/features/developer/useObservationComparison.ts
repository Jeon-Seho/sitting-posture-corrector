import { useCallback, useEffect, useRef, useState } from 'react'
import { ObservationComparison, COMPARISON_POLICY, type ComparisonFrame, type ComparisonValues } from '../../../../model/prototype/observationComparison'
import type { CameraController } from '../../hooks/useCamera'
import { comparisonDemo, type ComparisonAction } from './comparisonDemo'
import { COMPARISON_TRACE_LIMIT, comparisonSummaryCsv, comparisonTraceCsv, downloadComparisonCsv, type ComparisonCapture, type ComparisonTrace } from './observationCsv'
import { ObservationProtocol, type GuidePauseReason, type GuideSnapshot } from './observationProtocol'

export function useObservationComparison(camera: CameraController, mode: 'camera' | 'synthetic' = 'camera') {
  const engine = useRef(new ObservationComparison())
  const cameraRef = useRef(camera); cameraRef.current = camera
  const activeRef = useRef<'camera' | 'synthetic' | null>(null)
  const actionRef = useRef<ComparisonAction>('neutral')
  const selectedAt = useRef(0), receivedAt = useRef(0), frameAt = useRef<number | null>(null), token = useRef(0)
  const [source, setSource] = useState<'camera' | 'synthetic'>(mode)
  const [active, setActive] = useState(false)
  const [action, setAction] = useState<ComparisonAction>('neutral')
  const [notice, setNotice] = useState(mode === 'synthetic' ? '가상 점으로 화면 표시만 확인합니다. 실제 측정 자료를 모으지 않습니다.' : '카메라를 켠 다음 기준 자세를 등록하세요.')
  const [captures, setCaptures] = useState<Partial<Record<ComparisonAction, ComparisonCapture>>>({})
  const protocol = useRef(new ObservationProtocol()), guideSequence = useRef(0)
  const [guide, setGuide] = useState(() => protocol.current.snapshot(0))
  const trace = useRef<ComparisonTrace[]>([]), dropped = useRef(0), segment = useRef(0)
  const exportReference = useRef<ObservationComparison['reference']>(null)
  const [pendingReset, setPendingReset] = useState<'start' | 'register' | 'clear' | null>(null)
  const run = useRef({ runId: '', startedAt: '', start: 0 })
  const resetExport = useCallback(() => {
    trace.current = []; dropped.current = 0; segment.current = 0
    exportReference.current = null
    protocol.current = new ObservationProtocol(); guideSequence.current = 0; setGuide(protocol.current.snapshot(0))
    run.current = { runId: `${Date.now()}-${++token.current}`, startedAt: new Date().toISOString(), start: performance.now() }
    setCaptures({})
  }, [])
  const appendTrace = useCallback((event: ComparisonTrace['event'], observationTimeMs: number | null, values: ComparisonValues | null, guidance = protocol.current.snapshot(performance.now())) => {
    if (mode !== 'camera' || !(engine.current.reference || exportReference.current)) return
    if (event === 'interrupted' && trace.current.at(-1)?.event === 'interrupted') return
    const current = event === 'observation' ? engine.current.current : null
    trace.current.push({ elapsedMs: performance.now() - run.current.start, observationTimeMs, action: actionRef.current, segment: segment.current, event, status: !values ? 'unmeasurable' : values.relativeZ === null ? 'depth_unavailable' : 'measured', imageValid: !!current?.image, worldValid: !!current?.world, values, zMeters: current?.world?.relativeZ ?? null, guidance: guidance.step ? guidance : null })
    if (trace.current.length > COMPARISON_TRACE_LIMIT) { trace.current.shift(); dropped.current++ }
  }, [mode])
  const [view, setView] = useState(() => ({ current: engine.current.current, reference: engine.current.reference, samples: engine.current.samples, registering: false, progress: 0, frame: null as ComparisonFrame | null }))
  const publish = useCallback((frame?: ComparisonFrame | null) => setView(old => ({ current: engine.current.current, reference: engine.current.reference, samples: [...engine.current.samples], registering: engine.current.registering, progress: engine.current.progress, frame: frame === undefined ? old.frame : frame })), [])
  const assignAction = useCallback((next: ComparisonAction) => { actionRef.current = next; setAction(next); selectedAt.current = frameAt.current ?? 0 }, [])
  const guideAction = useCallback((snapshot: GuideSnapshot) => {
    if (snapshot.step) assignAction(snapshot.step.phase === 'return' ? 'neutral' : snapshot.step.action)
  }, [assignAction])
  const recordPause = useCallback(() => {
    const snapshot = protocol.current.snapshot(performance.now())
    appendTrace('protocol_paused', null, null, snapshot); segment.current++; setGuide(snapshot)
    setNotice('자동 안내를 일시 정지했어요. 아래 동작 안내와 추적을 확인한 뒤 재개하면 현재 단계를 처음부터 다시 셉니다. 기존 구간은 보존합니다.')
  }, [appendTrace])
  const pauseGuide = useCallback((reason: GuidePauseReason) => {
    if (protocol.current.pause(reason)) recordPause()
  }, [recordPause])
  const interrupt = useCallback((event: ComparisonTrace['event'] = 'interrupted') => {
    pauseGuide(event === 'hidden' ? 'hidden' : 'tracking_lost')
    engine.current.interrupt(frameAt.current ?? 0); appendTrace(event, null, null); publish(null)
  }, [publish, appendTrace, pauseGuide])
  const guideReady = useCallback(() => activeRef.current === 'camera' && cameraRef.current.state === 'on' && document.visibilityState !== 'hidden' && !engine.current.registering && !!engine.current.reference && !!engine.current.current?.image && performance.now() - receivedAt.current <= COMPARISON_POLICY.gapMs, [])
  const advanceGuide = useCallback(() => {
    const now = performance.now(), before = protocol.current.snapshot(now)
    if (before.status !== 'running') return
    if (!guideReady()) { pauseGuide('tracking_lost'); return }
    const result = protocol.current.advance(now)
    if (result === 'paused') { recordPause(); return }
    if (result === 'phase' || result === 'completed') appendTrace('protocol_phase_completed', null, null, before)
    const next = protocol.current.snapshot(now)
    if (result === 'phase') { segment.current++; guideAction(next); appendTrace('protocol_phase_started', null, null, next) }
    setGuide(next)
    if (result === 'completed') {
      appendTrace('protocol_completed', null, null, next)
      token.current++; activeRef.current = null; setActive(false); cameraRef.current.stop()
      engine.current.registering = false; interrupt('stopped')
      setNotice('네 동작씩 3바퀴 안내를 마쳤어요. 카메라를 끄고 자료를 보존했습니다. 관측 시계열 CSV를 내려받으세요. 실제 수행을 자동 확인한 결과는 아닙니다.')
    }
  }, [appendTrace, guideAction, guideReady, interrupt, pauseGuide, recordPause])
  const receive = useCallback((frame: ComparisonFrame) => {
    if (!activeRef.current || document.visibilityState === 'hidden') return
    if (frameAt.current !== null && frame.timeMs > frameAt.current && frame.timeMs - frameAt.current < 100) return
    const previousReceive = receivedAt.current
    receivedAt.current = performance.now()
    const before = engine.current.reference, previousTime = frameAt.current
    engine.current.accept(frame); frameAt.current = frame.timeMs
    if (before && !engine.current.reference) {
      // Do not erase the previous buffer or export it against the new extraction context.
      if (protocol.current.cancel(performance.now())) { appendTrace('protocol_cancelled', null, null); setGuide(protocol.current.snapshot(performance.now())) }
      token.current++; activeRef.current = null; setActive(false); cameraRef.current.stop()
      publish(null); setNotice('영상 크기 또는 추출 모델이 바뀌어 측정을 멈췄어요. 기존 자료는 보존했습니다. CSV를 내려받은 뒤 새 기준을 등록하세요.'); return
    }
    if (!before && engine.current.reference) {
      exportReference.current = engine.current.reference
      setNotice(mode === 'synthetic' ? '화면 조작 예시입니다. 수집·비교표 저장·CSV 다운로드는 하지 않습니다.' : engine.current.reference.world ? '기준 등록 완료. 기준 자세에서 3바퀴 자동 안내를 시작하세요.' : '2D 기준만 등록했어요. z 기준이 필요하면 추적을 확인하고 다시 등록하세요.')
    }
    if (previousTime !== null && (frame.timeMs - previousTime > COMPARISON_POLICY.gapMs || receivedAt.current - previousReceive > COMPARISON_POLICY.gapMs)) { pauseGuide('tracking_lost'); appendTrace('interrupted', null, null) }
    advanceGuide()
    if (!activeRef.current) return
    const sample = engine.current.samples.at(-1)
    appendTrace('observation', Number.isFinite(frame.timeMs) ? frame.timeMs : null, sample?.values ?? null)
    publish(frame)
  }, [publish, appendTrace, mode, advanceGuide, pauseGuide])
  const stop = useCallback(() => {
    if (!activeRef.current) return
    if (protocol.current.cancel(performance.now())) { appendTrace('protocol_cancelled', null, null); setGuide(protocol.current.snapshot(performance.now())) }
    token.current++; activeRef.current = null; setActive(false); cameraRef.current.stop()
    engine.current.registering = false; interrupt('stopped'); setNotice(mode === 'synthetic' ? '화면 예시를 종료했어요. 측정 자료는 수집하지 않았습니다.' : '측정을 종료했어요. 기존 자료를 보존했습니다. CSV를 내려받을 수 있어요.')
  }, [interrupt, mode, appendTrace])
  const startNow = useCallback((next: 'camera' | 'synthetic') => {
    if (next !== mode || activeRef.current) return
    cameraRef.current.stop(); resetExport(); const id = ++token.current
    engine.current.reset(); frameAt.current = null; receivedAt.current = performance.now(); selectedAt.current = 0
    actionRef.current = 'neutral'; setAction('neutral'); setSource(next); activeRef.current = next; setActive(true); publish(null)
    if (next === 'synthetic') { engine.current.beginReference(); setNotice('합성 예시의 기준을 등록하고 있어요. 실제 동작의 측정 결과가 아닙니다.') }
    else {
      setNotice('카메라 연결 후 기준 2초 등록을 눌러 주세요.')
      void cameraRef.current.connect(undefined, { variant: 'full', delegate: 'auto', pacing: 'responsive' }).catch(() => {
        if (token.current === id) { activeRef.current = null; setActive(false); interrupt(); setNotice('카메라를 연결하지 못했어요. 권한과 장치 상태를 확인하세요.') }
      })
    }
  }, [interrupt, publish, resetExport, mode])
  useEffect(() => camera.subscribe(frame => { if (activeRef.current === 'camera') receive(frame) }), [camera.subscribe, receive])
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      if (activeRef.current === 'synthetic') receive(comparisonDemo(performance.now(), actionRef.current))
      else if (performance.now() - receivedAt.current > COMPARISON_POLICY.gapMs) interrupt()
      else advanceGuide()
    }, 100)
    return () => clearInterval(timer)
  }, [active, receive, interrupt, advanceGuide])
  useEffect(() => {
    const visibility = () => { if (document.visibilityState === 'hidden' && activeRef.current) { engine.current.registering = false; interrupt('hidden'); if (protocol.current.snapshot(performance.now()).status !== 'paused') setNotice('탭이 숨겨져 관측을 끊었어요. 진행 중이던 기준 등록은 다시 시작하세요.') } }
    document.addEventListener('visibilitychange', visibility)
    return () => { document.removeEventListener('visibilitychange', visibility); token.current++; activeRef.current = null; cameraRef.current.stop() }
  }, [interrupt])
  useEffect(() => {
    if (activeRef.current === 'camera' && (camera.state === 'error' || camera.state === 'off')) {
      engine.current.registering = false; interrupt()
    }
  }, [camera.state, interrupt])
  const hasData = trace.current.length > 0 || Object.keys(captures).length > 0
  useEffect(() => {
    if (!hasData || typeof window === 'undefined') return
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [hasData])
  const guideLocked = guide.status === 'running' || guide.status === 'paused'
  const choose = (next: ComparisonAction) => { if (!guideLocked) { segment.current++; assignAction(next) } }
  const startGuide = () => {
    if (mode !== 'camera' || guideLocked || pendingReset || !guideReady()) return
    const now = performance.now()
    if (!protocol.current.start(now, `${run.current.runId}-guide-${++guideSequence.current}`)) return
    const snapshot = protocol.current.snapshot(now)
    segment.current++; guideAction(snapshot); appendTrace('protocol_phase_started', null, null, snapshot); setGuide(snapshot)
    setNotice('3바퀴 자동 안내를 시작했어요. 표시된 동작과 시간을 따라 주세요. 수행 여부를 판정하지 않으며 CSV에는 안내 구간이 기록됩니다.')
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
    engine.current.beginReference(); if (!restarting) resetExport(); choose('neutral'); publish(null); setNotice('정면에서 편안한 자세를 2초 유지하세요. 추적이 끊기면 수집을 다시 시작해요.')
  }
  const capture = () => {
    if (mode !== 'camera' || guideLocked) return
    if (!activeRef.current || document.visibilityState === 'hidden' || performance.now() - receivedAt.current > COMPARISON_POLICY.gapMs) { setNotice('현재 관측이 없어요. 추적을 확인해 주세요.'); return }
    const values = engine.current.capture(selectedAt.current)
    if (!values) { setNotice('선택한 동작에서 유효한 관측을 약 1초 이상 유지해 주세요.'); return }
    const end = engine.current.samples.at(-1)!.timeMs
    const window = engine.current.samples.filter(s => s.timeMs >= Math.max(selectedAt.current, end - COMPARISON_POLICY.captureMs))
    setCaptures(old => ({ ...old, [actionRef.current]: { values, elapsedMs: performance.now() - run.current.start, windowStartMs: window[0].timeMs, windowEndMs: end, sampleCount: window.length, segment: segment.current } })); setNotice('최근 약 1초 중앙값을 비교표에 담았어요. 동작은 직접 선택한 수행 표식입니다.')
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
  const register = () => { if (activeRef.current && !guideLocked) requestReset('register') }
  const clear = () => { if (Object.keys(captures).length) requestReset('clear') }
  const cancelReset = () => { setPendingReset(null); setNotice('초기화를 취소했어요. 기존 자료와 CSV는 그대로 유지합니다.') }
  const confirmReset = () => {
    const kind = pendingReset; setPendingReset(null)
    if (kind === 'start') startNow(mode)
    if (kind === 'register') registerNow()
    if (kind === 'clear') { setCaptures({}); setNotice('비교표만 비웠어요. 관측 시계열은 유지합니다.') }
  }
  const exportCsv = (kind: 'summary' | 'trace') => {
    if (mode !== 'camera') return
    if (kind === 'summary' ? !Object.keys(captures).length : !trace.current.length) return
    const context = { runId: run.current.runId, startedAt: run.current.startedAt, source, reference: exportReference.current, dropped: dropped.current }
    downloadComparisonCsv(kind, kind === 'summary' ? comparisonSummaryCsv(captures, context) : comparisonTraceCsv(trace.current, context), source)
  }
  const rows = Object.fromEntries(Object.entries(captures).map(([key, capture]) => [key, capture.values])) as Partial<Record<ComparisonAction, ComparisonValues>>
  return { ...view, source, active, action, notice, rows, traceCount: trace.current.length, droppedRows: dropped.current, guide, guideLocked, canGuide: mode === 'camera' && !pendingReset && guideReady(), startGuide, pauseGuide: () => pauseGuide('user'), resumeGuide, pendingReset, cancelReset, confirmReset, exportCsv, start, stop, choose, register, capture, clear }
}
