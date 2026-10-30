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
  it('shows five expanded sections with a jump menu', () => {
    mount()
    expect(renderer.root.findAllByProps({ className: 'dev-section' })).toHaveLength(5)
    expect(renderer.root.findAllByType('details')).toHaveLength(0)
    expect(renderer.root.findByProps({ 'aria-label': '개발자 도구 바로가기' }).findAllByType('button')).toHaveLength(5)
  })
  it('places the test-data toggle before the navigation and sections', () => {
    mount()
    const page = renderer.root.findByProps({ className: 'developer-page' })
    const children = page.children.filter(child => typeof child !== 'string')
    expect((children[1] as import('react-test-renderer').ReactTestInstance).props.className).toBe('dev-data-banner')
    expect(renderer.root.findAllByProps({ 'aria-label': '발표용 예시 기록 표시' })).toHaveLength(1)
  })
  it('connects camera, theme, data collection and examples to actual destinations', () => {
    const actions = mount()
    click('측정하기에서 카메라 확인'); expect(actions.onCamera).toHaveBeenCalledOnce()
    click('화면 꾸미기 열기'); expect(actions.onSettings).toHaveBeenCalledOnce()
    click('자세 데이터 수집'); expect(actions.onCollect).toHaveBeenCalledOnce()
    click('예시 오늘 화면 열기'); expect(actions.onHasHistory).toHaveBeenCalledWith(true); expect(actions.onRecords).toHaveBeenCalledOnce()
    click('예시 기록·달력 열기'); expect(actions.onCalendar).toHaveBeenCalledOnce()
  })
  it('executes recovery and media errors before displaying their outcomes', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('window', { posegoodDesktop: { version: 1 } })
    mount()
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
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0)
    click('화면·모션 미리보기 열기')
    expect(renderer.root.findAllByType('dialog')).toHaveLength(1)
    click('준비 단계 넘기기')
    click('미리보기 닫기')
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0)
  })
})
