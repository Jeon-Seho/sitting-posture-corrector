import { useEffect, useRef, useState } from 'react'
import type { CameraController, CameraRuntimeOptions } from '../../hooks/useCamera'
import { readTrackingDiagnostics, resetTrackingDiagnostics } from '../mediapipe/trackingDiagnostics'
import { readPipelinePerformance, resetPipelinePerformance } from './pipelinePerformance'
import { runCameraBenchmark, type BenchmarkReport } from './cameraBenchmark'
import './performance.css'

type ProfileReport = {
  kind: 'live-pipeline-profile-v1'
  startedAt: string
  elapsedMs: number
  completed: boolean
  options: CameraRuntimeOptions
  tracker: CameraController['trackerDiagnostics']
  tracking: ReturnType<typeof readTrackingDiagnostics>
  pipeline: ReturnType<typeof readPipelinePerformance>
}
const ms = (value: number | null | undefined) => value == null ? '—' : `${value.toFixed(1)} ms`
const percent = (value: number | undefined) => value == null ? '—' : `${(value * 100).toFixed(1)}%`
const visibleDocument = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'

export default function DeveloperPerformance({ camera, active, options, onOptionsChange, onBusyChange }: {
  camera: CameraController
  active: boolean
  options: CameraRuntimeOptions
  onOptionsChange: (options: CameraRuntimeOptions) => void
  /** Prevent the parent starting a second camera while a comparison is using it. */
  onBusyChange?: (busy: boolean) => void
}) {
  const [profiling, setProfiling] = useState(false)
  const [remaining, setRemaining] = useState(20)
  const [profile, setProfile] = useState<ProfileReport | null>(null)
  const [benchmark, setBenchmark] = useState<BenchmarkReport | null>(null)
  const [benchmarking, setBenchmarking] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const profileStart = useRef<{ now: number; date: string; options: CameraRuntimeOptions } | null>(null)
  const profileRunning = useRef(false)
  const token = useRef(0)
  const mounted = useRef(true)
  const latest = useRef({ camera, active, onBusyChange })
  latest.current = { camera, active, onBusyChange }

  const snapshotProfile = (completed: boolean) => {
    const start = profileStart.current
    if (!start) return
    setProfile({ kind: 'live-pipeline-profile-v1', startedAt: start.date,
      elapsedMs: performance.now() - start.now, completed, options: start.options,
      tracker: latest.current.camera.trackerDiagnostics,
      tracking: readTrackingDiagnostics(), pipeline: readPipelinePerformance() })
  }
  const stopProfile = (completed: boolean) => {
    if (!profileRunning.current) return
    profileRunning.current = false
    snapshotProfile(completed)
    setProfiling(false)
  }
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; profileRunning.current = false; token.current++; latest.current.onBusyChange?.(false) }
  }, [])
  useEffect(() => {
    if (!profiling) return
    const tick = () => {
      if (!profileRunning.current) return
      // A resumed/delayed timer cannot turn a stopped or background interval
      // into a complete live sample just because wall time reached 20 seconds.
      if (!latest.current.active || latest.current.camera.state !== 'on' || !visibleDocument()) {
        stopProfile(false)
        return
      }
      const elapsed = performance.now() - profileStart.current!.now
      const complete = elapsed >= 20_000
      setRemaining(Math.max(0, Math.ceil((20_000 - elapsed) / 1000)))
      if (complete) stopProfile(true)
      else snapshotProfile(false)
    }
    const visibilityChanged = () => {
      if (!visibleDocument()) {
        stopProfile(false)
        setStatus('탭을 벗어나 성능 분석을 중단했습니다. 보이는 구간까지만 남겼습니다.')
      }
    }
    const interval = setInterval(tick, 250)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibilityChanged)
    return () => {
      clearInterval(interval)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibilityChanged)
    }
  }, [profiling])
  useEffect(() => {
    if (active && benchmarking) { token.current++; setStatus('현재 비교를 정리하고 있습니다.') }
  }, [active, benchmarking])

  const startProfile = () => {
    if (!active || camera.state !== 'on' || benchmarking || profileRunning.current || !visibleDocument()) return
    resetTrackingDiagnostics(); resetPipelinePerformance()
    profileStart.current = { now: performance.now(), date: new Date().toISOString(), options: { ...options } }
    profileRunning.current = true
    setRemaining(20); setProfile(null); setBenchmark(null); setStatus(''); setError(''); setProfiling(true)
  }
  const startBenchmark = async () => {
    if (active || benchmarking || camera.state === 'loading' || camera.state === 'on') return
    const current = ++token.current
    setError(''); setBenchmark(null); setStatus('동일한 입력으로 비교를 준비합니다.'); setBenchmarking(true)
    latest.current.onBusyChange?.(true)
    try {
      const result = await runCameraBenchmark({
        onProgress: message => { if (mounted.current && token.current === current) setStatus(message) },
        isCurrent: () => mounted.current && token.current === current && !latest.current.active,
        deviceId: camera.deviceId || undefined,
      })
      if (mounted.current && token.current === current) { setBenchmark(result); setStatus('모델 비교를 마쳤습니다.') }
    } catch (cause) {
      if (mounted.current && token.current === current) setError(cause instanceof Error ? cause.message : '모델 비교를 완료하지 못했습니다.')
    } finally {
      latest.current.onBusyChange?.(false)
      if (mounted.current) { setBenchmarking(false); if (token.current !== current) setStatus('모델 비교를 중단했습니다.') }
    }
  }
  const diagnostics = camera.trackerDiagnostics
  const tracking = profile?.tracking
  const rows = profile ? [
    ['MediaPipe 좌표 추출', tracking?.timing.inferenceWallMs.count, tracking?.timing.inferenceWallMs.p50, tracking?.timing.inferenceWallMs.p95],
    ['좌표 후처리 전체', profile.pipeline.cameraConsumer.samples, profile.pipeline.cameraConsumer.p50Ms, profile.pipeline.cameraConsumer.p95Ms],
    ['LSTM · 룰 계산', profile.pipeline.engineStep.samples, profile.pipeline.engineStep.p50Ms, profile.pipeline.engineStep.p95Ms],
    ['화면 상태 전달', profile.pipeline.publishScheduling.samples, profile.pipeline.publishScheduling.p50Ms, profile.pipeline.publishScheduling.p95Ms],
    ['React 렌더링 (paint 제외)', profile.pipeline.reactRender.samples, profile.pipeline.reactRender.p50Ms, profile.pipeline.reactRender.p95Ms],
    ['오버레이 그리기', tracking?.timing.drawMs.count, tracking?.timing.drawMs.p50, tracking?.timing.drawMs.p95],
    ['설정한 추론 간격', tracking?.timing.requestedIntervalMs.count, tracking?.timing.requestedIntervalMs.p50, tracking?.timing.requestedIntervalMs.p95],
    ['실제 프레임 간격', tracking?.timing.frameGapMs.count, tracking?.timing.frameGapMs.p50, tracking?.timing.frameGapMs.p95],
    ['추가 스케줄 지연', tracking?.timing.schedulingLatenessMs.count, tracking?.timing.schedulingLatenessMs.p50, tracking?.timing.schedulingLatenessMs.p95],
  ] as const : []
  const report = benchmark ?? profile
  const benchmarkRenderers = benchmark ? [...new Set(benchmark.results.flatMap(result => result.diagnostics?.graphics?.renderer ? [result.diagnostics.graphics.renderer] : []))] : []
  const locked = active || benchmarking || camera.state === 'loading' || camera.state === 'on'
  return <details className="lab-panel dp-performance"><summary><span>성능 측정 · 모델 비교</span><span className="dp-summary-state">{diagnostics ? `${diagnostics.variant.toUpperCase()} · ${diagnostics.actualDelegate}` : 'Lite · Full · Heavy'}</span></summary>
    <div className="dp-content">
      <p className="dp-intro">카메라 연결: {({ off: '꺼짐', loading: '준비 중', on: '연결됨', error: '오류' })[camera.state]}{camera.error ? ` · ${camera.error}` : ''}</p>
      <p className="dp-intro">추출 시간과 화면 처리 시간을 나눠 확인합니다. 모델 비교는 현재 측정을 종료한 뒤 실행합니다.</p>
      <div className="dp-options">
        <label>MediaPipe 모델<select aria-label="MediaPipe 모델" disabled={locked} value={options.variant ?? 'heavy'} onChange={event => onOptionsChange({ ...options, variant: event.target.value as CameraRuntimeOptions['variant'] })}><option value="lite">Lite</option><option value="full">Full</option><option value="heavy">Heavy</option></select></label>
        <label>추론 장치<select aria-label="추론 장치" disabled={locked} value={options.delegate ?? 'auto'} onChange={event => onOptionsChange({ ...options, delegate: event.target.value as CameraRuntimeOptions['delegate'] })}><option value="auto">GPU 우선 · 실패 시 CPU</option><option value="GPU">GPU</option><option value="CPU">CPU</option></select></label>
        <label>추론 간격<select aria-label="추론 간격" disabled={locked} value={options.pacing ?? 'legacy'} onChange={event => onOptionsChange({ ...options, pacing: event.target.value as CameraRuntimeOptions['pacing'] })}><option value="legacy">이전 방식 · 처리 시간의 2배</option><option value="responsive">단축 방식 · 처리 뒤 짧게 양보</option></select></label>
      </div>
      {diagnostics && <dl className="dp-device"><div><dt>실제 실행 경로</dt><dd>{diagnostics.actualDelegate}{diagnostics.fallbackReason && ' · GPU 초기화 실패 후 전환'}</dd></div><div><dt>그래픽 장치</dt><dd>{diagnostics.graphics?.renderer ?? '브라우저에서 장치 정보를 제공하지 않습니다.'}</dd></div>{diagnostics.graphics?.softwareRenderer && <div><dt>가속 상태</dt><dd>소프트웨어 렌더러가 감지되었습니다.</dd></div>}{diagnostics.fallbackReason && <div><dt>전환 이유</dt><dd>{diagnostics.fallbackReason}</dd></div>}</dl>}
      {!active && <p className="dp-benchmark-guide">비교를 시작하면 얼굴과 양어깨가 보이는 영상을 약 6초간 메모리에만 담습니다. 편하게 멈춘 상태를 유지해 주세요. 같은 프레임으로 Lite·Full·Heavy의 GPU/CPU를 비교한 뒤 촬영 자료를 해제합니다.</p>}
      <div className="dp-actions"><button type="button" className="lab-button" disabled={!active || camera.state !== 'on' || profiling || benchmarking} onClick={startProfile}>{profiling ? `${remaining}초 남음` : '현재 측정 20초 분석'}</button>
        {profiling && <button type="button" className="lab-button" onClick={() => stopProfile(false)}>여기까지 분석</button>}
        {!active && <button type="button" className="lab-button" disabled={locked || profiling} onClick={() => void startBenchmark()}>{benchmarking ? '모델 비교 중…' : 'Lite · Full · Heavy 비교'}</button>}
        {benchmarking && <button type="button" className="lab-button" onClick={() => { token.current++; setStatus('현재 비교를 정리하고 있습니다.') }}>비교 중단</button>}
      </div>
      {(profiling || status) && <p className="dp-status" role="status">{profiling ? `${remaining}초 동안 현재 동작을 계속해 주세요.` : status}</p>}
      {error && <p className="dp-error" role="alert">{error}</p>}
      {profile && <div className="dp-table-wrap"><table><caption>{(profile.elapsedMs / 1000).toFixed(1)}초 실측{profile.completed ? ' 완료' : profiling ? ' 중' : ' · 일부 구간'} · {profile.tracker?.variant.toUpperCase() ?? profile.options.variant ?? '모델 미확인'} / {profile.tracker?.actualDelegate ?? '장치 미확인'} · 중앙값 / 느린 쪽 5% 경계</caption><thead><tr><th scope="col">처리 단계</th><th scope="col">최근 표본</th><th scope="col">p50</th><th scope="col">p95</th></tr></thead><tbody>{rows.map(([label, count, p50, p95]) => <tr key={label}><th scope="row">{label}</th><td>{count ?? 0}</td><td>{ms(count ? p50 : null)}</td><td>{ms(count ? p95 : null)}</td></tr>)}</tbody></table></div>}
      {benchmark && <div className="dp-table-wrap"><table><caption>동일한 {benchmark.captureFrames}개 프레임 · {benchmark.rounds}회 비교 · 워밍업 제외</caption><thead><tr><th scope="col">모델 · 회차</th><th scope="col">실행 장치</th><th scope="col">p50</th><th scope="col">p95</th><th scope="col">13점 관측률</th><th scope="col">좌표 변화 p95</th></tr></thead><tbody>{benchmark.results.map((result, index) => <tr key={index}><th scope="row">{result.variant.toUpperCase()} · {result.round}회</th><td>{result.diagnostics?.actualDelegate ?? result.delegate}{result.error && <span className="dp-result-error">{result.error}</span>}</td><td>{ms(result.inference.count ? result.inference.p50 : null)}</td><td>{ms(result.inference.count ? result.inference.p95 : null)}</td><td>{percent(result.frames ? result.validRate : undefined)}</td><td>{percent(result.coordinateChange.count ? result.coordinateChange.p95 : undefined)}</td></tr>)}</tbody></table><p className="dp-footnote">13점 관측률은 측정 품질 통과율입니다. 좌표 변화에는 몸의 실제 움직임도 포함되며, 둘 다 자세 판정 정확도가 아닙니다.</p></div>}
      {benchmark && <p className="dp-renderer">비교에 사용한 그래픽 렌더러 · {benchmarkRenderers.length ? benchmarkRenderers.join(' / ') : '브라우저에서 장치 정보를 제공하지 않습니다.'}</p>}
      <p className="dp-footnote">표는 최근 카메라 300개·후처리 600개 표본의 통계입니다. 시간 통계만 보관합니다. 영상·좌표를 저장하지 않습니다. GPU 표시는 SDK 실행 경로이며 GPU 사용률 측정은 아닙니다. 후처리 전체에 LSTM·룰과 화면 상태 전달이 포함되므로 합산하지 마세요. React 렌더링은 개발 빌드에서 측정하며 브라우저의 최종 화면 그리기 시간은 제외합니다.</p>
      {report && <details className="dp-json"><summary>측정 결과 JSON</summary><textarea aria-label="성능 측정 결과 JSON" readOnly value={JSON.stringify(report, null, 2)} rows={10} spellCheck={false} /></details>}
    </div>
  </details>
}
