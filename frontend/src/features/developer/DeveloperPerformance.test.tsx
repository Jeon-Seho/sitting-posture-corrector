import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CameraController } from '../../hooks/useCamera'
import { beginTrackingDiagnostics } from '../mediapipe/trackingDiagnostics'
import { readPipelinePerformance, recordPipelineDuration, resetPipelinePerformance } from './pipelinePerformance'
import { runCameraBenchmark, type BenchmarkReport } from './cameraBenchmark'
import DeveloperPerformance from './DeveloperPerformance'

vi.mock('./cameraBenchmark', () => ({ runCameraBenchmark: vi.fn() }))
const report = (): BenchmarkReport => ({ schema: 'dev-camera-benchmark-v1', createdAt: 'synthetic-time', userAgent: 'synthetic browser',
  width: 640, height: 480, captureFrames: 24, captureDurationMs: 6000, warmupFrames: 4, rounds: 2, results: [], note: 'synthetic test only' })
const button = (renderer: ReactTestRenderer, text: string) => renderer.root.findAllByType('button').find(node => node.children.join('').includes(text))!

describe('developer performance controls and bounded capture lifecycle', () => {
  let renderer: ReactTestRenderer | undefined
  let camera: CameraController
  let visibility: string
  let visibilityListeners: Set<() => void>
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(0)
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
    vi.mocked(runCameraBenchmark).mockReset()
    resetPipelinePerformance()
    visibility = 'visible'; visibilityListeners = new Set()
    vi.stubGlobal('document', {
      get visibilityState() { return visibility },
      addEventListener: vi.fn((name: string, listener: () => void) => { if (name === 'visibilitychange') visibilityListeners.add(listener) }),
      removeEventListener: vi.fn((name: string, listener: () => void) => { if (name === 'visibilitychange') visibilityListeners.delete(listener) }),
    })
    camera = { state: 'off', deviceId: '', trackerDiagnostics: null } as CameraController
  })
  afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
  const profileResult = () => JSON.parse(renderer!.root.findByProps({ 'aria-label': '성능 측정 결과 JSON' }).props.value)

  it('does not request a camera implicitly and only changes model settings while inactive', () => {
    const options = { variant: 'heavy' as const, delegate: 'auto' as const, pacing: 'legacy' as const }
    const onOptionsChange = vi.fn()
    act(() => { renderer = create(<DeveloperPerformance camera={camera} active={false} options={options} onOptionsChange={onOptionsChange} />) })
    expect(runCameraBenchmark).not.toHaveBeenCalled()
    expect(button(renderer!, '20초 분석').props.disabled).toBe(true)
    act(() => renderer!.root.findByProps({ 'aria-label': 'MediaPipe 모델' }).props.onChange({ target: { value: 'full' } }))
    expect(onOptionsChange).toHaveBeenCalledWith({ ...options, variant: 'full' })
    act(() => { renderer!.update(<DeveloperPerformance camera={{ ...camera, state: 'on' }} active options={options} onOptionsChange={onOptionsChange} />) })
    expect(renderer!.root.findAllByType('select').every(node => node.props.disabled)).toBe(true)
    expect(renderer!.root.findAllByType('button').some(node => node.children.join('').includes('Lite · Full'))).toBe(false)
  })

  it('resets diagnostics only on explicit analysis and stops with a JSON summary after 20 seconds', () => {
    const tracking = beginTrackingDiagnostics('GPU', 'legacy')
    recordPipelineDuration('engineStep', 999)
    camera.state = 'on'
    act(() => { renderer = create(<DeveloperPerformance camera={camera} active options={{}} onOptionsChange={vi.fn()} />) })
    expect(readPipelinePerformance().engineStep.count).toBe(1)
    act(() => button(renderer!, '20초 분석').props.onClick())
    expect(readPipelinePerformance().engineStep.count).toBe(0)
    recordPipelineDuration('engineStep', 7)
    tracking.record('inferenceWallMs', 31); tracking.frame()
    act(() => { vi.advanceTimersByTime(20_000) })
    const result = JSON.parse(renderer!.root.findByProps({ 'aria-label': '성능 측정 결과 JSON' }).props.value)
    expect(result).toMatchObject({ kind: 'live-pipeline-profile-v1', elapsedMs: 20_000, completed: true,
      pipeline: { engineStep: { count: 1, p95Ms: 7 } }, tracking: { delegate: 'GPU', frames: 1 } })
    expect(button(renderer!, '20초 분석').props.disabled).toBe(false)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(JSON.parse(renderer!.root.findByProps({ 'aria-label': '성능 측정 결과 JSON' }).props.value).elapsedMs).toBe(20_000)
  })

  it('keeps other camera controls locked until canceled benchmark cleanup completes', async () => {
    let resolve!: (value: BenchmarkReport) => void
    vi.mocked(runCameraBenchmark).mockReturnValue(new Promise(done => { resolve = done }))
    const onBusyChange = vi.fn()
    act(() => { renderer = create(<DeveloperPerformance camera={camera} active={false} options={{}} onOptionsChange={vi.fn()} onBusyChange={onBusyChange} />) })
    act(() => button(renderer!, 'Lite · Full').props.onClick())
    const benchmarkOptions = vi.mocked(runCameraBenchmark).mock.calls[0][0]
    expect(onBusyChange).toHaveBeenLastCalledWith(true)
    expect(benchmarkOptions.isCurrent()).toBe(true)
    act(() => button(renderer!, '비교 중단').props.onClick())
    expect(benchmarkOptions.isCurrent()).toBe(false)
    expect(onBusyChange).toHaveBeenLastCalledWith(true)
    expect(renderer!.root.findAllByType('select').every(node => node.props.disabled)).toBe(true)
    await act(async () => resolve(report()))
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
    expect(renderer!.root.findAllByType('textarea')).toHaveLength(0)
    expect(JSON.stringify(renderer!.toJSON())).toContain('모델 비교를 중단했습니다.')
  })

  it('refuses to start in a hidden document without resetting existing diagnostics', () => {
    camera.state = 'on'; visibility = 'hidden'
    recordPipelineDuration('engineStep', 7)
    act(() => { renderer = create(<DeveloperPerformance camera={camera} active options={{}} onOptionsChange={vi.fn()} />) })
    act(() => button(renderer!, '20초 분석').props.onClick())
    expect(readPipelinePerformance().engineStep.count).toBe(1)
    expect(renderer!.root.findAllByType('textarea')).toHaveLength(0)
    expect(visibilityListeners.size).toBe(0)
  })

  it('freezes an immediate partial snapshot when hidden and does not resume it as complete', () => {
    camera.state = 'on'
    act(() => { renderer = create(<DeveloperPerformance camera={camera} active options={{}} onOptionsChange={vi.fn()} />) })
    act(() => button(renderer!, '20초 분석').props.onClick())
    recordPipelineDuration('engineStep', 7)
    act(() => { vi.advanceTimersByTime(5_125) })
    act(() => { visibility = 'hidden'; visibilityListeners.forEach(listener => listener()) })
    expect(profileResult()).toMatchObject({ elapsedMs: 5_125, completed: false, pipeline: { engineStep: { count: 1 } } })
    expect(visibilityListeners.size).toBe(0)
    recordPipelineDuration('engineStep', 999)
    act(() => { vi.advanceTimersByTime(20_000); visibility = 'visible'; visibilityListeners.forEach(listener => listener()) })
    expect(profileResult()).toMatchObject({ elapsedMs: 5_125, completed: false, pipeline: { engineStep: { count: 1 } } })
    expect(button(renderer!, '20초 분석').props.disabled).toBe(false)
  })

  it.each(['camera off', 'session inactive'])('keeps the report partial if %s at the 20-second completion boundary', reason => {
    camera.state = 'on'
    act(() => { renderer = create(<DeveloperPerformance camera={camera} active options={{}} onOptionsChange={vi.fn()} />) })
    act(() => button(renderer!, '20초 분석').props.onClick())
    act(() => { vi.advanceTimersByTime(19_750) })
    if (reason === 'camera off') camera = { ...camera, state: 'off' }
    act(() => { renderer!.update(<DeveloperPerformance camera={camera} active={reason !== 'session inactive'} options={{}} onOptionsChange={vi.fn()} />) })
    act(() => { vi.advanceTimersByTime(250) })
    expect(profileResult()).toMatchObject({ elapsedMs: 20_000, completed: false })
    expect(visibilityListeners.size).toBe(0)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(profileResult().elapsedMs).toBe(20_000)
  })

  it('checks current visibility before completing even if a visibility event was missed', () => {
    camera.state = 'on'
    act(() => { renderer = create(<DeveloperPerformance camera={camera} active options={{}} onOptionsChange={vi.fn()} />) })
    act(() => button(renderer!, '20초 분석').props.onClick())
    act(() => { vi.advanceTimersByTime(19_750) })
    visibility = 'hidden'
    act(() => { vi.advanceTimersByTime(250) })
    expect(profileResult()).toMatchObject({ elapsedMs: 20_000, completed: false })
  })

  it('manual partial completion freezes the snapshot and releases its timer and visibility listener', () => {
    camera.state = 'on'
    act(() => { renderer = create(<DeveloperPerformance camera={camera} active options={{}} onOptionsChange={vi.fn()} />) })
    act(() => button(renderer!, '20초 분석').props.onClick())
    act(() => { vi.advanceTimersByTime(2_125) })
    act(() => button(renderer!, '여기까지 분석').props.onClick())
    expect(profileResult()).toMatchObject({ elapsedMs: 2_125, completed: false })
    expect(visibilityListeners.size).toBe(0)
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(profileResult()).toMatchObject({ elapsedMs: 2_125, completed: false })
  })

  it('labels the bounded percentile window separately from lifetime counts in the export', () => {
    camera.state = 'on'
    act(() => { renderer = create(<DeveloperPerformance camera={camera} active options={{}} onOptionsChange={vi.fn()} />) })
    act(() => button(renderer!, '20초 분석').props.onClick())
    for (let i = 0; i < 620; i++) recordPipelineDuration('engineStep', i < 20 ? 900 : 2)
    act(() => { vi.advanceTimersByTime(20_000) })
    const result = JSON.parse(renderer!.root.findByProps({ 'aria-label': '성능 측정 결과 JSON' }).props.value)
    expect(result.pipeline.engineStep).toMatchObject({ count: 620, samples: 600, p50Ms: 2, p95Ms: 2 })
    const row = renderer!.root.findAllByType('tr').find(node => node.findAllByType('th').some(th => th.children.join('') === 'LSTM · 룰 계산'))!
    expect(row.findAllByType('td')[0].children.join('')).toBe('600')
  })

  it('cancels in-flight benchmark on unmount and never publishes late results', async () => {
    let resolve!: (value: BenchmarkReport) => void
    vi.mocked(runCameraBenchmark).mockReturnValue(new Promise(done => { resolve = done }))
    const onBusyChange = vi.fn()
    act(() => { renderer = create(<DeveloperPerformance camera={camera} active={false} options={{}} onOptionsChange={vi.fn()} onBusyChange={onBusyChange} />) })
    act(() => button(renderer!, 'Lite · Full').props.onClick())
    const isCurrent = vi.mocked(runCameraBenchmark).mock.calls[0][0].isCurrent
    act(() => renderer!.unmount()); renderer = undefined
    expect(isCurrent()).toBe(false)
    await act(async () => resolve(report()))
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
  })
})
