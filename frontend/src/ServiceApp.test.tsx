import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import App from './ServiceApp'
import { LoginPage } from './pages/LoginPage'
import { SetupPage } from './pages/SetupPage'
import { SessionPage } from './pages/SessionPage'
import { SettingsPage } from './pages/SettingsPage'
import { RecordComparison } from './components/RecordComparison'
import { DEFAULT_RULES } from './data/posture'
import { newMachine } from './lib/engine'
import { KEYS, loadLocalState, readLocal, type Draft, type RecordItem } from './lib/serviceStore'
import type { CameraController } from './hooks/useCamera'

const controls = vi.hoisted(() => ({ camera: null as unknown as CameraController, writer: 'ready' }))
vi.mock('./hooks/useCamera', () => ({ useCamera: () => controls.camera }))
vi.mock('./hooks/useWriterLock', () => ({ useWriterLock: () => ({ state: controls.writer, retry: vi.fn() }) }))

describe('service recovery and saving with synthetic storage only', () => {
  let data: Map<string, string>, renderer: ReactTestRenderer | undefined
  const machine = () => { const m = newMachine(); m.total = 120; m.good = 100; m.collapse = 20; return m }
  const draft = (): Draft => ({ id: 'synthetic-draft', startedAt: '2026-09-30T10:00:00Z', savedAt: '2026-09-30T10:02:00Z', mode: 'demo', rules: DEFAULT_RULES, machine: machine() })
  const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('')
  const click = (label: string) => act(() => renderer!.root.findAllByType('button').find(b => text(b) === label)!.props.onClick())
  const login = () => act(() => renderer!.root.findByType(LoginPage).props.onSubmit())
  const mount = () => act(() => { renderer = create(<App/>) })
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-30T12:00:00Z'))
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
    controls.writer = 'ready'
    controls.camera = { state: 'off', baseline: null, calibrationId: null, progress: null, quality: false, error: '', devices: [], deviceId: '',
      current: { current: null }, lastFrame: { current: 0 }, videoRef: { current: null }, canvasRef: { current: null }, streamRef: { current: null },
      metrics: { fps: 0, inferenceMs: 0, delegate: 'CPU' }, visual: { mode: 'skeleton', enabled: true, reducedMotion: false, startedAt: 0 },
      stop: vi.fn(), connect: vi.fn(), calibrate: vi.fn(), cancelCalibration: vi.fn(), setOverlayEnabled: vi.fn(),
      setVisualMode: vi.fn(), reassemble: vi.fn(), setReducedMotion: vi.fn(), subscribe: () => () => {},
    } as unknown as CameraController
    data = new Map([[KEYS.profile, JSON.stringify({ name: '합성 테스트', age: 23, occupation: '테스트' })]])
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => data.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => data.set(key, value)),
      removeItem: vi.fn((key: string) => data.delete(key)),
    })
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  })
  afterEach(() => {
    act(() => renderer?.unmount()); renderer = undefined
    vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  })
  it('preserves malformed records, lets a stored profile view them safely, and blocks new writes', () => {
    const raw = '[{"id":"damaged"}]'; data.set(KEYS.records, raw)
    mount(); login()
    expect(text(renderer!.root)).toContain('기존 자료는 유지됩니다')
    expect(data.get(KEYS.records)).toBe(raw)
    click('측정 시작')
    act(() => renderer!.root.findByType(SetupPage).props.onStart())
    expect(text(renderer!.root)).toContain('새 측정을 시작할 수 없습니다')
    expect(data.get(KEYS.records)).toBe(raw); expect(data.has(KEYS.draft)).toBe(false)
    expect(controls.camera.connect).not.toHaveBeenCalled()
  })
  it('keeps a second tab read-only without changing the saved profile', () => {
    controls.writer = 'busy'; const before = data.get(KEYS.profile)
    mount(); login()
    expect(text(renderer!.root)).toContain('다른 탭')
    expect(localStorage.setItem).not.toHaveBeenCalled(); expect(data.get(KEYS.profile)).toBe(before)
  })
  it('does not overwrite an unresolved checkpoint when a new session is requested', () => {
    const raw = JSON.stringify(draft()); data.set(KEYS.draft, raw)
    mount(); login(); click('측정 시작')
    act(() => renderer!.root.findByType(SetupPage).props.onStart())
    expect(text(renderer!.root)).toContain('중단된 측정을 이어하거나')
    expect(data.get(KEYS.draft)).toBe(raw)
  })
  it('retries a failed recovered result with the same ID and end time and saves it once', () => {
    data.set(KEYS.draft, JSON.stringify(draft()))
    mount(); login()
    vi.mocked(localStorage.setItem).mockImplementationOnce(() => { throw new Error('Synthetic quota failure') })
    click('여기까지 종료·저장')
    expect(text(renderer!.root)).toContain('저장하지 못했습니다'); expect(data.has(KEYS.draft)).toBe(true)
    act(() => { vi.advanceTimersByTime(5000) })
    const records = readLocal<RecordItem[]>(KEYS.records, [])
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ id: draft().id, endedAt: draft().savedAt, total: 120, valid: 120, good: 100, rules: DEFAULT_RULES })
    expect(data.has(KEYS.draft)).toBe(false)
  })
  it('distinguishes final-save success from draft-cleanup failure and never offers duplicate recovery', () => {
    data.set(KEYS.draft, JSON.stringify(draft()))
    mount(); login()
    vi.mocked(localStorage.removeItem).mockImplementationOnce(() => { throw new Error('Synthetic cleanup failure') })
    click('여기까지 종료·저장')
    expect(text(renderer!.root)).toContain('결과는 저장했습니다')
    expect(readLocal<RecordItem[]>(KEYS.records, [])).toHaveLength(1)
    expect(loadLocalState().draft).toBeNull(); expect(data.has(KEYS.draft)).toBe(true)
  })
  it('restores paused totals, preserves them across page navigation and ends without loss', () => {
    data.set(KEYS.draft, JSON.stringify(draft()))
    mount(); login(); click('이어하기')
    expect(text(renderer!.root)).toContain('휴식 중')
    click('홈으로'); click('실시간 측정'); click('측정 종료')
    const records = readLocal<RecordItem[]>(KEYS.records, [])
    expect(records).toHaveLength(1); expect(records[0]).toMatchObject({ total: 120, valid: 120, good: 100 })
    expect(text(renderer!.root)).toContain('이 브라우저에 저장했습니다')
  })
  it('keeps develop real-camera-only preparation and quiet login without requesting permission', () => {
    mount(); login()
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
    controls.camera.state = 'on'; controls.camera.quality = true
    controls.camera.baseline = { headGap: .7, offset: 0, tilt: 0, quality: .9 }
    mount(); login(); click('측정 시작')
    act(() => renderer!.root.findByType(SetupPage).props.onStart())
    expect(renderer!.root.findByType(SessionPage).props.mode).toBe('camera')
    const nextRules = { ...DEFAULT_RULES, holdSeconds: 5 }
    click('설정')
    act(() => renderer!.root.findByType(SettingsPage).props.onRules(nextRules))
    expect(renderer!.root.findByType(SessionPage).props.rules).toEqual(DEFAULT_RULES)
    click('실시간 측정'); click('측정 종료')
    expect(readLocal<RecordItem[]>(KEYS.records, [])[0].rules).toEqual(DEFAULT_RULES)
    expect(loadLocalState().settings).toEqual(nextRules)
  })
  it('preserves develop combined records and scopes comparison to the selected input kind', () => {
    const item: RecordItem = { id: 'synthetic-camera', startedAt: '2026-09-30T10:00:00Z', endedAt: '2026-09-30T10:02:00Z', mode: 'camera', total: 100, valid: 100, good: 80, events: [] }
    const records = [item, { ...item, id: 'synthetic-demo', mode: 'demo' as const, good: 20 }]
    data.set(KEYS.records, JSON.stringify(records))
    mount(); login(); click('대시보드')
    expect(renderer!.root.findByType(RecordComparison).props.records).toEqual(records)
    expect(text(renderer!.root)).toContain('실제 웹캠·합성 시연 합산')
    click('실제 웹캠 기록')
    expect(renderer!.root.findByType(RecordComparison).props.records).toEqual([item])
    click('합성 시연 기록')
    expect(renderer!.root.findByType(RecordComparison).props.records.map((r: RecordItem) => r.id)).toEqual(['synthetic-demo'])
  })
  it('keeps two-stage withdrawal confirmation cancellable without deleting synthetic data', () => {
    mount(); login(); click('설정'); click('프로필 설정'); click('탈퇴하기')
    expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
    click('삭제하기')
    const dialog = renderer!.root.findByProps({ role: 'dialog' })
    expect(localStorage.removeItem).not.toHaveBeenCalled()
    act(() => dialog.findAllByType('button').find(b => text(b) === '취소')!.props.onClick())
    expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
    expect(data.has(KEYS.profile)).toBe(true); expect(localStorage.removeItem).not.toHaveBeenCalled()
  })
  it('keeps camera and calibration cancellation available inside collection', () => {
    controls.camera.state = 'on'; controls.camera.quality = true; controls.camera.progress = .4
    controls.camera.baseline = { headGap: .7, offset: 0, tilt: 0, quality: .9 }
    mount(); login(); click('자세 등록'); click('보정 취소')
    expect(controls.camera.cancelCalibration).toHaveBeenCalledOnce()
    controls.camera.state = 'loading'; controls.camera.progress = null
    act(() => renderer!.update(<App/>)); click('카메라 준비 취소')
    expect(controls.camera.stop).toHaveBeenCalledOnce()
    expect(controls.camera.connect).not.toHaveBeenCalled()
  })
})
