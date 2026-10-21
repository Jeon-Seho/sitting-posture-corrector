import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { CameraController, Observation } from '../../hooks/useCamera'
import { useObservationComparison } from './useObservationComparison'
import ObservationLab from './ObservationLab'
import { comparisonDemo } from './comparisonDemo'
import { downloadComparisonCsv, COMPARISON_TRACE_LIMIT } from './observationCsv'
vi.mock('./observationCsv', async importOriginal => ({ ...await importOriginal<typeof import('./observationCsv')>(), downloadComparisonCsv: vi.fn() }))

describe('comparison UI lifecycle with explicit synthetic observations', () => {
  let camera: CameraController, listener: (frame: Observation) => void, renderer: ReactTestRenderer
  let current: ReturnType<typeof useObservationComparison>, wall = 0, doc: EventTarget & { visibilityState: string; title: string }, win: EventTarget
  const unsubscribe = vi.fn()
  function Probe() { current = useObservationComparison(camera); return null }
  function DemoProbe() { current = useObservationComparison(camera, 'synthetic'); return null }
  const emit = (t: number, action: Parameters<typeof comparisonDemo>[1] = 'neutral') => { wall = t; act(() => listener({ ...comparisonDemo(t, action), features: null, inferenceMs: 1, delegate: 'CPU', videoTimeMs: t })) }
  const mount = () => act(() => { renderer = create(<Probe />) })
  const exportRows = () => {
    act(() => current.exportCsv('trace'))
    // These explicit synthetic fixtures contain no commas/newlines within cells.
    const [header, ...lines] = vi.mocked(downloadComparisonCsv).mock.calls.at(-1)![1].slice(1).trimEnd().split('\r\n')
    return lines.map(line => Object.fromEntries(header.split(',').map((key, i) => [key, line.split(',')[i].replace(/^"(.*)"$/, '$1')])))
  }
  const register = () => {
    act(() => current.start('camera')); act(() => current.register())
    for (let t = 0; t <= 2000; t += 100) emit(t)
  }
  beforeEach(() => {
    vi.mocked(downloadComparisonCsv).mockClear()
    wall = 0; vi.useFakeTimers(); vi.spyOn(performance, 'now').mockImplementation(() => wall)
    doc = Object.assign(new EventTarget(), { visibilityState: 'visible', title: 'test' }); vi.stubGlobal('document', doc)
    win = new EventTarget(); vi.stubGlobal('window', win)
    camera = { subscribe: vi.fn(fn => { listener = fn; return unsubscribe }), connect: vi.fn().mockResolvedValue(undefined), stop: vi.fn(), state: 'on', error: '', videoRef: { current: null }, streamRef: { current: null } } as unknown as CameraController
  })
  afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); unsubscribe.mockClear() })
  it('opens without activating camera or creating a saved baseline', () => {
    act(() => { renderer = create(<ObservationLab camera={camera} />) })
    expect(camera.connect).not.toHaveBeenCalled()
    expect(downloadComparisonCsv).not.toHaveBeenCalled()
    expect(JSON.stringify(renderer.toJSON())).toContain('기준 2초 등록')
    expect(renderer.root.findAllByProps({ 'aria-pressed': true })).toHaveLength(1)
  })
  it('focuses the combined camera/instruction area once on guidance start, without jumping on frames or resume', () => {
    const scrollIntoView = vi.fn(), focus = vi.fn()
    act(() => { renderer = create(<ObservationLab camera={camera} />, { createNodeMock: element => element.props['aria-label'] === '카메라와 동작 안내' ? { scrollIntoView, focus } : null }) })
    const click = (label: string) => act(() => renderer.root.findAllByType('button').find(button => button.props.children === label)!.props.onClick())
    click('카메라 켜기'); click('기준 2초 등록')
    for (let t = 0; t <= 2000; t += 100) emit(t)
    expect(scrollIntoView).not.toHaveBeenCalled(); expect(focus).not.toHaveBeenCalled()
    click('3바퀴 자동 안내 시작')
    expect(scrollIntoView).toHaveBeenCalledOnce(); expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    for (let t = 2100; t <= 3100; t += 100) emit(t, 'head')
    click('잠깐 멈춤'); emit(3200, 'head'); click('현재 단계 처음부터 재개')
    expect(scrollIntoView).toHaveBeenCalledOnce(); expect(focus).toHaveBeenCalledOnce()
  })
  it('keeps action-specific data until re-registration is explicitly confirmed', () => {
    mount(); register(); expect(current.reference).not.toBeNull()
    act(() => current.choose('head'))
    for (let t = 2100; t <= 3200; t += 100) emit(t, 'head')
    act(() => current.capture()); expect(current.rows.head!.relativeZ).toBeCloseTo(-20)
    act(() => current.choose('bow')); act(() => current.capture()); expect(current.rows.bow).toBeUndefined()
    act(() => current.register()); expect(current.pendingReset).toBe('register'); expect(current.rows.head).toBeDefined()
    act(() => current.confirmReset()); expect(current.rows).toEqual({}); expect(current.reference).toBeNull()
  })
  it('removes stale values and blocks stale capture after a raw stream stops', () => {
    mount(); register(); wall = 2700
    act(() => { vi.advanceTimersByTime(600) })
    expect(current.current).toBeNull()
    act(() => current.capture()); expect(current.rows.neutral).toBeUndefined()
    expect(current.notice).toContain('현재 관측이 없어요')
  })
  it('interrupts hidden-tab registration, stops camera and unsubscribes on unmount', () => {
    mount(); register(); act(() => current.register()); act(() => current.confirmReset())
    act(() => { doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')) })
    expect(current.registering).toBe(false); expect(current.current).toBeNull()
    const stop = camera.stop as ReturnType<typeof vi.fn>; stop.mockClear()
    act(() => renderer.unmount()); expect(stop).toHaveBeenCalledOnce(); expect(unsubscribe).toHaveBeenCalledOnce()
  })
  it('preserves data and its original export baseline while stopping on extractor change', () => {
    mount(); register()
    wall = 2100; act(() => listener({ ...comparisonDemo(2100, 'head'), worldLandmarks: [], features: null, inferenceMs: 1, delegate: 'CPU', videoTimeMs: 2100 }))
    expect(current.current!.image).not.toBeNull(); expect(current.current!.world).toBeNull()
    const retained = current.traceCount
    wall = 2200; act(() => listener({ ...comparisonDemo(2200, 'head'), poseModelId: 'different-extractor', features: null, inferenceMs: 1, delegate: 'CPU', videoTimeMs: 2200 }))
    expect(current.reference).toBeNull(); expect(current.rows).toEqual({})
    expect(current.traceCount).toBe(retained); expect(current.active).toBe(false)
    act(() => current.exportCsv('trace'))
    const csv = vi.mocked(downloadComparisonCsv).mock.calls.at(-1)![1]
    expect(csv).toContain('explicit-synthetic-illustration:640x480'); expect(csv).not.toContain('different-extractor')
  })
  it('exports selected-action snapshots and independent traces only on demand, including stop events', () => {
    mount(); register(); act(() => current.choose('head'))
    for (let t = 2100; t <= 3200; t += 100) emit(t, 'head')
    act(() => current.capture()); expect(downloadComparisonCsv).not.toHaveBeenCalled()
    act(() => current.exportCsv('summary'))
    expect(downloadComparisonCsv).toHaveBeenLastCalledWith('summary', expect.stringContaining('"head","머리 앞으로 내밀기",2,3200,2200,3200,11,'), 'camera')
    act(() => current.choose('body')); emit(3300, 'body'); act(() => current.stop())
    act(() => current.exportCsv('trace'))
    const trace = vi.mocked(downloadComparisonCsv).mock.calls.at(-1)![1]
    expect(trace).toContain('"body","몸통 전체 접근",3,3300,3300,')
    expect(trace).toContain('"stopped","unmeasurable",false,false')
    const retained = current.traceCount
    act(() => current.start('synthetic')); expect(current.traceCount).toBe(retained); expect(current.rows.head).toBeDefined(); expect(current.source).toBe('camera')
  })
  it('retains missing-depth blanks and explicit hidden boundaries and clears traces on re-registration', () => {
    mount(); register(); wall = 2100
    act(() => listener({ ...comparisonDemo(2100, 'head'), worldLandmarks: [], features: null, inferenceMs: 1, delegate: 'CPU', videoTimeMs: 2100 }))
    act(() => { doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')) })
    act(() => current.exportCsv('trace'))
    const csv = vi.mocked(downloadComparisonCsv).mock.calls.at(-1)![1]
    expect(csv).toContain('"depth_unavailable",true,false')
    expect(csv).toContain('"hidden","unmeasurable",false,false')
    act(() => { doc.visibilityState = 'visible'; current.register() }); expect(current.traceCount).toBeGreaterThan(0)
    act(() => current.confirmReset()); expect(current.traceCount).toBe(0)
  })
  it('bounds exported traces and discloses dropped rows rather than implying a complete recording', () => {
    mount(); register()
    for (let i = 1; i <= COMPARISON_TRACE_LIMIT + 3; i++) emit(2000 + i * 100, 'head')
    expect(current.traceCount).toBe(COMPARISON_TRACE_LIMIT); expect(current.droppedRows).toBe(4)
    act(() => current.exportCsv('trace'))
    const csv = vi.mocked(downloadComparisonCsv).mock.calls.at(-1)![1]
    expect(csv.trim().split('\r\n')).toHaveLength(COMPARISON_TRACE_LIMIT + 1)
    expect(csv).toContain(',4,"neutral"')
  })
  it('ignores repeated start calls during an active camera measurement and rejects demo switching', () => {
    mount(); register(); const retained = current.traceCount
    const connect = vi.mocked(camera.connect); const calls = connect.mock.calls.length
    act(() => current.start('camera')); act(() => current.start('synthetic'))
    expect(current.traceCount).toBe(retained); expect(current.active).toBe(true)
    expect(connect).toHaveBeenCalledTimes(calls); expect(current.source).toBe('camera')
  })
  it('protects stopped data on new start, supports cancel/download, and clears only on explicit confirm', () => {
    mount(); register(); act(() => current.stop()); const count = current.traceCount
    act(() => current.start('camera')); expect(current.pendingReset).toBe('start'); expect(current.traceCount).toBe(count)
    act(() => current.cancelReset()); expect(current.pendingReset).toBeNull(); expect(current.traceCount).toBe(count)
    act(() => current.exportCsv('trace')); expect(downloadComparisonCsv).toHaveBeenCalledOnce()
    act(() => current.start('camera')); act(() => current.confirmReset())
    expect(current.active).toBe(true); expect(current.traceCount).toBe(0)
  })
  it('guards table clearing separately and keeps the trace after confirming', () => {
    mount(); register(); act(() => current.choose('head'))
    for (let t = 2100; t <= 3200; t += 100) emit(t, 'head')
    act(() => current.capture()); act(() => current.clear())
    expect(current.pendingReset).toBe('clear'); expect(current.rows.head).toBeDefined()
    act(() => current.cancelReset()); expect(current.rows.head).toBeDefined()
    const count = current.traceCount
    act(() => current.clear()); act(() => current.confirmReset()); expect(current.rows).toEqual({}); expect(current.traceCount).toBe(count)
  })
  it('never collects snapshots/traces, connects a camera or exports CSV in the isolated demo', () => {
    act(() => { renderer = create(<DemoProbe />) }); act(() => current.start('synthetic'))
    for (let i = 0; i < 30; i++) { wall = i * 100; act(() => { vi.advanceTimersByTime(100) }) }
    expect(current.reference).not.toBeNull(); expect(current.traceCount).toBe(0)
    act(() => current.capture()); act(() => current.exportCsv('trace')); act(() => current.exportCsv('summary')); act(() => current.start('camera'))
    expect(current.rows).toEqual({}); expect(camera.connect).not.toHaveBeenCalled(); expect(downloadComparisonCsv).not.toHaveBeenCalled()
  })
  it('warns on browser navigation only while data exists and removes the handler on unmount', () => {
    const unload = () => { const event = new Event('beforeunload', { cancelable: true }); Object.defineProperty(event, 'returnValue', { value: '', writable: true }); win.dispatchEvent(event); return event.defaultPrevented }
    mount(); expect(unload()).toBe(false); register(); expect(unload()).toBe(true)
    act(() => current.stop()); expect(unload()).toBe(true)
    act(() => renderer.unmount()); expect(unload()).toBe(false)
  })
  it('renders demo help as a separate-tab link and gives the demo no collection/export controls', () => {
    act(() => { renderer = create(<ObservationLab camera={camera} />) })
    const link = renderer.root.findByProps({ href: '/dev?view=observation&demo=1' })
    expect(link.props.target).toBe('_blank'); expect(link.props.rel).toContain('noopener')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('합성 예시 보기')
    act(() => renderer.unmount()); act(() => { renderer = create(<ObservationLab camera={camera} demo />) })
    expect(JSON.stringify(renderer.toJSON())).toContain('수집 없음 · CSV 없음')
    expect(renderer.root.findAllByProps({ className: 'oc-comparison' })).toHaveLength(0)
  })
  it('records all 36 guided phase boundaries and 12 holds across three rounds, then stops and preserves the CSV', () => {
    mount(); register(); const retained = current.traceCount
    act(() => current.startGuide()); expect(current.traceCount).toBeGreaterThan(retained)
    for (let t = 2100; t <= 146000; t += 100) emit(t, current.action)
    expect(current.guide.status).toBe('completed'); expect(current.active).toBe(false)
    expect(current.action).toBe('neutral'); expect(current.reference).not.toBeNull()
    expect(downloadComparisonCsv).not.toHaveBeenCalled()
    const rows = exportRows(), boundaries = rows.filter(r => r.event === 'protocol_phase_completed')
    expect(boundaries).toHaveLength(36)
    expect(new Set(boundaries.map(r => r.segment_id)).size).toBe(36)
    expect(boundaries.map(r => r.protocol_phase_index)).toEqual(Array.from({ length: 36 }, (_, i) => String(i + 1)))
    expect(boundaries.every(r => r.protocol_phase_elapsed_ms === r.protocol_phase_duration_ms)).toBe(true)
    expect(boundaries.filter(r => r.protocol_phase === 'hold').map(r => `${r.protocol_round}:${r.protocol_task_action}`)).toEqual([1,2,3].flatMap(round => ['head','bow','body','shoulders'].map(action => `${round}:${action}`)))
    expect(rows.filter(r => r.event === 'observation' && r.protocol_phase === 'hold').every(r => r.label_kind === 'guided_task_not_ground_truth' && r.protocol_state === 'running')).toBe(true)
    expect(rows.filter(r => r.protocol_phase === 'return').every(r => r.action === 'neutral')).toBe(true)
    expect(rows.at(-1)).toMatchObject({ event: 'stopped', protocol_state: 'completed', protocol_round: '3', protocol_trial: '12' })
    const count = current.traceCount
    act(() => current.start('camera')); expect(current.pendingReset).toBe('start'); expect(current.traceCount).toBe(count)
    act(() => current.cancelReset()); expect(current.guide.status).toBe('completed')
  })
  it('pauses on hidden tabs, keeps recovering samples separate, and restarts the current phase only on explicit resume', () => {
    mount(); register(); act(() => current.startGuide()); emit(2100, 'head')
    act(() => { doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')) })
    wall = 60000; act(() => { vi.advanceTimersByTime(1000) })
    expect(current.guide).toMatchObject({ status: 'paused', stepIndex: 0, pauseReason: 'hidden', attempt: 1 })
    act(() => current.resumeGuide()); expect(current.guide.status).toBe('paused')
    act(() => { doc.visibilityState = 'visible' }); emit(60000, 'neutral')
    expect(current.guide.status).toBe('paused')
    act(() => current.resumeGuide()); expect(current.guide).toMatchObject({ status: 'running', remainingMs: 2000, attempt: 2 })
    for (let t = 60100; t <= 62000; t += 100) emit(t, 'head')
    expect(current.guide.step?.phase).toBe('hold')
    const rows = exportRows()
    expect(rows.find(r => r.event === 'protocol_paused')).toMatchObject({ protocol_pause_reason: 'hidden', protocol_phase_attempt: '1' })
    const recovered = rows.find(r => r.event === 'observation' && r.observation_time_ms === '60000')!
    expect(recovered.protocol_state).toBe('paused')
    const starts = rows.filter(r => r.event === 'protocol_phase_started' && r.protocol_phase === 'move')
    expect(starts.map(r => r.protocol_phase_attempt)).toEqual(['1','2'])
    expect(starts[0].segment_id).not.toBe(starts[1].segment_id)
  })
  it('pauses on invalid 2D and refuses resume until tracking is valid', () => {
    mount(); register(); act(() => current.startGuide()); emit(2100)
    wall = 2200
    const invalid = comparisonDemo(wall, 'head'); invalid.landmarks[0].visibility = 0
    act(() => listener({ ...invalid, features: null, inferenceMs: 1, delegate: 'CPU', videoTimeMs: wall }))
    expect(current.guide).toMatchObject({ status: 'paused', pauseReason: 'tracking_lost' })
    act(() => current.resumeGuide()); expect(current.guide.status).toBe('paused')
    const row = exportRows().find(r => r.observation_time_ms === '2200')!
    expect(row).toMatchObject({ status: 'unmeasurable', image_valid: 'false', protocol_state: 'paused', head_gap_delta_pct_ref_image_shoulder_width: '' })
    emit(2300); expect(current.guide.status).toBe('paused')
  })
  it('continues 2D guidance with missing z recorded as missing rather than zero', () => {
    mount(); register(); act(() => current.startGuide())
    for (let t = 2100; t <= 4200; t += 100) {
      wall = t
      act(() => listener({ ...comparisonDemo(t, 'head'), worldLandmarks: [], features: null, inferenceMs: 1, delegate: 'CPU', videoTimeMs: t }))
    }
    expect(current.guide).toMatchObject({ status: 'running', step: { phase: 'hold' } })
    const row = exportRows().find(r => r.observation_time_ms === '4200')!
    expect(row).toMatchObject({ status: 'depth_unavailable', relative_z_delta_pct_ref_world_shoulder_width: '', protocol_state: 'running', protocol_phase: 'hold' })
  })
  it('pauses when observations stop and does not count an unseen wall-clock gap as a hold', () => {
    mount(); register(); act(() => current.startGuide()); emit(2100)
    wall = 9000; act(() => { vi.advanceTimersByTime(600) })
    expect(current.guide).toMatchObject({ status: 'paused', stepIndex: 0, pauseReason: 'tracking_lost' })
    emit(9100); expect(current.guide.status).toBe('paused')
    expect(exportRows().filter(r => r.event === 'protocol_phase_completed')).toHaveLength(0)
  })
  it('does not keep guidance alive with callbacks whose input clock barely advances and yields no new accepted observation', () => {
    mount(); register(); act(() => current.startGuide()); emit(2100)
    for (wall = 2200; wall <= 2800; wall += 100) {
      const t = 2100 + (wall - 2100) / 100
      act(() => { listener({ ...comparisonDemo(t, 'head'), features: null, inferenceMs: 1, delegate: 'CPU', videoTimeMs: t }); vi.advanceTimersByTime(100) })
    }
    expect(current.guide).toMatchObject({ status: 'paused', pauseReason: 'tracking_lost', stepIndex: 0 })
    expect(current.canGuide).toBe(false)
  })
  it('locks manual labels, snapshots and registration during guidance; cancellation preserves unfinished segments', () => {
    mount(); register(); act(() => current.startGuide()); emit(2100, 'head')
    const count = current.traceCount, reference = current.reference
    act(() => { current.choose('body'); current.capture(); current.register(); current.startGuide() })
    expect(current.action).toBe('head'); expect(current.rows).toEqual({}); expect(current.pendingReset).toBeNull()
    expect(current.reference).toBe(reference); expect(current.traceCount).toBe(count)
    act(() => current.pauseGuide()); expect(current.guide.pauseReason).toBe('user')
    act(() => current.stop()); expect(current.guide.status).toBe('cancelled')
    const rows = exportRows()
    expect(rows.filter(r => r.event === 'protocol_completed')).toHaveLength(0)
    expect(rows.at(-1)).toMatchObject({ event: 'stopped', protocol_state: 'cancelled' })
  })
  it('cannot start guidance before camera/reference readiness or in the display-only example', () => {
    mount(); act(() => current.startGuide()); expect(current.guide.status).toBe('idle')
    act(() => current.start('camera')); emit(0); act(() => current.startGuide()); expect(current.guide.status).toBe('idle')
    act(() => renderer.unmount()); act(() => { renderer = create(<DemoProbe />) }); act(() => current.start('synthetic'))
    for (let i = 0; i < 25; i++) { wall = i * 100; act(() => { vi.advanceTimersByTime(100) }) }
    act(() => current.startGuide()); expect(current.guide.status).toBe('idle'); expect(current.traceCount).toBe(0)
  })
  it('cancels guidance on extraction-context changes without relabelling or deleting its previous recording', () => {
    mount(); register(); act(() => current.startGuide()); emit(2100, 'head')
    const count = current.traceCount
    wall = 2200
    act(() => listener({ ...comparisonDemo(2200, 'head'), width: 1280, features: null, inferenceMs: 1, delegate: 'CPU', videoTimeMs: 2200 }))
    expect(current.guide.status).toBe('cancelled'); expect(current.active).toBe(false)
    expect(current.traceCount).toBe(count + 1)
    const rows = exportRows()
    expect(rows.at(-1)).toMatchObject({ event: 'protocol_cancelled', reference_context: 'explicit-synthetic-illustration:640x480' })
    expect(rows.every(r => !r.reference_context.includes('1280'))).toBe(true)
  })
})
