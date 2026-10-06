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
import { RecordComparison } from '../components/RecordComparison'
import { DEFAULT_RULES } from '../data/posture'
import { newMachine } from '../lib/engine'
import { KEYS, loadLocalState, readLocal, type Draft, type RecordItem } from '../lib/serviceStore'
import type { CameraController } from '../hooks/useCamera'

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
  it('does not overwrite an unresolved checkpoint when a new session is requested', () => {
    const raw = JSON.stringify(draft())
    data.set(KEYS.draft, raw)
    mount()
    login()
    click('측정 시작')
    act(() => renderer!.root.findByType(SetupPage).props.onStart())
    expect(text(renderer!.root)).toContain('중단된 측정을 이어하거나')
    expect(data.get(KEYS.draft)).toBe(raw)
  })
  it('retries a failed recovered result with the same ID and end time and saves it once', () => {
    data.set(KEYS.draft, JSON.stringify(draft()))
    mount()
    login()
    vi.mocked(localStorage.setItem).mockImplementationOnce(() => {
      throw new Error('Synthetic quota failure')
    })
    click('여기까지 종료·저장')
    expect(text(renderer!.root)).toContain('저장하지 못했습니다')
    expect(data.has(KEYS.draft)).toBe(true)
    act(() => {
      vi.advanceTimersByTime(5000)
    })
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
  })
  it('distinguishes final-save success from draft-cleanup failure and never offers duplicate recovery', () => {
    data.set(KEYS.draft, JSON.stringify(draft()))
    mount()
    login()
    vi.mocked(localStorage.removeItem).mockImplementationOnce(() => {
      throw new Error('Synthetic cleanup failure')
    })
    click('여기까지 종료·저장')
    expect(text(renderer!.root)).toContain('결과는 저장했습니다')
    expect(readLocal<RecordItem[]>(KEYS.records, [])).toHaveLength(1)
    expect(loadLocalState().draft).toBeNull()
    expect(data.has(KEYS.draft)).toBe(true)
  })
  it('restores paused totals, preserves them across page navigation and ends without loss', () => {
    data.set(KEYS.draft, JSON.stringify(draft()))
    mount()
    login()
    click('이어하기')
    expect(text(renderer!.root)).toContain('쉬는 중')
    click('기록')
    click('측정하기')
    click('측정 종료')
    const records = readLocal<RecordItem[]>(KEYS.records, [])
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ total: 120, valid: 120, good: 100 })
    expect(text(renderer!.root)).toContain('이 브라우저에 저장했습니다')
  })
  it('keeps develop real-camera-only preparation and quiet login without requesting permission', () => {
    mount()
    login()
    expect(text(renderer!.root)).not.toContain('저장했습니다.')
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
  it('preserves develop combined records and scopes comparison to the selected input kind', () => {
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
    click('기록')
    expect(renderer!.root.findByType(RecordComparison).props.records).toEqual(records)
    expect(text(renderer!.root)).toContain('실제 웹캠·합성 시연 합산')
    click('실제 웹캠 기록')
    expect(renderer!.root.findByType(RecordComparison).props.records).toEqual([item])
    click('합성 시연 기록')
    expect(
      renderer!.root.findByType(RecordComparison).props.records.map((r: RecordItem) => r.id),
    ).toEqual(['synthetic-demo'])
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
    click('보정 취소')
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
    const picker = renderer!.root.findByProps({ id: 'capture-task' })
    expect(picker.props.disabled).toBe(false)
    act(() => picker.props.onChange({ target: { value: 'lean_left' } }))
    expect(renderer!.root.findByProps({ id: 'capture-task' }).props.value).toBe('lean_left')
    expect(text(renderer!.root)).toContain('본인 기준 왼쪽으로 몸통을')
    expect(data).toEqual(before)
    expect(controls.camera.connect).not.toHaveBeenCalled()
    click('시작 화면으로')
    expect(renderer!.root.findAllByType(LoginPage)).toHaveLength(1)
    expect(controls.camera.stop).toHaveBeenCalledOnce()
  })
  it('keeps the camera running when visiting records and exposes an explicit stop control', () => {
    controls.camera.state = 'on'
    mount()
    login()
    click('설정')
    click('자세 데이터 수집')
    click('기록')
    expect(controls.camera.stop).not.toHaveBeenCalled()
    expect(text(renderer!.root)).toContain('카메라 사용 중')
    click('카메라 사용 종료')
    expect(controls.camera.stop).toHaveBeenCalledOnce()
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
})
