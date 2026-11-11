import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeveloperToolsPage } from './DeveloperToolsPage'
import type { CameraController } from '../hooks/useCamera'
import { CAMERA_ERRORS } from '../features/camera/errors'

const camera = { state: 'off', quality: false, metrics: { fps: 0, inferenceMs: 0, delegate: 'CPU' }, trackingFps: null, subscribe: () => () => {}, setTrackingFps: vi.fn(), tryTrackingFps: vi.fn() } as unknown as CameraController

describe('developer tool destinations and visible sections', () => {
  let renderer: ReactTestRenderer
  const callbacks = () => ({ onHasHistory: vi.fn(), onCollect: vi.fn(), onCamera: vi.fn(), onSettings: vi.fn(), onRecords: vi.fn(), onCalendar: vi.fn() })
  const click = (label: string) => act(() => renderer.root.findAllByType('button').find(button => button.children.join('') === label)!.props.onClick())
  function mount() {
    const actions = callbacks()
    act(() => { renderer = create(<DeveloperToolsPage camera={camera} hasHistory={false} {...actions} />) })
    return actions
  }
  afterEach(() => { act(() => renderer?.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
  it('shows only the selected tool category and starts on error pages', () => {
    mount()
    expect(renderer.root.findAllByProps({ role: 'tabpanel' })).toHaveLength(1)
    expect(renderer.root.findByProps({ role: 'tabpanel' }).props['data-dev-section']).toBe('errors')
    expect(renderer.root.findAllByProps({ 'aria-label': '카메라 오류 상황' })).toHaveLength(0)
    click('카메라·인식')
    expect(renderer.root.findByProps({ role: 'tabpanel' }).props['data-dev-section']).toBe('camera')
    expect(renderer.root.findAllByProps({ 'aria-label': '웹 오류 종류' })).toHaveLength(0)
    expect(renderer.root.findAllByProps({ 'aria-label': '카메라 오류 상황' })).toHaveLength(1)
  })
  it('keeps collection and test-data controls inside their own category', () => {
    mount()
    expect(renderer.root.findAllByProps({ 'aria-label': '발표용 예시 기록 표시' })).toHaveLength(0)
    click('기록·수집')
    expect(renderer.root.findAllByProps({ 'aria-label': '발표용 예시 기록 표시' })).toHaveLength(1)
    const entry = renderer.root.findByType('a')
    expect(entry.props.href).toBe('/dev')
    expect(entry.props.target).toBe('_blank')
    expect(entry.props.rel).toContain('noopener')
  })
  it('supports keyboard category selection and a single tab stop', () => {
    mount()
    const selected = () => renderer.root.findAllByProps({ role: 'tab' }).find(tab => tab.props['aria-selected'])!
    act(() => selected().props.onKeyDown({ key: 'ArrowRight', preventDefault: vi.fn() }))
    expect(selected().children).toEqual(['카메라·인식'])
    expect(renderer.root.findAllByProps({ role: 'tab' }).filter(tab => tab.props.tabIndex === 0)).toHaveLength(1)
    act(() => selected().props.onKeyDown({ key: 'End', preventDefault: vi.fn() }))
    expect(renderer.root.findByProps({ role: 'tabpanel' }).props['data-dev-section']).toBe('diagnostics')
    act(() => selected().props.onKeyDown({ key: 'Home', preventDefault: vi.fn() }))
    expect(renderer.root.findByProps({ role: 'tabpanel' }).props['data-dev-section']).toBe('errors')
  })
  it('opens collection in the current Electron window', () => {
    vi.stubGlobal('window', { posegoodDesktop: { version: 1, platform: 'win32' } })
    mount()
    click('기록·수집')
    expect(renderer.root.findByType('a').props.target).toBe('_self')
    expect(renderer.root.findByType('a').props.href).toBe('/dev')
  })
  it('reuses the real desktop connecting page for the fifth preview', () => {
    mount()
    act(() => renderer.root.findByProps({ 'data-error-kind': 'connecting' }).props.onClick())
    expect(renderer.root.findByProps({ className: 'dev-error-art' }).props.kind).toBe('error-504')
    click('선택한 오류 재현')
    const url = new URL(renderer.root.findByType('iframe').props.src, 'https://example.invalid')
    expect(url.pathname).toBe('/offline.html')
    expect(url.searchParams.get('accent')).toBe('#18794e')
    expect(renderer.root.findByType('iframe').props.title).toBe('앱 연결 중 화면')
  })
  it('reproduces the selected error with the actual themed ErrorPage component', () => {
    mount()
    const option = renderer.root.findByProps({ 'data-error-kind': 'offline' })
    act(() => option.props.onClick())
    expect(renderer.root.findByProps({ className: 'dev-error-art' }).props.kind).toBe('error-502')
    click('선택한 오류 재현')
    expect(renderer.root.findByProps({ id: 'error-title' }).children.join('')).toBe('인터넷 연결을 확인해 주세요')
    const close = renderer.root.findAllByType('button').find(button => button.children.join('') === '미리보기 닫기')!
    act(() => close.props.onClick())
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0)
  })
  it('connects camera, theme, data collection and examples to actual destinations', () => {
    const actions = mount()
    click('카메라·인식')
    click('측정하기에서 카메라 확인'); expect(actions.onCamera).toHaveBeenCalledOnce()
    click('화면·모션')
    click('화면 꾸미기 열기'); expect(actions.onSettings).toHaveBeenCalledOnce()
    click('기록·수집')
    click('기존 CSV 수집 열기'); expect(actions.onCollect).toHaveBeenCalledOnce()
    click('예시 오늘 화면 열기'); expect(actions.onHasHistory).toHaveBeenCalledWith(true); expect(actions.onRecords).toHaveBeenCalledOnce()
    click('예시 기록·달력 열기'); expect(actions.onCalendar).toHaveBeenCalledOnce()
  })
  it('executes recovery and media errors before displaying their outcomes', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('window', { posegoodDesktop: { version: 1 } })
    mount()
    click('카메라·인식')
    click('안내 팝업 열기')
    expect(renderer.root.findAllByProps({ role: 'alertdialog' })).toHaveLength(0)
    await act(async () => { await vi.advanceTimersByTimeAsync(2200) })
    expect(renderer.root.findByProps({ role: 'alertdialog' }).findAllByType('p').some(p => p.children.join('').includes('CPU 처리로 전환'))).toBe(true)
    click('확인')
    click('테스트 종료')
    click('오류 화면 열기')
    await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
    const preview = renderer.root.findByProps({ className: 'fault-preview-state' })
    expect(preview.findByType('p').children.join('')).toBe(CAMERA_ERRORS.permissionDenied)
    click('미리보기 닫기')
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0)
  })
  it('opens an interactive modal instead of an inline motion sample', () => {
    mount()
    click('화면·모션')
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0)
    click('화면·모션 미리보기 열기')
    expect(renderer.root.findAllByType('dialog')).toHaveLength(1)
    click('준비 단계 넘기기')
    click('미리보기 닫기')
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0)
  })
})
