import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { AppSidebar } from './AppSidebar'
import { LocalServiceApp } from './LocalServiceApp'
import { LoginPage } from '../pages/LoginPage'
import { SetupPage } from '../pages/SetupPage'
import { KEYS } from '../lib/serviceStore'
import type { CameraController } from '../hooks/useCamera'
import { AccountError, type AccountClient, type AccountView } from '../features/auth/accountClient'

vi.mock('../hooks/useWriterLock', () => ({ useWriterLock: () => ({ state: 'ready', retry: vi.fn() }) }))

const VIEW: AccountView = {
  user_id: '42',
  email: 'synthetic@example.invalid',
  profile: { name: '합성 서버', age: 31, occupation: null },
}

function camera(): CameraController {
  return {
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
}

describe('sign-in with the account server (D-66, /v2/auth)', () => {
  let data: Map<string, string>
  let renderer: ReactTestRenderer | undefined
  let accounts: { [K in keyof AccountClient]: ReturnType<typeof vi.fn> }
  const text = (node: ReactTestInstance | string): string =>
    typeof node === 'string' ? node : node.children.map(text).join('')
  const input = (name: string) => renderer!.root.find((node) => node.type === 'input' && node.props.name === name)
  const type = (name: string, value: string | number) =>
    act(() => input(name).props.onChange({ target: { value: String(value) } }))
  const submit = () => act(async () => renderer!.root.findByType(LoginPage).props.onSubmit())
  const click = (label: string) =>
    act(() => renderer!.root.findAllByType('button').find((b) => text(b) === label)!.props.onClick())
  const mount = () =>
    act(async () => {
      renderer = create(<LocalServiceApp camera={camera()} accounts={accounts as unknown as AccountClient} />)
    })

  beforeEach(() => {
    data = new Map()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => data.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => data.set(key, value)),
      removeItem: vi.fn((key: string) => data.delete(key)),
    })
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    accounts = {
      me: vi.fn(async () => null),
      register: vi.fn(async () => VIEW),
      login: vi.fn(async () => VIEW),
      logout: vi.fn(async () => undefined),
      userId: vi.fn(() => '42'),
    }
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = undefined
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('checks the typed credentials on the server and keeps a profile copy on this device', async () => {
    await mount()
    type('email', VIEW.email)
    type('password', 'synthetic-password-12')
    await submit()
    expect(text(renderer!.root)).not.toContain('개발자 도구')
    click('설정')
    expect(text(renderer!.root)).not.toContain('발표용 예시 기록 표시')
    expect(accounts.login).toHaveBeenCalledWith(VIEW.email, 'synthetic-password-12')
    expect(renderer!.root.findAllByType(LoginPage)).toHaveLength(0)
    expect(JSON.parse(data.get(KEYS.profile)!)).toEqual({ name: '합성 서버', age: 31 })
    expect([...data.values()].some((value) => value.includes('synthetic-password-12'))).toBe(false)
  })
  it('does not open a direct collection address for an ordinary server account', async () => {
    vi.stubGlobal('window', { location: { hash: '#collection' }, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    await mount()
    expect(text(renderer!.root)).not.toContain('1. 찍을 자세 선택')
    type('email', VIEW.email)
    type('password', 'synthetic-password-12')
    await submit()
    expect(renderer!.root.findAllByType(SetupPage)).toHaveLength(1)
    expect(text(renderer!.root)).not.toContain('1. 찍을 자세 선택')
    expect(text(renderer!.root)).not.toContain('개발자 도구')
  })
  it('accepts admin/1234 without server login or changing stored profile', async () => {
    await mount()
    type('email', 'admin')
    type('password', '1234')
    await submit()
    expect(accounts.login).not.toHaveBeenCalled()
    expect(renderer!.root.findAllByType(LoginPage)).toHaveLength(0)
    expect(text(renderer!.root)).toContain('개발자 계정')
    expect(data.has(KEYS.profile)).toBe(false)
    const tabs = renderer!.root.findAllByProps({ className: 'nav-item' }).map(text)
    expect(tabs.slice(-2)).toEqual(['설정', '개발자 도구'])
    click('개발자 도구')
    expect(text(renderer!.root)).toContain('그래픽 가속·CPU 전환')
    expect(text(renderer!.root)).toContain('카메라 오류 안내')
    expect(renderer!.root.findAllByType('button').find(n => n.props['aria-label'] === '발표용 예시 기록 표시')?.props['aria-pressed']).toBe(false)
  })
  it('rejects a wrong developer password without sending it to the server', async () => {
    await mount()
    type('email', 'admin')
    type('password', 'wrong')
    await submit()
    expect(accounts.login).not.toHaveBeenCalled()
    expect(renderer!.root.findAllByType(LoginPage)).toHaveLength(1)
  })
  it('ignores a late account restoration after developer entry', async () => {
    let restore!: (view: AccountView) => void
    accounts.me.mockImplementation(() => new Promise(resolve => { restore = resolve }))
    await mount()
    type('email', 'admin')
    type('password', '1234')
    await submit()
    await act(async () => restore(VIEW))
    expect(text(renderer!.root)).toContain('개발자 계정')
    expect(data.has(KEYS.profile)).toBe(false)
    const tabs = renderer!.root.findAllByProps({ className: 'nav-item' }).map(text)
    expect(tabs.slice(-2)).toEqual(['설정', '개발자 도구'])
    click('개발자 도구')
    expect(text(renderer!.root)).toContain('그래픽 가속·CPU 전환')
    expect(text(renderer!.root)).toContain('카메라 오류 안내')
    expect(renderer!.root.findAllByType('button').find(n => n.props['aria-label'] === '발표용 예시 기록 표시')?.props['aria-pressed']).toBe(false)
  })

  it('stays on the sign-in screen with the server reason when login fails', async () => {
    accounts.login.mockRejectedValueOnce(new AccountError('x', 403, 'ACCOUNT_CLOSED'))
    await mount()
    type('email', VIEW.email)
    type('password', 'synthetic-password-12')
    await submit()
    expect(renderer!.root.findAllByType(LoginPage)).toHaveLength(1)
    expect(text(renderer!.root)).toContain('탈퇴한 계정입니다')
  })

  it('signs in again from the login cookie without typing (A4)', async () => {
    accounts.me.mockResolvedValueOnce(VIEW)
    await mount()
    expect(renderer!.root.findAllByType(LoginPage)).toHaveLength(0)
  })

  it('signs up on the server with 12+ character passwords and the agreed consents, then offers posture step 3', async () => {
    await mount()
    click('회원가입')
    click('전체 동의')
    await submit()
    type('email', VIEW.email)
    type('password', 'short-pw')
    type('name', '합성 서버')
    type('age', 31)
    type('occupation', '합성 직업')
    await submit()
    expect(accounts.register).not.toHaveBeenCalled()
    expect(text(renderer!.root)).toContain('12자 이상')
    type('password', 'synthetic-password-12')
    await submit()
    expect(accounts.register).toHaveBeenCalledOnce()
    const body = accounts.register.mock.calls[0][0]
    expect(body.profile).toEqual({ name: '합성 서버', age: 31, occupation: '합성 직업' })
    expect(body.consents.map((c: { type: string }) => c.type)).toContain('OPTIONAL_PROFILE')
    expect(renderer!.root.findByType(SetupPage).props.registerAgain).toBe(true)
    expect(text(renderer!.root)).toContain('3/3 자세 등록')
  })

  it('asks the server day again on opening 기록·달력, at most once a minute (ADR 0029)', async () => {
    accounts.me.mockResolvedValueOnce(VIEW)
    accounts.refreshServerTime = vi.fn(async () => undefined)
    await mount()
    const openTab = (tab: string) =>
      act(() => renderer!.root.findByType(AppSidebar).props.go(tab))
    openTab('records')
    expect(accounts.refreshServerTime).toHaveBeenCalledOnce()
    openTab('calendar')
    expect(accounts.refreshServerTime).toHaveBeenCalledOnce()
  })

  it('ends the server login on logout', async () => {
    accounts.me.mockResolvedValueOnce(VIEW)
    await mount()
    await act(async () => {
      renderer!.root.findAll((node) => typeof node.props.logout === 'function')[0].props.logout()
    })
    expect(accounts.logout).toHaveBeenCalledOnce()
    expect(renderer!.root.findAllByType(LoginPage)).toHaveLength(1)
  })
})
