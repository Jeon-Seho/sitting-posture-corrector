import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import App from './ServiceApp'
import { LoginPage } from '../pages/LoginPage'
import { SetupPage } from '../pages/SetupPage'
import { LiveSessionPage } from '../features/session/live/LiveSessionPage'
import type { LiveState } from '../features/session/live/LiveSession'
import { EMPTY_SUMMARY } from '../features/session/live/messages'
import { BASELINE, BASELINE_ID } from '../features/session/server/testFixtures'
import { SettingsPage } from '../pages/SettingsPage'
import { MonthCalendar } from '../features/history/RecordCalendar'
import { SelectMenu } from '../components/SelectMenu'
import type { DailyStat } from '../features/history/recordsSource'
import { DEFAULT_RULES } from '../data/posture'
import { KEYS, loadLocalState, readLocal, type RecordItem } from '../lib/serviceStore'
import type { CameraController } from '../hooks/useCamera'

const controls = vi.hoisted(() => ({
  camera: null as unknown as CameraController,
  writer: 'ready',
}))
vi.mock('../hooks/useCamera', () => ({ useCamera: () => controls.camera }))
// These screen tests sign in on this device; the account server flow is LocalServiceApp.accounts.test.tsx.
vi.mock('../features/auth/accountClient', async (original) => ({
  ...(await original<typeof import('../features/auth/accountClient')>()),
  createAccountClient: () => null,
}))
vi.mock('../hooks/useWriterLock', () => ({
  useWriterLock: () => ({ state: controls.writer, retry: vi.fn() }),
}))
// The measurement talks to the server (LiveSession, own tests); here only the app around it.
vi.mock('../features/session/live/LiveSessionPage', () => ({
  LiveSessionPage: () => <div data-testid="live-session">서버 측정 테스트</div>,
}))

describe('service recovery and saving with synthetic storage only', () => {
  let data: Map<string, string>, renderer: ReactTestRenderer | undefined
  /** What the server confirmed when a measurement ends (synthetic values). */
  const endedState = (): LiveState => ({
    phase: 'ended',
    sending: 'running',
    observation: null,
    summary: { ...EMPTY_SUMMARY, total_ms: 1000, valid_ms: 1000, normal_ms: 1000, keep_rate: 1, events_per_hour: 0 },
    events: [],
    lastSequence: 1,
    alerting: false,
    pausedReason: null,
    stalled: false,
    message: '',
    lost: false,
    startedAt: null,
    endedAt: null,
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
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'))
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
    controls.writer = 'ready'
    controls.camera = {
      state: 'off',
      baseline: null,
      calibrationId: null,
      progress: null,
      registering: false,
      registrationError: null,
      baselineLoading: false,
      baselineError: null,
      quality: false,
      error: '',
      devices: [],
      deviceId: '',
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
      reloadBaseline: vi.fn(),
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
  it('keeps develop real-camera-only preparation and quiet login without requesting permission', () => {
    mount()
    login()
    expect(text(renderer!.root)).not.toContain('저장했어요.')
    const setup = renderer!.root.findByType(SetupPage)
    expect(setup.props.mode).toBeUndefined()
    expect(text(setup)).not.toContain('발표용 시연')
    act(() => setup.props.onStart())
    expect(text(renderer!.root)).toContain('카메라 연결과 기준 등록을 완료')
    expect(renderer!.root.findAllByType(LiveSessionPage)).toHaveLength(0)
    expect(controls.camera.connect).not.toHaveBeenCalled()
  })
  it('starts only a camera session and preserves its rules when settings change', () => {
    controls.camera.state = 'on'
    controls.camera.quality = true
    controls.camera.baseline = { ...BASELINE }
    controls.camera.calibrationId = BASELINE_ID
    mount()
    login()
    act(() => renderer!.root.findByType(SetupPage).props.onStart())
    expect(renderer!.root.findByType(LiveSessionPage).props.session.baselineId).toBe(BASELINE_ID)
    const nextRules = { ...DEFAULT_RULES, holdSeconds: 5 }
    click('설정')
    act(() => renderer!.root.findByType(SettingsPage).props.onRules(nextRules))
    expect(renderer!.root.findByType(LiveSessionPage).props.session.rules).toEqual(DEFAULT_RULES)
    act(() => renderer!.root.findByType(LiveSessionPage).props.service.onEnded(endedState(), ''))
    expect(readLocal<RecordItem[]>(KEYS.records, [])[0].rules).toEqual(DEFAULT_RULES)
    expect(loadLocalState().settings).toEqual(nextRules)
  })
  it('keeps a measurement over KST midnight per day from the server running totals (PR #64 day split)', () => {
    controls.camera.state = 'on'
    controls.camera.quality = true
    controls.camera.baseline = { ...BASELINE }
    controls.camera.calibrationId = BASELINE_ID
    mount()
    login()
    act(() => renderer!.root.findByType(SetupPage).props.onStart())
    const service = () => renderer!.root.findByType(LiveSessionPage).props.service
    // The server started at 23:59:58 KST; days count from `ready.started_at`, not this computer.
    const at = (total: number, normal: number, unknown: number): LiveState => ({
      ...endedState(),
      phase: 'running',
      startedAt: '2026-10-26T14:59:58.000Z',
      summary: { ...EMPTY_SUMMARY, total_ms: total, valid_ms: total - unknown, normal_ms: normal, unknown_ms: unknown },
    })
    act(() => service().onObserved(at(2000, 2000, 0)))
    act(() => service().onEnded({ ...at(6000, 4000, 2000), phase: 'ended' }, ''))
    const [record] = readLocal<RecordItem[]>(KEYS.records, [])
    expect(record.startedAt).toBe('2026-10-26T14:59:58.000Z')
    expect(record.days).toMatchObject([
      { date: '2026-10-26', total: 2, valid: 2, good: 2 },
      { date: '2026-10-27', total: 4, valid: 2, good: 2 },
    ])
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
    click('기록')
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
    controls.camera.baseline = { ...BASELINE }
    controls.camera.calibrationId = BASELINE_ID
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
  it('keeps the camera running on records without a small window (web, 2026-10-26)', () => {
    controls.camera.state = 'on'
    mount()
    login()
    click('설정')
    click('자세 데이터 수집')
    click('오늘')
    expect(controls.camera.stop).not.toHaveBeenCalled()
    expect(text(renderer!.root)).not.toContain('카메라 사용 중')
    click('측정하기')
    expect(renderer!.root.findAllByType(SetupPage)).toHaveLength(1)
    expect(controls.camera.stop).not.toHaveBeenCalled()
  })
  it('lists 측정하기, 기록, 달력, 설정 in the sidebar (registration lives in 측정하기)', () => {
    mount()
    login()
    const tabs = renderer!.root
      .findAll((node) => node.type === 'button' && node.props.className === 'nav-item')
      .map((button) => text(button))
    expect(tabs).toEqual(['측정하기', '오늘', '기록', '설정'])
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
    expect(renderer!.root.findAllByType(LiveSessionPage)).toHaveLength(0)
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
    expect(renderer!.root.findByType(LiveSessionPage).props.session.baselineId).toBe(BASELINE_ID)
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
  it('lets the user load again or register when B2 failed, without registering by itself', () => {
    controls.camera.state = 'on'
    controls.camera.quality = true
    controls.camera.baselineError = '서버에 연결하지 못했어요. 연결을 확인한 뒤 다시 불러와 주세요.'
    mount()
    login()
    click('측정하기')
    advance(5000)
    expect(controls.camera.calibrate).not.toHaveBeenCalled()
    expect(text(renderer!.root.findByType(SetupPage))).toContain('등록한 기준 자세를 불러오지 못했어요')
    click('다시 불러오기')
    expect(controls.camera.reloadBaseline).toHaveBeenCalledOnce()
    click('새로 등록')
    advance(3500)
    expect(controls.camera.calibrate).toHaveBeenCalledOnce()
  })
  it('starts at once from the camera view when a posture is registered', () => {
    controls.camera.state = 'on'
    controls.camera.quality = true
    controls.camera.baseline = { ...BASELINE }
    controls.camera.calibrationId = BASELINE_ID
    mount()
    login()
    click('측정하기')
    advance(5000)
    expect(controls.camera.calibrate).not.toHaveBeenCalled()
    const starts = renderer!.root.findAllByType('button').filter((b) => text(b) === '측정 시작')
    expect(starts.length).toBe(1) // one primary action on the camera view
    act(() => starts[0].props.onClick())
    expect(renderer!.root.findByType(LiveSessionPage).props.session.baselineId).toBe(BASELINE_ID)
  })
  it('starts measuring by itself 2.5 s after 카메라 켜기 when a posture is registered', () => {
    controls.camera.baseline = { ...BASELINE }
    controls.camera.calibrationId = BASELINE_ID
    mount()
    login()
    click('측정하기')
    controls.camera.state = 'on'
    controls.camera.quality = true
    rerender()
    advance(1000)
    expect(text(renderer!.root.findByType(SetupPage))).toContain('곧 측정을 시작해요')
    expect(renderer!.root.findAllByType(LiveSessionPage)).toHaveLength(0)
    advance(1600)
    expect(renderer!.root.findByType(LiveSessionPage).props.session.baselineId).toBe(BASELINE_ID)
    expect(controls.camera.calibrate).not.toHaveBeenCalled()
  })
  it('restarts the wait when the person leaves view and stops on 취소', () => {
    controls.camera.baseline = { ...BASELINE }
    controls.camera.calibrationId = BASELINE_ID
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
    expect(renderer!.root.findAllByType(LiveSessionPage)).toHaveLength(0)
    click('취소')
    advance(5000)
    expect(renderer!.root.findAllByType(LiveSessionPage)).toHaveLength(0)
  })
  it('turns the camera on from the camera view, with a posture or not', () => {
    mount()
    login()
    click('측정하기')
    expect(renderer!.root.findAllByType('button').some((b) => text(b) === '카메라 켜기')).toBe(true)
    controls.camera.baseline = { ...BASELINE }
    controls.camera.calibrationId = BASELINE_ID
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
    controls.camera.calibrationId = BASELINE_ID
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
    controls.camera.baseline = { ...BASELINE, baselineId: '33333333-3333-4333-8333-333333333333' }
    controls.camera.calibrationId = '33333333-3333-4333-8333-333333333333'
    controls.camera.registering = false
    rerender()
    advance(100)
    // From settings it ends with a choice instead of measuring by itself.
    expect(text(renderer!.root.findByType(SetupPage))).toContain('새 기준 자세를 등록했어요')
    expect(renderer!.root.findAllByType(LiveSessionPage)).toHaveLength(0)
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
