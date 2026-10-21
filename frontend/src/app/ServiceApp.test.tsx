import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import App from './ServiceApp'
import { LoginPage } from '../pages/LoginPage'
import { SetupPage } from '../pages/SetupPage'
import { SessionPage } from '../features/session/SessionPage'
import { ServerSessionPage } from '../features/session/server/ServerSessionPage'
import { projectLive, projectMachine } from '../features/session/server/projection'
import {
  BASELINE,
  BASELINE_ID,
  SESSION_ID,
  checkpoint as serverCheckpoint,
  view as serverView,
} from '../features/session/server/testFixtures'
import type { SessionView } from '../features/session/server/contracts'
import { SettingsPage } from '../pages/SettingsPage'
import { MonthCalendar } from '../features/history/RecordCalendar'
import { SelectMenu } from '../components/SelectMenu'
import type { DailyStat } from '../features/history/recordsSource'
import { DEFAULT_RULES } from '../data/posture'
import { newMachine } from '../lib/engine'
import { KEYS, loadLocalState, readLocal, type Draft, type RecordItem } from '../lib/serviceStore'
import type { CameraController } from '../hooks/useCamera'
import { CAMERA_ERRORS } from '../features/camera/errors'

const controls = vi.hoisted(() => ({
  camera: null as unknown as CameraController,
  writer: 'ready',
}))
vi.mock('../hooks/useCamera', () => ({ useCamera: () => controls.camera }))
vi.mock('../hooks/useWriterLock', () => ({
  useWriterLock: () => ({ state: controls.writer, retry: vi.fn() }),
}))
vi.mock('../features/session/server/ServerSessionPage', () => ({
  ServerSessionPage: () => <div data-testid="server-session">서버 측정 테스트</div>,
}))

describe('service recovery and saving with synthetic storage only', () => {
  let data: Map<string, string>, renderer: ReactTestRenderer | undefined
  const machine = () => {
    const m = newMachine()
    m.total = 120
    m.good = 100
    m.collapse = 20
    return m
  }
  const draft = (): Draft => ({
    id: 'synthetic-draft',
    startedAt: '2026-09-30T10:00:00Z',
    savedAt: '2026-09-30T10:02:00Z',
    mode: 'demo',
    rules: DEFAULT_RULES,
    machine: machine(),
  })
  const text = (node: ReactTestInstance | string): string =>
    typeof node === 'string' ? node : node.children.map(text).join('')
  const click = (label: string) =>
    act(() =>
      renderer!.root
        .findAllByType('button')
        .find((b) => text(b) === label)!
        .props.onClick(),
    )
  const login = () => act(() => renderer!.root.findByType(LoginPage).props.onSubmit())
  const mount = () =>
    act(() => {
      renderer = create(<App />)
    })
  const prepareServerCamera = () => {
    controls.camera.state = 'on'
    controls.camera.quality = true
    controls.camera.baseline = { ...BASELINE }
    controls.camera.calibrationId = BASELINE_ID
    controls.camera.calibrationSummary = {
      durationMs: 5000,
      sampleCount: 20,
      spread: { headGap: 0.01, offset: 0.01, tilt: 0.01 },
      placement: { x: 0.5, y: 0.6, area: 0.05 },
    }
    controls.camera.deviceId = 'synthetic-device'
  }
  const startServer = () => {
    prepareServerCamera()
    mount()
    login()
    expect(renderer!.root.findByType(SetupPage).props.serverMode).toBe(false)
    act(() => renderer!.root.findByType(SetupPage).props.onServerMode(true))
    controls.camera.videoRef = {
      current: { videoWidth: 640, videoHeight: 480 } as HTMLVideoElement,
    }
    act(() => renderer!.root.findByType(SetupPage).props.onStart())
    return renderer!.root.findByType(ServerSessionPage)
  }
  const acknowledgedView = (id: string): SessionView => {
    const initial = serverView({ session_id: id, last_sequence: 0 })
    return {
      ...initial,
      summary: {
        ...initial.summary,
        total_ms: 1000,
        valid_ms: 1000,
        normal_ms: 1000,
        keep_rate: 1,
        events_per_hour: 0,
      },
    }
  }
  const recoveredServerDraft = (): Draft => {
    const view = acknowledgedView(SESSION_ID)
    const server = serverCheckpoint({
      view,
      savedAt: '2026-09-30T10:00:01Z',
      elapsedMs: 1000,
      nextSequence: 1,
      modelVersion: 'reference-feature-rule-v1',
    })
    return {
      id: SESSION_ID,
      startedAt: '2026-09-30T10:00:00Z',
      savedAt: server.savedAt,
      mode: 'camera',
      rules: { ...DEFAULT_RULES },
      machine: projectMachine(view),
      server,
    }
  }
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'))
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
    controls.writer = 'ready'
    controls.camera = {
      state: 'off',
      baseline: null,
      calibrationId: null,
      calibrationSummary: null,
      progress: null,
      registering: false,
      registrationError: null,
      baselineLoading: false,
      quality: false,
      error: '',
      devices: [],
      deviceId: '',
      current: { current: null },
      lastFrame: { current: 0 },
      videoRef: { current: null },
      canvasRef: { current: null },
      streamRef: { current: null },
      metrics: { fps: 0, inferenceMs: 0, delegate: 'CPU' },
      visual: { mode: 'skeleton', enabled: true, reducedMotion: false, startedAt: 0 },
      stop: vi.fn(),
      connect: vi.fn(),
      calibrate: vi.fn(),
      cancelCalibration: vi.fn(),
      setOverlayEnabled: vi.fn(),
      setVisualMode: vi.fn(),
      reassemble: vi.fn(),
      setReducedMotion: vi.fn(),
      subscribe: () => () => {},
    } as unknown as CameraController
    data = new Map([
      [KEYS.profile, JSON.stringify({ name: '합성 테스트', age: 23, occupation: '테스트' })],
    ])
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => data.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => data.set(key, value)),
      removeItem: vi.fn((key: string) => data.delete(key)),
    })
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    vi.stubGlobal('document', {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = undefined
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  it('preserves malformed records, lets a stored profile view them safely, and blocks new writes', () => {
    const raw = '[{"id":"damaged"}]'
    data.set(KEYS.records, raw)
    mount()
    login()
    expect(text(renderer!.root)).toContain('기존 자료는 유지됩니다')
    expect(data.get(KEYS.records)).toBe(raw)
    click('측정 시작')
    act(() => renderer!.root.findByType(SetupPage).props.onStart())
    expect(text(renderer!.root)).toContain('새 측정을 시작할 수 없습니다')
    expect(data.get(KEYS.records)).toBe(raw)
    expect(data.has(KEYS.draft)).toBe(false)
    expect(controls.camera.connect).not.toHaveBeenCalled()
  })
  it('keeps a second tab read-only without changing the saved profile', () => {
    controls.writer = 'busy'
    const before = data.get(KEYS.profile)
    mount()
    login()
    expect(text(renderer!.root)).toContain('다른 탭')
    expect(localStorage.setItem).not.toHaveBeenCalled()
    expect(data.get(KEYS.profile)).toBe(before)
  })
  it('saves a measurement interrupted by closing the app as a record instead of resuming it', () => {
    data.set(KEYS.draft, JSON.stringify(draft()))
    mount()
    login()
    const records = readLocal<RecordItem[]>(KEYS.records, [])
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      id: draft().id,
      endedAt: draft().savedAt,
      total: 120,
      valid: 120,
      good: 100,
      rules: DEFAULT_RULES,
    })
    expect(data.has(KEYS.draft)).toBe(false)
    expect(text(renderer!.root)).toContain('그때까지의 측정을 기록으로 저장했어요')
    expect(renderer!.root.findAllByType('button').some((b) => text(b) === '이어하기')).toBe(false)
  })
  it('retries a failed save of an interrupted measurement with the same ID and end time, once', () => {
    data.set(KEYS.draft, JSON.stringify(draft()))
    let fail = true
    vi.mocked(localStorage.setItem).mockImplementation((key: string, value: string) => {
      if (key === KEYS.records && fail) {
        fail = false
        throw new Error('Synthetic quota failure')
      }
      data.set(key, value)
    })
    mount()
    login()
    expect(text(renderer!.root)).toContain('저장하지 못했습니다')
    expect(data.has(KEYS.draft)).toBe(true)
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    const records = readLocal<RecordItem[]>(KEYS.records, [])
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ id: draft().id, endedAt: draft().savedAt, total: 120 })
    expect(data.has(KEYS.draft)).toBe(false)
  })
  it('distinguishes final-save success from draft-cleanup failure and never saves twice', () => {
    data.set(KEYS.draft, JSON.stringify(draft()))
    let fail = true
    vi.mocked(localStorage.removeItem).mockImplementation((key: string) => {
      if (key === KEYS.draft && fail) {
        fail = false
        throw new Error('Synthetic cleanup failure')
      }
      data.delete(key)
    })
    mount()
    login()
    expect(text(renderer!.root)).toContain('결과는 저장했습니다')
    expect(readLocal<RecordItem[]>(KEYS.records, [])).toHaveLength(1)
    expect(loadLocalState().draft).toBeNull()
  })
  it('keeps develop real-camera-only preparation and quiet login without requesting permission', () => {
    mount()
    login()
    expect(text(renderer!.root)).not.toContain('저장했어요.')
    click('측정 시작')
    const setup = renderer!.root.findByType(SetupPage)
    expect(setup.props.mode).toBeUndefined()
    expect(text(setup)).not.toContain('발표용 시연')
    act(() => setup.props.onStart())
    expect(text(renderer!.root)).toContain('카메라 연결과 기준 등록을 완료')
    expect(renderer!.root.findAllByType(SessionPage)).toHaveLength(0)
    expect(controls.camera.connect).not.toHaveBeenCalled()
  })
  it('starts only a camera session and preserves its rules when settings change', () => {
    controls.camera.state = 'on'
    controls.camera.quality = true
    controls.camera.baseline = { headGap: 0.7, offset: 0, tilt: 0, quality: 0.9 }
    mount()
    login()
    act(() => renderer!.root.findByType(SetupPage).props.onStart())
    expect(renderer!.root.findByType(SessionPage).props.mode).toBe('camera')
    const nextRules = { ...DEFAULT_RULES, holdSeconds: 5 }
    click('설정')
    act(() => renderer!.root.findByType(SettingsPage).props.onRules(nextRules))
    expect(renderer!.root.findByType(SessionPage).props.rules).toEqual(DEFAULT_RULES)
    click('측정하기')
    click('측정 종료')
    expect(readLocal<RecordItem[]>(KEYS.records, [])[0].rules).toEqual(DEFAULT_RULES)
    expect(loadLocalState().settings).toEqual(nextRules)
  })
  it('preserves develop combined records and scopes the calendar to the selected input kind', () => {
    const item: RecordItem = {
      id: 'synthetic-camera',
      startedAt: '2026-09-30T10:00:00Z',
      endedAt: '2026-09-30T10:02:00Z',
      mode: 'camera',
      total: 100,
      valid: 100,
      good: 80,
      events: [],
    }
    const records = [item, { ...item, id: 'synthetic-demo', mode: 'demo' as const, good: 20 }]
    data.set(KEYS.records, JSON.stringify(records))
    mount()
    login()
    click('달력')
    const goodSec = () =>
      (renderer!.root.findByType(MonthCalendar).props.stats as DailyStat[]).reduce((n, s) => n + s.good_sec, 0)
    expect(goodSec()).toBe(100)
    expect(text(renderer!.root)).toContain('실제 웹캠·합성 시연 합산')
    click('실제 웹캠 기록')
    expect(goodSec()).toBe(80)
    click('합성 시연 기록')
    expect(goodSec()).toBe(20)
  })
  it('keeps two-stage withdrawal confirmation cancellable without deleting synthetic data', () => {
    mount()
    login()
    click('설정')
    click('프로필 설정')
    click('탈퇴하기')
    expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
    click('삭제하기')
    const dialog = renderer!.root.findByProps({ role: 'dialog' })
    expect(localStorage.removeItem).not.toHaveBeenCalled()
    act(() =>
      dialog
        .findAllByType('button')
        .find((b) => text(b) === '취소')!
        .props.onClick(),
    )
    expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
    expect(data.has(KEYS.profile)).toBe(true)
    expect(localStorage.removeItem).not.toHaveBeenCalled()
  })
  it('keeps camera and calibration cancellation available inside collection', () => {
    controls.camera.state = 'on'
    controls.camera.quality = true
    controls.camera.progress = 0.4
    controls.camera.baseline = { headGap: 0.7, offset: 0, tilt: 0, quality: 0.9 }
    mount()
    login()
    click('설정')
    click('자세 데이터 수집')
    // Leaving the measure tab already cancels an unfinished calibration once.
    const before = vi.mocked(controls.camera.cancelCalibration).mock.calls.length
    click('등록 취소')
    expect(controls.camera.cancelCalibration).toHaveBeenCalledTimes(before + 1)
    controls.camera.state = 'loading'
    controls.camera.progress = null
    act(() => renderer!.update(<App />))
    click('카메라 준비 취소')
    expect(controls.camera.stop).toHaveBeenCalledOnce()
    expect(controls.camera.connect).not.toHaveBeenCalled()
  })
  it('opens the direct collection link without creating or changing a local profile', () => {
    const before = new Map(data)
    vi.stubGlobal('window', {
      location: { hash: '#collection', pathname: '/', search: '' },
      history: { replaceState: vi.fn() },
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })
    mount()
    expect(text(renderer!.root)).toContain('1. 찍을 자세 선택')
    const picker = () => renderer!.root.findAllByType(SelectMenu).find((menu) => menu.props.id === 'capture-task')!
    expect(picker().props.disabled).toBe(false)
    act(() => picker().props.onChange('lean_left'))
    expect(picker().props.value).toBe('lean_left')
    expect(text(renderer!.root)).toContain('본인 기준 왼쪽으로 몸통을')
    expect(data).toEqual(before)
    expect(controls.camera.connect).not.toHaveBeenCalled()
    click('시작 화면으로')
    expect(renderer!.root.findAllByType(LoginPage)).toHaveLength(1)
    expect(controls.camera.stop).toHaveBeenCalledOnce()
  })
  it('keeps the camera running in a small window on records; expand returns to 측정하기, close only hides it', () => {
    controls.camera.state = 'on'
    mount()
    login()
    click('설정')
    click('자세 데이터 수집')
    click('기록')
    expect(controls.camera.stop).not.toHaveBeenCalled()
    const windowButton = (label: string) =>
      renderer!.root.findAll((node) => node.type === 'button' && node.props['aria-label'] === label)
    expect(text(renderer!.root)).toContain('카메라 사용 중')
    act(() => windowButton('작은 창 닫기')[0].props.onClick())
    expect(windowButton('작은 창 닫기')).toHaveLength(0)
    expect(controls.camera.stop).not.toHaveBeenCalled()
    click('측정하기')
    click('기록')
    act(() => windowButton('측정 화면으로 돌아가기')[0].props.onClick())
    expect(renderer!.root.findAllByType(SetupPage)).toHaveLength(1)
    expect(controls.camera.stop).not.toHaveBeenCalled()
  })
  const startCameraSession = () => {
    controls.camera.state = 'on'
    controls.camera.quality = true
    controls.camera.baseline = { headGap: 0.7, offset: 0, tilt: 0, quality: 0.9 }
    mount()
    login()
    act(() => renderer!.root.findByType(SetupPage).props.onStart())
    expect(renderer!.root.findByType(SessionPage).props.mode).toBe('camera')
  }
  it('ends and saves the running measurement from the small window on another tab (X, 2026-10-20)', () => {
    startCameraSession()
    click('기록')
    // The window shows the running measurement's posture, not just that the camera is on.
    const small = renderer!.root.find(
      (node) => node.type === 'aside' && node.props['aria-label'] === '카메라 작은 창',
    )
    expect(text(small)).toContain('자세를 확인할 수 없어요')
    expect(small.props.className).toContain('status-unknown')
    const end = renderer!.root.findAll(
      (node) => node.type === 'button' && node.props['aria-label'] === '측정 종료',
    )
    expect(end).toHaveLength(1)
    act(() => end[0].props.onClick())
    expect(readLocal<RecordItem[]>(KEYS.records, [])).toHaveLength(1)
    expect(text(renderer!.root.findByType(SessionPage))).toContain('작은 창을 닫아 측정을 끝냈어요')
  })
  it('routes an explicit server opt-in and freezes its baseline, camera shape and rules', () => {
    const screen = startServer()
    const started = structuredClone(screen.props.session)
    expect(renderer!.root.findAllByType(SessionPage)).toHaveLength(0)
    expect(started.server).toEqual({
      baselineId: BASELINE_ID,
      baseline: BASELINE,
      deviceId: 'synthetic-device',
      frameWidth: 640,
      frameHeight: 480,
      setup: {
        device: { key: 'synthetic-device', label: '카메라' },
        frame: { width: 640, height: 480 },
        baseline: expect.objectContaining({
          baseline_id: BASELINE_ID,
          calibration_ms: 5000,
          sample_count: 20,
          target_center_x: 0.5,
          head_gap: { mean: BASELINE.headGap, std: 0.01 },
        }),
      },
    })
    controls.camera.baseline!.headGap = 9
    controls.camera.calibrationId = '33333333-3333-4333-8333-333333333333'
    controls.camera.deviceId = 'synthetic-replacement-device'
    click('설정')
    act(() =>
      renderer!.root.findByType(SettingsPage).props.onRules({ ...DEFAULT_RULES, holdSeconds: 5 }),
    )
    expect(renderer!.root.findByType(ServerSessionPage).props.session).toEqual(started)
    expect(renderer!.root.findByType(ServerSessionPage).props.service.active).toBe(false)
    click('측정하기')
    expect(renderer!.root.findByType(ServerSessionPage).props.service.active).toBe(true)
    expect(controls.camera.connect).not.toHaveBeenCalled()
  })
  it('saves the server checkpoint and confirmed final snapshot without feature payloads in records', () => {
    const screen = startServer()
    const id = screen.props.session.id as string
    const view = acknowledgedView(id)
    const checkpoint = serverCheckpoint({
      view,
      savedAt: new Date().toISOString(),
      elapsedMs: 1000,
      nextSequence: 1,
      modelVersion: 'reference-feature-rule-v1',
    })
    act(() => {
      expect(screen.props.service.onCheckpoint(projectMachine(view), checkpoint)).toBe(true)
    })
    expect(readLocal<Draft | null>(KEYS.draft, null)).toMatchObject({
      id,
      mode: 'camera',
      machine: projectMachine(view),
      server: checkpoint,
    })
    const ended: SessionView = {
      ...view,
      ended: true,
      events: [{
        schema_version: '1.0', session_id: id, event_id: 1, kind: 'session_ended',
        timestamp_ms: 1000, onset_ms: 1000, onset_valid_ms: 1000,
        deviation_type: 'none', reason: 'ended',
      }],
    }
    act(() => screen.props.service.onEnded({
      ...projectLive(ended, null, 'reference-feature-rule-v1'),
      view: ended,
    }))
    const records = readLocal<RecordItem[]>(KEYS.records, [])
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      id, total: 1, valid: 1, good: 1, events: [],
      server: { baselineId: BASELINE_ID, modelVersion: 'reference-feature-rule-v1', confirmed: true, view: ended },
    })
    expect(data.has(KEYS.draft)).toBe(false)
    expect(data.get(KEYS.records)).not.toContain('head_gap_delta')
    expect(data.get(KEYS.records)).not.toContain('landmarks')
  })
  it('archives only the acknowledged summary when server termination is unconfirmed', () => {
    const screen = startServer()
    const id = screen.props.session.id as string
    const initial = serverView({ session_id: id })
    const view: SessionView = {
      ...initial,
      last_sequence: 4,
      summary: {
        ...initial.summary, total_ms: 5000, valid_ms: 5000, deviation_ms: 5000,
        collapse_count: 1, alert_count: 1, keep_rate: 0, events_per_hour: 720,
      },
      events: [{
        schema_version: '1.0', session_id: id, event_id: 1, kind: 'collapse_confirmed',
        timestamp_ms: 3000, onset_ms: 0, onset_valid_ms: 0,
        deviation_type: 'left_lean', reason: null,
      }],
    }
    act(() => screen.props.service.onArchive({
      ...projectLive(view, null, 'reference-feature-rule-v1'),
      view,
    }))
    const record = readLocal<RecordItem[]>(KEYS.records, [])[0]
    expect(record).toMatchObject({
      total: 5, valid: 5, good: 0,
      server: { confirmed: false, view },
    })
    expect(record.events).toHaveLength(1)
    expect(record.events[0]).toMatchObject({
      endAt: 5, durationSec: 5, recovered: false, recoverySec: null,
      endReason: 'unknown', endedBySession: false,
    })
    expect(record.server!.view!.events).toEqual(view.events)
    expect(record.server!.view!.ended).toBe(false)
  })
  it('restores the saved server identity and checkpoint without mounting the local time engine', () => {
    const saved = recoveredServerDraft()
    data.set(KEYS.draft, JSON.stringify(saved))
    mount()
    login()
    click('이어하기')
    const session = renderer!.root.findByType(ServerSessionPage).props.session
    expect(session).toMatchObject({
      id: saved.id, startedAt: saved.startedAt, rules: saved.rules,
      server: { baselineId: BASELINE_ID, baseline: BASELINE, checkpoint: saved.server },
    })
    expect(session.server.finishOnly).toBeUndefined()
    expect(renderer!.root.findAllByType(SessionPage)).toHaveLength(0)
    expect(data.get(KEYS.draft)).toBe(JSON.stringify(saved))
    expect(data.has(KEYS.records)).toBe(false)
    expect(controls.camera.connect).not.toHaveBeenCalled()
  })
  it('requests server draft termination in finish-only mode and waits for acknowledgement', () => {
    const saved = recoveredServerDraft()
    data.set(KEYS.draft, JSON.stringify(saved))
    mount()
    login()
    click('서버 종료 확인·저장')
    expect(renderer!.root.findByType(ServerSessionPage).props.session).toMatchObject({
      id: saved.id,
      server: { checkpoint: saved.server, finishOnly: true, baselineId: BASELINE_ID },
    })
    expect(renderer!.root.findAllByType(SessionPage)).toHaveLength(0)
    expect(data.get(KEYS.draft)).toBe(JSON.stringify(saved))
    expect(data.has(KEYS.records)).toBe(false)
    expect(controls.camera.connect).not.toHaveBeenCalled()
  })
  it('lists 측정하기, 기록, 달력, 설정 in the sidebar (registration lives in 측정하기)', () => {
    mount()
    login()
    const tabs = renderer!.root
      .findAll((node) => node.type === 'button' && node.props.className === 'nav-item')
      .map((button) => text(button))
    expect(tabs).toEqual(['측정하기', '기록', '달력', '설정'])
  })
  const advance = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms)
    })
  const rerender = () => act(() => renderer!.update(<App />))
  it('registers first without a posture: 3·2·1, captures, then starts measuring by itself', () => {
    controls.camera.state = 'on'
    controls.camera.quality = true
    mount()
    login()
    click('측정하기')
    advance(100)
    expect(text(renderer!.root.findByType(SetupPage))).toContain('3초 뒤 기준 자세를 등록해요')
    advance(2800)
    expect(controls.camera.calibrate).not.toHaveBeenCalled()
    advance(200)
    expect(controls.camera.calibrate).toHaveBeenCalledOnce()
    controls.camera.progress = 0.4
    rerender()
    expect(text(renderer!.root.findByType(SetupPage))).toContain('기준 자세를 기억하는 중')
    expect(renderer!.root.findAllByType(SessionPage)).toHaveLength(0)
    // The capture ends and is sent to the server (B1, 2026-10-20).
    controls.camera.progress = null
    controls.camera.registering = true
    rerender()
    advance(100)
    expect(text(renderer!.root.findByType(SetupPage))).toContain('기준 자세를 저장하는 중')
    controls.camera.baseline = { ...BASELINE }
    controls.camera.calibrationId = BASELINE_ID
    controls.camera.registering = false
    rerender()
    advance(100)
    expect(renderer!.root.findByType(SessionPage).props.mode).toBe('camera')
    expect(controls.camera.calibrate).toHaveBeenCalledOnce()
  })
  it('waits for the server posture before asking to register (B2 on start)', () => {
    controls.camera.state = 'on'
    controls.camera.quality = true
    controls.camera.baselineLoading = true
    mount()
    login()
    click('측정하기')
    advance(5000)
    expect(controls.camera.calibrate).not.toHaveBeenCalled()
    controls.camera.baseline = { ...BASELINE }
    controls.camera.calibrationId = BASELINE_ID
    controls.camera.baselineLoading = false
    rerender()
    advance(5000)
    expect(controls.camera.calibrate).not.toHaveBeenCalled()
  })
  it('starts at once from the camera view when a posture is registered', () => {
    controls.camera.state = 'on'
    controls.camera.quality = true
    controls.camera.baseline = { ...BASELINE }
    mount()
    login()
    click('측정하기')
    advance(5000)
    expect(controls.camera.calibrate).not.toHaveBeenCalled()
    const starts = renderer!.root.findAllByType('button').filter((b) => text(b) === '측정 시작')
    expect(starts.length).toBe(2) // camera view and side panel
    act(() => starts[0].props.onClick())
    expect(renderer!.root.findByType(SessionPage).props.mode).toBe('camera')
  })
  it('ends and saves the measurement when the camera in use is unplugged (plan 0053)', () => {
    controls.camera.state = 'on'
    controls.camera.quality = true
    controls.camera.baseline = { ...BASELINE }
    mount()
    login()
    click('측정하기')
    const start = renderer!.root.findAllByType('button').find((b) => text(b) === '측정 시작')!
    act(() => start.props.onClick())
    advance(3000)
    // The USB camera is pulled out: its track ends and the camera reports the disconnection.
    controls.camera.state = 'error'
    controls.camera.error = CAMERA_ERRORS.disconnected
    rerender()
    expect(text(renderer!.root)).toContain('카메라 연결이 끊겨 측정을 끝냈어요')
    expect(readLocal<RecordItem[]>(KEYS.records, [])).toHaveLength(1)
    // Nothing is left open, so 측정하기 is free to choose a camera and start a new measurement.
    click('측정하기')
    expect(renderer!.root.findAllByType(SetupPage)).toHaveLength(1)
  })
  it('starts measuring by itself 2.5 s after 카메라 켜기 when a posture is registered', () => {
    controls.camera.baseline = { ...BASELINE }
    mount()
    login()
    click('측정하기')
    controls.camera.state = 'on'
    controls.camera.quality = true
    rerender()
    advance(1000)
    expect(text(renderer!.root.findByType(SetupPage))).toContain('곧 측정을 시작해요')
    expect(renderer!.root.findAllByType(SessionPage)).toHaveLength(0)
    advance(1600)
    expect(renderer!.root.findByType(SessionPage).props.mode).toBe('camera')
    expect(controls.camera.calibrate).not.toHaveBeenCalled()
  })
  it('restarts the wait when the person leaves view and stops on 취소', () => {
    controls.camera.baseline = { ...BASELINE }
    mount()
    login()
    click('측정하기')
    controls.camera.state = 'on'
    controls.camera.quality = true
    rerender()
    advance(2000)
    controls.camera.quality = false
    rerender()
    advance(500)
    controls.camera.quality = true
    rerender()
    advance(2000)
    expect(renderer!.root.findAllByType(SessionPage)).toHaveLength(0)
    click('취소')
    advance(5000)
    expect(renderer!.root.findAllByType(SessionPage)).toHaveLength(0)
  })
  it('tells the user once when the shoulders leave view and measuring pauses', () => {
    controls.camera.state = 'on'
    controls.camera.quality = true
    controls.camera.baseline = { ...BASELINE }
    mount()
    login()
    click('측정하기')
    const starts = renderer!.root.findAllByType('button').filter((b) => text(b) === '측정 시작')
    act(() => starts[0].props.onClick())
    // The synthetic camera keeps delivering frames, so the session does not pause for input.
    const frames = (ms: number) => {
      for (let t = 0; t < ms; t += 100) {
        controls.camera.lastFrame.current = performance.now()
        advance(100)
      }
    }
    frames(1000)
    expect(text(renderer!.root)).not.toContain('어깨가 화면에서 벗어나')
    ;(controls.camera as unknown as { shoulders: string }).shoulders = 'missing'
    rerender()
    frames(1000)
    expect(text(renderer!.root)).toContain('어깨가 화면에서 벗어나 측정을 잠시 멈췄어요')
    ;(controls.camera as unknown as { shoulders: string | null }).shoulders = null
  })
  it('turns the camera on from the camera view, with a posture or not', () => {
    mount()
    login()
    click('측정하기')
    expect(renderer!.root.findAllByType('button').some((b) => text(b) === '카메라 켜기')).toBe(true)
    controls.camera.baseline = { ...BASELINE }
    rerender()
    expect(text(renderer!.root.findByType(SetupPage))).toContain('등록한 기준 자세로 바로')
    expect(renderer!.root.findAllByType('button').some((b) => text(b) === '카메라 켜기')).toBe(true)
  })
  it('asks to sit back and waits while the shoulders are at the bottom edge (F7)', () => {
    controls.camera.state = 'on'
    controls.camera.quality = true
    ;(controls.camera as unknown as { framing: string }).framing = 'low'
    mount()
    login()
    click('측정하기')
    advance(5000)
    expect(controls.camera.calibrate).not.toHaveBeenCalled()
    expect(text(renderer!.root.findByType(SetupPage))).toContain('조금 뒤로 앉아 주세요')
    ;(controls.camera as unknown as { framing: string }).framing = 'ok'
    rerender()
    advance(3100)
    expect(controls.camera.calibrate).toHaveBeenCalledOnce()
    ;(controls.camera as unknown as { framing: string | null }).framing = null
  })
  it('waits for the face and shoulders before counting down', () => {
    controls.camera.state = 'on'
    controls.camera.quality = false
    mount()
    login()
    click('측정하기')
    advance(5000)
    expect(controls.camera.calibrate).not.toHaveBeenCalled()
    controls.camera.quality = true
    rerender()
    advance(3100)
    expect(controls.camera.calibrate).toHaveBeenCalledOnce()
  })
  it('stops on 등록 취소 and does not restart until asked', () => {
    controls.camera.state = 'on'
    controls.camera.quality = true
    mount()
    login()
    click('측정하기')
    advance(1000)
    click('등록 취소')
    advance(5000)
    expect(controls.camera.calibrate).not.toHaveBeenCalled()
    expect(controls.camera.cancelCalibration).toHaveBeenCalled()
    click('기준 자세 등록 다시 시작')
    advance(3100)
    expect(controls.camera.calibrate).toHaveBeenCalledOnce()
  })
  it('gives up with a reason when the capture never finishes', () => {
    controls.camera.state = 'on'
    controls.camera.quality = true
    mount()
    login()
    click('측정하기')
    advance(3100)
    controls.camera.progress = 0.9
    rerender()
    advance(15100)
    expect(controls.camera.cancelCalibration).toHaveBeenCalled()
    expect(text(renderer!.root.findByType(SetupPage))).toContain('자세를 알아보기 어려워요')
  })
  it('registers again from 설정 and ends with a choice instead of measuring', () => {
    controls.camera.state = 'on'
    controls.camera.quality = true
    controls.camera.baseline = { ...BASELINE }
    mount()
    login()
    click('설정')
    act(() => renderer!.root.findByType(SettingsPage).props.onRegisterAgain())
    const setup = renderer!.root.findByType(SetupPage)
    expect(setup.props.registerAgain).toBe(true)
    expect(text(setup)).toContain('설정으로')
    advance(3100)
    expect(controls.camera.calibrate).toHaveBeenCalledOnce()
    controls.camera.registering = true
    rerender()
    advance(100)
    controls.camera.baseline = { ...BASELINE, headGap: BASELINE.headGap + 0.01 }
    controls.camera.calibrationId = '33333333-3333-4333-8333-333333333333'
    controls.camera.registering = false
    rerender()
    advance(100)
    // From settings it ends with a choice instead of measuring by itself.
    expect(text(renderer!.root.findByType(SetupPage))).toContain('새 기준 자세를 등록했어요')
    expect(renderer!.root.findAllByType(SessionPage)).toHaveLength(0)
    click('설정으로')
    expect(renderer!.root.findAllByType(SettingsPage)).toHaveLength(1)
  })

  describe('local sign-up before the account server exists', () => {
    const input = (name: string) => renderer!.root.find((node) => node.type === 'input' && node.props.name === name)
    const type = (name: string, value: string | number) =>
      act(() => input(name).props.onChange({ target: { value: String(value) } }))
    const choose = (id: string, label: '동의' | '비동의') =>
      act(() =>
        renderer!.root
          .find((node) => node.props['data-consent'] === id)
          .findAllByType('button')
          .find((b) => text(b) === label)!
          .props.onClick(),
      )
    const submitDisabled = () => renderer!.root.findByType(LoginPage).props.submitDisabled

    it('asks for sign-up when this device has no profile', () => {
      data.delete(KEYS.profile)
      mount()
      login()
      expect(text(renderer!.root)).toContain('회원가입을 먼저 해 주세요')
      expect(renderer!.root.findAllByType(SetupPage)).toHaveLength(0)
    })

    it('lets a signed-up profile in without checking the typed credentials', () => {
      mount()
      login()
      expect(renderer!.root.findAllByType(LoginPage)).toHaveLength(0)
    })

    it('starts with nothing chosen and blocks the next step until every required item is agreed', () => {
      data.delete(KEYS.profile)
      mount()
      click('회원가입')
      expect(submitDisabled()).toBe(true)
      click('전체 동의')
      expect(submitDisabled()).toBe(false)
      choose('C4', '비동의')
      expect(submitDisabled()).toBe(true)
      expect(text(renderer!.root)).toContain('필수 항목이라 동의해야 가입할 수 있어요')
      choose('C4', '동의')
      choose('C3', '비동의')
      expect(submitDisabled()).toBe(false)
    })

    it('saves consents without the password and drops age and occupation when C3 is declined', () => {
      data.delete(KEYS.profile)
      mount()
      click('회원가입')
      click('전체 동의')
      choose('C3', '비동의')
      act(() => renderer!.root.findByType(LoginPage).props.onSubmit())
      expect(renderer!.root.findAll((node) => node.type === 'input' && node.props.name === 'age')).toHaveLength(0)
      type('email', 'synthetic@example.com')
      type('password', 'synthetic-password-1')
      type('name', '합성 가입')
      act(() => renderer!.root.findByType(LoginPage).props.onSubmit())
      expect(JSON.parse(data.get(KEYS.profile)!)).toEqual({ name: '합성 가입' })
      const account = JSON.parse(data.get(KEYS.account)!)
      expect(account.email).toBe('synthetic@example.com')
      expect(account.consents.agreed).toEqual({ C1: true, C2: true, C3: false, C4: true, C5: true, C6: true })
      expect([...data.values()].some((value) => value.includes('synthetic-password-1'))).toBe(false)
      // Step 3 (optional posture registration) is shown before entering the app.
      // It reuses the 측정하기 registration in its 다시 등록 mode (never starts a measurement).
      expect(renderer!.root.findByType(SetupPage).props.registerAgain).toBe(true)
      expect(text(renderer!.root)).toContain('3/3 자세 등록 (선택)')
      // Without the hidden capture element the camera cannot connect before the app shell exists.
      expect(renderer!.root.findAll((node) => node.type === 'video' && node.props.className === 'capture-source')).toHaveLength(1)
      // The camera is off in this test, so skipping is offered as the main action.
      click('카메라 없이 넘어가기')
      expect(text(renderer!.root)).not.toContain('3/3 자세 등록')
      expect(renderer!.root.findByType(SetupPage).props.registerAgain).toBeFalsy()
    })

    it('enters 측정하기 after registering the posture in step 3', () => {
      data.delete(KEYS.profile)
      mount()
      click('회원가입')
      click('전체 동의')
      act(() => renderer!.root.findByType(LoginPage).props.onSubmit())
      type('email', 'synthetic@example.com')
      type('password', 'pw')
      type('name', '합성 가입')
      type('age', 31)
      type('occupation', '합성 직업')
      act(() => renderer!.root.findByType(LoginPage).props.onSubmit())
      // The camera turned on in step 3 must be reconnected to the app shell's capture element.
      controls.camera.state = 'on'
      act(() => renderer!.root.findByType(SetupPage).props.onStart())
      expect(controls.camera.connect).toHaveBeenCalledOnce()
      expect(text(renderer!.root)).not.toContain('3/3 자세 등록')
      expect(renderer!.root.findByType(SetupPage).props.registerAgain).toBeFalsy()
    })

    it('keeps age and occupation when C3 is agreed and rejects an empty password', () => {
      data.delete(KEYS.profile)
      mount()
      click('회원가입')
      click('전체 동의')
      act(() => renderer!.root.findByType(LoginPage).props.onSubmit())
      type('email', 'synthetic@example.com')
      type('password', '')
      type('name', '합성 가입')
      type('age', 31)
      type('occupation', '합성 직업')
      act(() => renderer!.root.findByType(LoginPage).props.onSubmit())
      expect(data.has(KEYS.profile)).toBe(false)
      type('password', 'pw')
      act(() => renderer!.root.findByType(LoginPage).props.onSubmit())
      expect(JSON.parse(data.get(KEYS.profile)!)).toEqual({ name: '합성 가입', age: 31, occupation: '합성 직업' })
    })

    it('rejects an age under 14 and a name over 30 characters, as the server does', () => {
      data.delete(KEYS.profile)
      mount()
      click('회원가입')
      click('전체 동의')
      act(() => renderer!.root.findByType(LoginPage).props.onSubmit())
      type('email', 'synthetic@example.com')
      type('password', 'pw')
      type('name', '합성 가입')
      type('age', 13)
      type('occupation', '합성 직업')
      act(() => renderer!.root.findByType(LoginPage).props.onSubmit())
      expect(data.has(KEYS.profile)).toBe(false)
      type('age', 14)
      type('name', '가'.repeat(31))
      act(() => renderer!.root.findByType(LoginPage).props.onSubmit())
      expect(data.has(KEYS.profile)).toBe(false)
      type('name', '합성 가입')
      act(() => renderer!.root.findByType(LoginPage).props.onSubmit())
      expect(JSON.parse(data.get(KEYS.profile)!)).toEqual({ name: '합성 가입', age: 14, occupation: '합성 직업' })
    })
  })
})
