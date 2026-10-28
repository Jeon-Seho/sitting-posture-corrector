import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { CameraController, Observation } from '../../hooks/useCamera'
import { useObservationComparison } from './useObservationComparison'
import ObservationLab from './ObservationLab'
import { ConfirmDialog } from '../dialog/ConfirmDialog'
import { ObservationGuide } from './ObservationGuide'
import { ObservationReplay } from './ObservationReplayPanel'
import { comparisonDemo } from './comparisonDemo'
import { downloadObservationReplay } from './observationReplay'
import { downloadComparisonCsv } from './observationCsv'
vi.mock('./observationCsv', async importOriginal => ({ ...await importOriginal<typeof import('./observationCsv')>(), downloadComparisonCsv: vi.fn() }))
vi.mock('./observationReplay', async original => ({ ...await original<typeof import('./observationReplay')>(), downloadObservationReplay: vi.fn() }))
// Test-renderer has no DOM portal host. Render portal children inline; placement is browser-verified.
vi.mock('react-dom', async original => ({ ...await original<typeof import('react-dom')>(), createPortal: (children: ReactNode) => children }))
const previewNodes = { createNodeMock: (element: { props: { className?: string } }) => element.props.className === 'oc-replay-preview-host' ? { nodeType: 1 } : null }
const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('')

describe('observation flow with explicit synthetic frames and clock', () => {
  let camera: CameraController, listener: (frame: Observation) => void, renderer: ReactTestRenderer
  let current: ReturnType<typeof useObservationComparison>, wall = 0, doc: EventTarget & { visibilityState: string; title: string }, win: EventTarget
  const unsubscribe = vi.fn()
  function Probe() { current = useObservationComparison(camera); return null }
  function DemoProbe() { current = useObservationComparison(camera, 'synthetic'); return null }
  const emit = (t: number, options: { invalid?: boolean; noDepth?: boolean; extractor?: string } = {}) => {
    wall = t
    const frame = comparisonDemo(t, current?.action ?? 'neutral')
    if (options.invalid) frame.landmarks[0].visibility = 0
    if (options.noDepth) frame.worldLandmarks = []
    if (options.extractor) frame.poseModelId = options.extractor
    act(() => listener({ ...frame, features: null, inferenceMs: 1, delegate: 'CPU', videoTimeMs: t }))
  }
  const frames = (from: number, to: number) => { for (let t = from; t <= to; t += 100) emit(t) }
  const mount = () => act(() => { renderer = create(<Probe />) })
  const start = () => act(() => current.start('camera'))
  const register = () => { start(); frames(0, 1900); act(() => current.startReference()); frames(2000, 10000) }
  const registerUI = () => { frames(0, 1900); act(() => renderer.root.findByProps({ 'aria-label': '기준 자세 등록 시작' }).props.onClick()) }
  const exportRows = () => {
    act(() => current.exportCsv('trace'))
    const [header, ...lines] = vi.mocked(downloadComparisonCsv).mock.calls.at(-1)![1].slice(1).trimEnd().split('\r\n')
    return lines.map(line => Object.fromEntries(header.split(',').map((key, i) => [key, line.split(',')[i].replace(/^"(.*)"$/, '$1')])))
  }
  beforeEach(() => {
    vi.mocked(downloadComparisonCsv).mockClear(); vi.mocked(downloadObservationReplay).mockClear()
    wall = 0; vi.useFakeTimers(); vi.spyOn(performance, 'now').mockImplementation(() => wall)
    doc = Object.assign(new EventTarget(), { visibilityState: 'visible', title: 'test' }); vi.stubGlobal('document', doc)
    win = new EventTarget(); vi.stubGlobal('window', win)
    camera = { subscribe: vi.fn(fn => { listener = fn; return unsubscribe }), connect: vi.fn().mockResolvedValue(undefined), stop: vi.fn(), state: 'on', error: '', videoRef: { current: null }, streamRef: { current: null } } as unknown as CameraController
  })
  afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); unsubscribe.mockClear() })
  it('opens without using the camera and keeps modes inside the start modal', () => {
    act(() => { renderer = create(<ObservationLab camera={camera} />, previewNodes) })
    expect(camera.connect).not.toHaveBeenCalled()
    expect(text(renderer.root.findByProps({ className: 'oc-camera-empty' }))).toBe('카메라를 켜 주세요')
    expect(renderer.root.findAllByType('button').map(text)).not.toContain('기준 8초 등록')
    expect(renderer.root.findAllByProps({ className: 'oc-mode-picker' })).toHaveLength(0)
    expect(renderer.root.findAllByType('header')).toHaveLength(0)
    act(() => renderer.root.findAllByType('button').find(b => b.props.children === '카메라 켜기')!.props.onClick())
    expect(camera.connect).not.toHaveBeenCalled()
    expect(renderer.root.findByType('dialog').props['aria-modal']).toBe('true')
    expect(renderer.root.findAllByProps({ type: 'radio' }).map(radio => radio.props.value)).toEqual(['auto', 'manual'])
    act(() => renderer.root.findAllByType('button').find(b => b.props.children === '취소')!.props.onClick())
    expect(camera.connect).not.toHaveBeenCalled(); expect(renderer.root.findAllByType('dialog')).toHaveLength(0)

  })
  it('switches themes without reconnecting the camera and remembers the choice on remount', () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
    act(() => { renderer = create(<ObservationLab camera={camera} />, previewNodes) })
    expect(renderer.root.findByProps({ className: 'dev-lab oc-page' }).props['data-theme']).toBe('dark')
    act(() => renderer.root.findByProps({ 'aria-label': '라이트 모드로 전환' }).props.onClick())
    expect(renderer.root.findByProps({ className: 'dev-lab oc-page' }).props['data-theme']).toBe('light')
    expect(camera.connect).not.toHaveBeenCalled(); expect(camera.stop).not.toHaveBeenCalled()
    expect(camera.subscribe).toHaveBeenCalledOnce()
    act(() => renderer.unmount())
    act(() => { renderer = create(<ObservationLab camera={camera} />, previewNodes) })
    expect(renderer.root.findByProps({ className: 'dev-lab oc-page' }).props['data-theme']).toBe('light')
    act(() => renderer.root.findByProps({ 'aria-label': '다크 모드로 전환' }).props.onClick())
    expect(renderer.root.findByProps({ className: 'dev-lab oc-page' }).props['data-theme']).toBe('dark')
  })
  it('ignores invalid saved themes and permits switching when preference storage is blocked', () => {
    const getItem = vi.fn().mockReturnValue('unknown')
    vi.stubGlobal('localStorage', { getItem, setItem: () => { throw new Error('storage blocked') } })
    act(() => { renderer = create(<ObservationLab camera={camera} />, previewNodes) })
    expect(renderer.root.findByProps({ className: 'dev-lab oc-page' }).props['data-theme']).toBe('dark')
    act(() => renderer.root.findByProps({ 'aria-label': '라이트 모드로 전환' }).props.onClick())
    expect(renderer.root.findByProps({ className: 'dev-lab oc-page' }).props['data-theme']).toBe('light')
    act(() => renderer.unmount())
    getItem.mockImplementation(() => { throw new Error('storage blocked') })
    act(() => { renderer = create(<ObservationLab camera={camera} />, previewNodes) })
    expect(renderer.root.findByProps({ className: 'dev-lab oc-page' }).props['data-theme']).toBe('dark')
    expect(camera.connect).not.toHaveBeenCalled()
  })
  it('waits for confirmation before registering eight seconds and starting guidance', () => {
    mount(); start(); frames(0, 1900)
    expect(current.setup.status).toBe('preparing'); expect(current.registering).toBe(false); expect(current.traceCount).toBe(0)
    expect(current.canStartReference).toBe(true); expect(current.reference).toBeNull()
    act(() => current.startReference()); expect(current.setup).toEqual({ status: 'registering', remainingMs: 8000 }); emit(2000)
    frames(2100, 9900); expect(current.reference).toBeNull(); expect(current.traceCount).toBe(0)
    emit(10000)
    expect(current.reference).not.toBeNull(); expect(current.guide).toMatchObject({ status: 'running', mode: 'auto', step: { phase: 'move' } })
    expect(current.measuring).toBe(false)
  })
  it('never starts registration by waiting and rejects confirmation without fresh tracking', () => {
    mount(); start(); frames(0, 15000)
    expect(current.setup.status).toBe('preparing'); expect(current.registering).toBe(false); expect(current.reference).toBeNull()
    wall = 16000; act(() => current.startReference())
    expect(current.setup.status).toBe('preparing'); expect(current.reference).toBeNull()
    emit(16100); act(() => current.startReference())
    expect(current.setup.status).toBe('registering'); expect(current.reference).toBeNull()
    frames(16200, 24100); expect(current.reference).toBeNull()
    emit(24200); expect(current.reference).not.toBeNull()
  })
  it('records replay points across stages while keeping measurement CSV hold-only and protects early replay data', () => {
    mount(); start(); frames(0, 1500)
    expect(current.replayCount).toBeGreaterThan(0); expect(current.traceCount).toBe(0)
    const early = current.getReplay()!
    expect(early.frames.every(frame => !frame.measurement)).toBe(true)
    act(() => current.stop()); start()
    expect(current.pendingReset).toBe('start'); expect(current.getReplay()!.frames).toEqual(early.frames)
    act(() => current.cancelReset()); start(); act(() => current.confirmReset())
    expect(current.replayCount).toBe(0)
    emit(2000); act(() => current.startReference()); frames(2100, 15100)
    const replay = current.getReplay()!
    expect(replay.frames.some(f => f.phase === 'registering')).toBe(true)
    expect(replay.frames.some(f => f.phase === 'move' && !f.measurement)).toBe(true)
    expect(replay.frames.some(f => f.phase === 'hold' && f.measurement)).toBe(true)
    expect(exportRows().filter(row => row.event === 'observation').every(row => row.protocol_phase === 'hold')).toBe(true)
    doc.visibilityState = 'hidden'; act(() => { doc.dispatchEvent(new Event('visibilitychange')) })
    expect(current.getReplay()!.markers.at(-1)?.reason).toBe('hidden')
    act(() => current.stop()); const count = current.replayCount
    emit(16000); expect(current.replayCount).toBe(count)
  })
  it('connects a completed measurement cycle directly to the replay UI without a file or load button', async () => {
    act(() => { renderer = create(<ObservationLab camera={camera} />, previewNodes) })
    const button = (label: string) => renderer.root.findAllByType('button').find(b => (b.props['aria-label'] ?? text(b)) === label)!
    act(() => button('카메라 켜기').props.onClick())
    act(() => renderer.root.findAllByProps({type:'radio'}).find(r => r.props.value === 'auto')!.props.onChange())
    await act(async () => { await button('카메라 켜고 시작').props.onClick() })
    // A continuous 5 Hz stream covers every protocol boundary without rendering 1,540 UI frames.
    for (let t = 0; t <= 154000; t += 200) {
      wall = t
      act(() => listener({ ...comparisonDemo(t, 'neutral'), features: null, inferenceMs: 1, delegate: 'CPU', videoTimeMs: t }))
      if (t === 1800) act(() => button('기준 자세 등록 시작').props.onClick())
    }
    act(() => renderer.root.findAllByProps({role:'tab'})[1].props.onClick())
    expect(button('최근 측정 보기').props['aria-pressed']).toBe(true)
    expect(button('재생').props.disabled).toBe(false)
    expect(renderer.root.findByProps({ 'aria-label': '리플레이 위치' }).props.max).toBe(154000)
    expect(renderer.root.findAllByType('button').some(b => text(b) === '현재 기록 불러오기')).toBe(false)
    expect(renderer.root.findAllByProps({type:'file'})).toHaveLength(0)
  }, 15000)
  it('keeps the preview, registered guide and replay recording alive across analysis tabs', async () => {
    act(() => { renderer = create(<ObservationLab camera={camera} />, previewNodes) })
    const button = (label: string) => renderer.root.findAllByType('button').find(b => (b.props['aria-label'] ?? text(b)) === label)!
    act(() => button('카메라 켜기').props.onClick())
    act(() => renderer.root.findAllByProps({ type: 'radio' }).find(r => r.props.value === 'manual')!.props.onChange())
    await act(async () => { await button('카메라 켜고 시작').props.onClick() })
    registerUI(); frames(2000, 13000)
    const preview = renderer.root.findByProps({ 'aria-label': '좌우 반전된 실시간 웹캠' })
    const guide = renderer.root.findByType(ObservationGuide).props.guide
    const replay = renderer.root.findByType(ObservationReplay).props.getRecording()
    const connected = vi.mocked(camera.connect).mock.calls.length, stopped = vi.mocked(camera.stop).mock.calls.length
    expect(guide.runId).not.toBe(''); expect(replay.frames.length).toBeGreaterThan(0)
    expect(renderer.root.findAllByType('button').some(b => text(b) === '영상 크게')).toBe(false)
    act(() => renderer.root.findAllByProps({ role: 'tab' })[1].props.onClick())
    act(() => renderer.root.findAllByProps({ role: 'tab' })[0].props.onClick())
    expect(renderer.root.findByProps({ 'aria-label': '좌우 반전된 실시간 웹캠' })).toBe(preview)
    expect(renderer.root.findByType(ObservationGuide).props.guide).toBe(guide)
    expect(renderer.root.findByType(ObservationReplay).props.getRecording().frames).toEqual(replay.frames)
    expect(camera.connect).toHaveBeenCalledTimes(connected); expect(camera.stop).toHaveBeenCalledTimes(stopped)
    frames(13100, 13200)
    expect(renderer.root.findByType(ObservationReplay).props.getRecording().frames.length).toBeGreaterThan(replay.frames.length)
  })
  it('uses the preview for replay while preserving the live node and prioritizing ongoing measurement', async () => {
    act(() => { renderer = create(<ObservationLab camera={camera} />, previewNodes) })
    const button = (label: string) => renderer.root.findAllByType('button').find(b => (b.props['aria-label'] ?? text(b)) === label)!
    const tabs = () => renderer.root.findAllByProps({ role: 'tab' })
    const live = () => renderer.root.findByProps({ className: 'oc-live-preview' })
    const video = renderer.root.findByProps({ 'aria-label': '좌우 반전된 실시간 웹캠' })
    act(() => tabs()[1].props.onClick()); expect(live().props.hidden).toBe(true)
    act(() => tabs()[0].props.onClick()); expect(live().props.hidden).toBe(false)
    act(() => button('카메라 켜기').props.onClick())
    act(() => renderer.root.findAllByProps({ type: 'radio' }).find(r => r.props.value === 'manual')!.props.onChange())
    await act(async () => { await button('카메라 켜고 시작').props.onClick() })
    registerUI(); frames(2000, 13000)
    act(() => tabs()[1].props.onClick())
    expect(live().props.hidden).toBe(false)
    expect(renderer.root.findAllByType('button').some(b => text(b) === '파일 불러오기')).toBe(false)
    act(() => button('측정 종료').props.onClick()); act(() => renderer.root.findByType(ConfirmDialog).props.onConfirm())
    expect(live().props.hidden).toBe(true)
    expect(renderer.root.findAllByType(ObservationReplay)).toHaveLength(1)
    expect(button('재생').props.disabled).toBe(false)
    const position = () => renderer.root.findByProps({ 'aria-label': '리플레이 위치' }).props.value
    act(() => button('재생').props.onClick())
    act(() => { wall += 200; vi.advanceTimersByTime(200) })
    const playingPosition = position(); expect(playingPosition).toBeGreaterThan(0)
    act(() => tabs()[0].props.onClick())
    act(() => { wall += 500; vi.advanceTimersByTime(500) })
    expect(live().props.hidden).toBe(false)
    expect(renderer.root.findAllByProps({ 'aria-label': '리플레이 위치' })).toHaveLength(0)
    act(() => tabs()[1].props.onClick())
    expect(live().props.hidden).toBe(true); expect(position()).toBe(playingPosition)
    expect(renderer.root.findByProps({ 'aria-label': '좌우 반전된 실시간 웹캠' })).toBe(video)
    expect(camera.connect).toHaveBeenCalledOnce()
  })
  it('centers the comparison panel without stopping or remounting an ongoing camera session', async () => {
    act(() => { renderer = create(<ObservationLab camera={camera} />, previewNodes) })
    const button = (label: string) => renderer.root.findAllByType('button').find(b => (b.props['aria-label'] ?? text(b)) === label)!
    act(() => button('카메라 켜기').props.onClick())
    act(() => renderer.root.findAllByProps({ type: 'radio' }).find(r => r.props.value === 'manual')!.props.onChange())
    await act(async () => { await button('카메라 켜고 시작').props.onClick() })
    registerUI(); frames(2000, 13000)
    const preview = renderer.root.findByProps({ 'aria-label': '좌우 반전된 실시간 웹캠' })
    const stopped = vi.mocked(camera.stop).mock.calls.length
    act(() => renderer.root.findAllByProps({ role: 'tab' })[2].props.onClick())
    expect(renderer.root.findByProps({ className: 'oc-preview-pane' }).props.hidden).toBe(true)
    expect(renderer.root.findByProps({ className: 'oc-coview' }).props['data-mode']).toBe('table')
    expect(renderer.root.findByProps({ 'aria-label': '좌우 반전된 실시간 웹캠' })).toBe(preview)
    frames(13100, 13200)
    expect(camera.stop).toHaveBeenCalledTimes(stopped)
    const controls = renderer.root.findByProps({ className: 'oc-table-session' })
    act(() => controls.findAllByType('button').find(b => text(b) === '측정 종료')!.props.onClick()); act(() => renderer.root.findByType(ConfirmDialog).props.onConfirm())
    expect(camera.stop).toHaveBeenCalledTimes(stopped + 1)
    act(() => renderer.root.findAllByProps({ role: 'tab' })[1].props.onClick())
    expect(button('재생').props.disabled).toBe(false)
  })
  it('starts manual guidance from the modal and preserves recorded data through a later mode choice', async () => {
    act(() => { renderer = create(<ObservationLab camera={camera} />, previewNodes) })
    const button = (label: string) => renderer.root.findAllByType('button').find(b => (b.props['aria-label'] ?? text(b)) === label)!
    const pick = async (mode: 'auto' | 'manual') => {
      act(() => (button('다시 측정') ?? button('카메라 켜기')).props.onClick())
      act(() => renderer.root.findAllByProps({ type: 'radio' }).find(r => r.props.value === mode)!.props.onChange())
      await act(async () => { await button('카메라 켜고 시작').props.onClick() })
    }
    await pick('manual'); expect(camera.connect).toHaveBeenCalledOnce()
    registerUI(); frames(2000, 12000)
    expect(renderer.root.findByProps({ 'aria-label': '동작 안내' }).props['data-state']).toBe('waiting')
    expect(button('측정 시작').props.disabled).toBe(false)
    expect(renderer.root.findByProps({ className: 'oc-camera-badge' }).props['data-status']).toBe('waiting')
    const measurement = renderer.root.findByProps({ className: 'oc-workspace oc-measurement' })
    const key = { key: 'Enter', repeat: false, isDefaultPrevented: () => false, nativeEvent: { isComposing: false }, preventDefault: vi.fn(), target: { closest: () => null } }
    act(() => measurement.props.onKeyDown({ ...key, target: { closest: () => ({}) } }))
    expect(renderer.root.findByProps({ 'aria-label': '동작 안내' }).props['data-state']).toBe('waiting')
    act(() => measurement.props.onKeyDown(key)); expect(key.preventDefault).toHaveBeenCalledOnce()
    expect(renderer.root.findByProps({ className: 'oc-camera-badge' }).props['data-status']).toBe('measuring')
    frames(12100, 13100)
    act(() => button('측정 종료').props.onClick()); act(() => renderer.root.findByType(ConfirmDialog).props.onConfirm())
    expect(renderer.root.findAllByProps({ className: 'oc-status' })).toHaveLength(0)
    expect(renderer.root.findAllByProps({ className: 'oc-guide-notice' })).toHaveLength(0)
    expect(button('다시 측정')).toBeDefined()
    act(() => button('JSON 다운로드').props.onClick())
    const downloaded = vi.mocked(downloadObservationReplay).mock.calls.at(-1)![0]
    expect(downloaded.frames.length).toBeGreaterThan(0)
    expect(downloaded.frames.some(frame => frame.measurement)).toBe(true)
    await pick('auto')
    expect(camera.connect).toHaveBeenCalledOnce()
    expect(renderer.root.findByType('dialog').findByType('h2').props.children).toBe('기존 측정 자료를 유지할까요?')
    act(() => button('취소').props.onClick())
    expect(button('관측 시계열 CSV').props.disabled).toBe(false)
  })
  it('advances on Enter from the page background only when waiting and no dialog is open', async () => {
    const querySelector = vi.fn().mockReturnValue(null)
    Object.assign(doc, { body: doc, querySelector })
    act(() => { renderer = create(<ObservationLab camera={camera} />, previewNodes) })
    const button = (label: string) => renderer.root.findAllByType('button').find(b => (b.props['aria-label'] ?? text(b)) === label)!
    act(() => button('카메라 켜기').props.onClick())
    await act(async () => { await button('카메라 켜고 시작').props.onClick() })
    registerUI(); frames(2000, 12000)
    const enter = () => { const event = new Event('keydown', { cancelable: true }); Object.assign(event, { key: 'Enter', repeat: false, isComposing: false }); act(() => { doc.dispatchEvent(event) }); return event }
    querySelector.mockReturnValueOnce({})
    expect(enter().defaultPrevented).toBe(false)
    expect(renderer.root.findByProps({ 'aria-label': '동작 안내' }).props['data-state']).toBe('waiting')
    expect(enter().defaultPrevented).toBe(true)
    expect(renderer.root.findByProps({ 'aria-label': '동작 안내' }).props['data-measuring']).toBe(true)
  })
  it('does not start the reference clock while camera connection is still loading', () => {
    camera = { ...camera, state: 'loading' }; mount(); start()
    wall = 5000; act(() => { vi.advanceTimersByTime(100) })
    expect(current.setup.status).toBe('connecting'); expect(current.reference).toBeNull()
    camera = { ...camera, state: 'on' }; act(() => renderer.update(<Probe />))
    frames(5000, 6900); act(() => current.startReference()); frames(7000, 14900); expect(current.reference).toBeNull()
    emit(15000); expect(current.reference).not.toBeNull()
  })
  it('offers a new connection after camera failure during reference registration', () => {
    mount(); start(); frames(0, 1900); act(() => current.startReference()); frames(2000, 3000)
    camera = { ...camera, state: 'error' }; act(() => renderer.update(<Probe />))
    expect(current.active).toBe(false); expect(current.setup.status).toBe('interrupted')
    expect(current.registering).toBe(false)
    start(); expect(current.pendingReset).toBe('start')
    camera = { ...camera, state: 'loading' }; act(() => renderer.update(<Probe />))
    act(() => current.confirmReset()); expect(camera.connect).toHaveBeenCalledTimes(2)
    camera = { ...camera, state: 'on' }; act(() => renderer.update(<Probe />))
    frames(3100, 4900); act(() => current.startReference()); frames(5000, 13100); expect(current.reference).not.toBeNull()
  })
  it('unlocks a disconnected guided run so a new connection can be requested with retained-data protection', () => {
    mount(); register(); frames(10100, 13000)
    camera = { ...camera, state: 'error' }; act(() => renderer.update(<Probe />))
    expect(current.active).toBe(false); expect(current.guideLocked).toBe(false)
    expect(current.guide.status).toBe('cancelled')
    const count = current.traceCount
    start(); expect(current.pendingReset).toBe('start'); expect(current.traceCount).toBe(count)
  })
  it('keeps recorded data and unlocks the UI when the camera is stopped during an effect refresh', () => {
    function RefreshProbe({ selected }: { selected: 'camera' | 'synthetic' }) {
      current = useObservationComparison(camera, selected); return null
    }
    act(() => { renderer = create(<RefreshProbe selected="camera" />) })
    register(); frames(10100, 13000)
    const count = current.traceCount, replayCount = current.replayCount
    expect(count).toBeGreaterThan(0); expect(current.active).toBe(true)
    // An effect refresh invokes cleanup while React retains the session state.
    act(() => renderer.update(<RefreshProbe selected="synthetic" />))
    camera = { ...camera, state: 'off' }
    act(() => renderer.update(<RefreshProbe selected="camera" />))
    expect(current.active).toBe(false); expect(current.guideLocked).toBe(false)
    expect(current.traceCount).toBeGreaterThanOrEqual(count); expect(current.replayCount).toBe(replayCount)
    act(() => current.start('camera'))
    expect(current.pendingReset).toBe('start'); expect(current.replayCount).toBe(replayCount)
  })
  it('focuses the workspace once when registration automatically starts guidance', async () => {
    const scrollIntoView = vi.fn(), focus = vi.fn()
    act(() => { renderer = create(<ObservationLab camera={camera} />, { createNodeMock: element => element.props['aria-label'] === '카메라와 동작 안내' ? { scrollIntoView, focus } : null }) })
    const click = (label: string) => act(() => renderer.root.findAllByType('button').find(button => (button.props['aria-label'] ?? button.props.children) === label)!.props.onClick())
    click('카메라 켜기'); act(() => renderer.root.findAllByProps({ type: 'radio' })[0].props.onChange())
    await act(async () => { await renderer.root.findAllByType('button').find(b => b.props.children === '카메라 켜고 시작')!.props.onClick() }); registerUI(); frames(2000, 9900); expect(focus).not.toHaveBeenCalled()
    emit(10000); expect(scrollIntoView).toHaveBeenCalledOnce(); expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    frames(10100, 12300); click('잠깐 멈춤'); emit(12400); click('현재 단계 처음부터 재개')
    expect(scrollIntoView).toHaveBeenCalledOnce(); expect(focus).toHaveBeenCalledOnce()
  })
  it('waits for tracking before reference preparation and restarts eight seconds on registration quality loss', () => {
    mount(); start()
    for (let t = 0; t <= 5000; t += 100) emit(t, { invalid: true })
    expect(current.setup).toEqual({ status: 'preparing', remainingMs: 0 }); expect(current.canStartReference).toBe(false); act(() => current.startReference()); expect(current.registering).toBe(false)
    emit(5100); act(() => current.startReference()); frames(5200, 9000); expect(current.registering).toBe(true)
    emit(9100, { invalid: true }); frames(9200, 17100); expect(current.reference).toBeNull()
    emit(17200); expect(current.reference).not.toBeNull()
  })
  it('measures only hold frames, excluding preparation, return, pause and manual waiting', () => {
    mount(); act(() => current.changeGuideMode('manual')); register()
    frames(10100, 12000)
    expect(current.guide.status).toBe('waiting'); expect(exportRows().filter(r => r.event === 'observation')).toHaveLength(0)
    frames(12100, 15000); act(() => current.nextGuide())
    expect(current.measuring).toBe(true); frames(15100, 20000)
    expect(current.guide.status).toBe('waiting'); expect(current.measuring).toBe(false)
    const count = current.traceCount
    frames(20100, 26000); expect(current.traceCount).toBe(count)
    act(() => current.nextGuide()); frames(26100, 31000)
    expect(current.guide).toMatchObject({ status: 'waiting', step: { phase: 'return' } })
    const rows = exportRows(), observations = rows.filter(r => r.event === 'observation')
    expect(observations).toHaveLength(49)
    expect(observations.every(r => r.protocol_phase === 'hold' && r.protocol_state === 'running' && r.protocol_mode === 'manual' && r.measurement_scope === 'hold_only')).toBe(true)
    expect(observations.every(r => +r.observation_time_ms >= 15000 && +r.observation_time_ms < 20000)).toBe(true)
    expect(rows.filter(r => r.event !== 'observation').every(r => r.head_gap_delta_pct_ref_image_shoulder_width === '')).toBe(true)
  })
  it('records manual preparation as immediate waiting with a versioned zero-duration phase', () => {
    mount(); act(() => current.changeGuideMode('manual')); register()
    expect(current.guide).toMatchObject({ status: 'waiting', step: { phase: 'move', durationMs: 0 } })
    const rows = exportRows(), phase = rows.filter(row => row.event === 'protocol_phase_completed')
    expect(phase).toHaveLength(1)
    expect(phase[0]).toMatchObject({ protocol_id: 'front-observation-manual-ready-5-5x3-v3', protocol_mode: 'manual', protocol_phase: 'move', protocol_phase_duration_ms: '0' })
    expect(rows.filter(row => row.event === 'observation')).toHaveLength(0)
  })
  it('rejects early and repeated next calls, then gives every manual phase its full time', () => {
    mount(); act(() => current.changeGuideMode('manual')); register()
    expect(current.guide).toMatchObject({ status: 'waiting', stepIndex: 0, remainingMs: 0 })
    emit(10100); act(() => current.nextGuide()); act(() => current.nextGuide())
    expect(current.guide).toMatchObject({ status: 'running', stepIndex: 1, remainingMs: 5000 })
    frames(10200, 15000); act(() => current.nextGuide()); expect(current.guide.stepIndex).toBe(1)
    emit(15100); expect(current.guide.status).toBe('waiting')
    emit(15200)
    act(() => current.nextGuide()); expect(current.guide).toMatchObject({ stepIndex: 2, remainingMs: 5000 })
    act(() => current.changeGuideMode('auto')); expect(current.guideMode).toBe('manual')
  })
  it('records all 36 automatic boundaries and only 12 holds, then stops without losing CSV', () => {
    mount(); register(); frames(10100, 154000)
    expect(current.guide.status).toBe('completed'); expect(current.active).toBe(false)
    const rows = exportRows(), boundaries = rows.filter(r => r.event === 'protocol_phase_completed')
    expect(boundaries).toHaveLength(36)
    expect(new Set(boundaries.map(r => r.segment_id)).size).toBe(36)
    expect(boundaries.every(r => r.protocol_phase_elapsed_ms === r.protocol_phase_duration_ms)).toBe(true)
    const observations = rows.filter(r => r.event === 'observation')
    expect(new Set(observations.map(r => `${r.protocol_round}:${r.protocol_task_action}`)).size).toBe(12)
    expect(observations.every(r => r.protocol_phase === 'hold' && +r.protocol_phase_elapsed_ms < 5000 && r.protocol_mode === 'auto')).toBe(true)
    expect(rows.at(-1)).toMatchObject({ event: 'stopped', protocol_state: 'completed' })
  })
  it('pauses hidden measurements, excludes recovered frames until explicit resume and separates retries', () => {
    mount(); register(); frames(10100, 13000)
    act(() => { doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')) })
    expect(current.guide).toMatchObject({ status: 'paused', step: { phase: 'hold' }, attempt: 1 })
    const count = current.traceCount
    act(() => current.resumeGuide()); expect(current.guide.status).toBe('paused')
    act(() => { doc.visibilityState = 'visible' }); emit(60000)
    expect(current.guide.status).toBe('paused')
    expect(exportRows().filter(r => r.observation_time_ms === '60000')).toHaveLength(0)
    expect(current.traceCount).toBeGreaterThanOrEqual(count)
    act(() => current.resumeGuide()); expect(current.guide).toMatchObject({ status: 'running', remainingMs: 5000, attempt: 2 })
    frames(60100, 65000)
    const rows = exportRows()
    const starts = rows.filter(r => r.event === 'protocol_phase_started' && r.protocol_phase === 'hold')
    expect(starts.map(r => r.protocol_phase_attempt)).toEqual(['1', '2'])
    expect(starts[0].segment_id).not.toBe(starts[1].segment_id)
  })
  it('interrupts hidden registration and requires a new explicit confirmation', () => {
    mount(); start(); frames(0, 1900); act(() => current.startReference()); frames(2000, 4000)
    act(() => { doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')) })
    expect(current.setup.status).toBe('interrupted'); expect(current.registering).toBe(false)
    act(() => { doc.visibilityState = 'visible' }); frames(4100, 15000)
    expect(current.reference).toBeNull()
    act(() => current.register()); expect(current.pendingReset).toBe('register')
    act(() => current.confirmReset()); frames(15100, 16900); act(() => current.startReference()); frames(17000, 25100)
    expect(current.reference).not.toBeNull()
  })
  it('pauses on lost 2D and does not resume or collect until explicit recovery', () => {
    mount(); register(); frames(10100, 13000); emit(13100, { invalid: true })
    expect(current.guide).toMatchObject({ status: 'paused', pauseReason: 'tracking_lost' })
    act(() => current.resumeGuide()); expect(current.guide.status).toBe('paused')
    frames(13200, 14000); expect(current.guide.status).toBe('paused')
    expect(exportRows().filter(r => +r.observation_time_ms >= 13100)).toHaveLength(0)
  })
  it('keeps missing depth blank while continuing valid 2D measurements', () => {
    mount(); register(); frames(10100, 12000); emit(12100, { noDepth: true })
    expect(current.guide.status).toBe('running')
    expect(exportRows().find(r => r.observation_time_ms === '12100')).toMatchObject({ status: 'depth_unavailable', relative_z_delta_pct_ref_world_shoulder_width: '', protocol_phase: 'hold' })
  })
  it('pauses on stale observations rather than counting an unseen time gap', () => {
    mount(); register(); frames(10100, 13000)
    wall = 30000; act(() => { vi.advanceTimersByTime(600) })
    expect(current.guide).toMatchObject({ status: 'paused', pauseReason: 'tracking_lost', step: { phase: 'hold' } })
    expect(current.current).toBeNull()
  })
  it('preserves the original export reference and existing rows on extractor change', () => {
    mount(); register(); frames(10100, 13000); const count = current.traceCount
    emit(13100, { extractor: 'different-extractor' })
    expect(current.reference).toBeNull(); expect(current.active).toBe(false); expect(current.traceCount).toBeGreaterThanOrEqual(count)
    act(() => current.exportCsv('trace'))
    const csv = vi.mocked(downloadComparisonCsv).mock.calls.at(-1)![1]
    expect(csv).toContain('explicit-synthetic-illustration:640x480'); expect(csv).not.toContain('different-extractor')
  })
  it('confirms re-registration during guidance and only permits snapshots during measurement', () => {
    mount(); register(); act(() => current.capture()); expect(current.rows).toEqual({})
    act(() => current.choose('body')); act(() => current.register()); expect(current.action).toBe('head'); expect(current.pendingReset).toBe('register')
    expect(current.active).toBe(true); act(() => current.cancelReset()); expect(current.active).toBe(true)
    frames(10100, 13100); act(() => current.capture()); expect(current.rows.head).toBeDefined()
    act(() => current.stop()); const retained = current.rows.head
    act(() => current.capture()); expect(current.rows.head).toBe(retained)
  })
  it('guards new runs with retained CSV and supports cancel/download before explicit reset', () => {
    mount(); register(); frames(10100, 13000); act(() => current.stop()); const count = current.traceCount
    start(); expect(current.pendingReset).toBe('start'); expect(current.traceCount).toBe(count)
    act(() => current.cancelReset()); expect(current.traceCount).toBe(count)
    act(() => current.exportCsv('trace')); expect(downloadComparisonCsv).toHaveBeenCalledOnce()
    start(); act(() => current.confirmReset()); expect(current.active).toBe(true); expect(current.traceCount).toBe(0)
  })
  it('keeps recording until re-registration is confirmed, then starts a fresh reference', () => {
    mount(); register(); frames(10100, 13000); const count = current.traceCount
    expect(count).toBeGreaterThan(0)
    act(() => current.register())
    expect(current.pendingReset).toBe('register'); expect(current.traceCount).toBe(count); expect(current.active).toBe(true)
    act(() => current.cancelReset())
    expect(current.active).toBe(true); expect(current.traceCount).toBe(count)
    act(() => current.register()); act(() => current.confirmReset())
    expect(current.active).toBe(true); expect(current.traceCount).toBe(0); expect(current.reference).toBeNull()
  })
  it('automatically publishes a completed hold to the table and summary CSV, then clears only the table', () => {
    mount(); register(); frames(10100, 16900)
    expect(current.rows.head).toBeUndefined()
    emit(17000); expect(current.rows.head).toBeDefined()
    act(() => current.exportCsv('summary'))
    const summary = vi.mocked(downloadComparisonCsv).mock.calls.at(-1)![1]
    expect(summary).toContain('guided_task_not_ground_truth')
    expect(summary).toContain('head')
    act(() => current.stop()); const traceCount = current.traceCount
    act(() => current.clear()); expect(current.pendingReset).toBe('clear')
    act(() => current.confirmReset()); expect(current.rows).toEqual({})
    expect(current.traceCount).toBe(traceCount)
    const exports = vi.mocked(downloadComparisonCsv).mock.calls.length
    act(() => current.exportCsv('summary')); expect(downloadComparisonCsv).toHaveBeenCalledTimes(exports)
  })
  it('protects table clearing separately while preserving traces', () => {
    mount(); register(); frames(10100, 13100); act(() => current.capture()); act(() => current.stop())
    act(() => current.clear()); expect(current.pendingReset).toBe('clear')
    act(() => current.cancelReset()); expect(current.rows.head).toBeDefined()
    const count = current.traceCount
    act(() => current.clear()); act(() => current.confirmReset()); expect(current.rows).toEqual({}); expect(current.traceCount).toBe(count)
  })
  it('ignores duplicate starts and rejects switching a camera run to demo', () => {
    mount(); register(); const count = current.traceCount, calls = vi.mocked(camera.connect).mock.calls.length
    start(); act(() => current.start('synthetic'))
    expect(current.traceCount).toBe(count); expect(camera.connect).toHaveBeenCalledTimes(calls); expect(current.source).toBe('camera')
  })
  it('retains the isolated demo without camera access, traces, captures or downloads', () => {
    act(() => { renderer = create(<DemoProbe />) }); act(() => current.start('synthetic'))
    for (let i = 0; i < 30; i++) { wall = i * 100; act(() => { vi.advanceTimersByTime(100) }) }
    expect(current.reference).not.toBeNull(); expect(current.traceCount).toBe(0)
    act(() => current.register()); expect(current.reference).toBeNull(); expect(current.registering).toBe(true)
    for (let i = 30; i < 55; i++) { wall = i * 100; act(() => { vi.advanceTimersByTime(100) }) }
    expect(current.reference).not.toBeNull()
    act(() => current.capture()); act(() => current.exportCsv('trace')); act(() => current.start('camera'))
    expect(current.rows).toEqual({}); expect(camera.connect).not.toHaveBeenCalled(); expect(downloadComparisonCsv).not.toHaveBeenCalled()
  })
  it('warns on navigation while data exists and releases camera, listener and warning on unmount', () => {
    const unload = () => { const event = new Event('beforeunload', { cancelable: true }); Object.defineProperty(event, 'returnValue', { value: '', writable: true }); win.dispatchEvent(event); return event.defaultPrevented }
    mount(); expect(unload()).toBe(false); register(); expect(unload()).toBe(true)
    vi.mocked(camera.stop).mockClear(); act(() => renderer.unmount())
    expect(unload()).toBe(false); expect(camera.stop).toHaveBeenCalledOnce(); expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
