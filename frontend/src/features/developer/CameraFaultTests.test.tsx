import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CameraFaultPreview } from './CameraFaultPreview'
import { CameraFaultTests } from './CameraFaultTests'

describe('camera failure user-flow previews', () => {
  let renderer: ReactTestRenderer
  const click = (label: string) => act(() => renderer.root.findAllByType('button').find(button => button.children.join('') === label)!.props.onClick())
  const text = () => JSON.stringify(renderer.toJSON())
  const advance = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  function mount() {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    act(() => { renderer = create(<CameraFaultTests />) })
  }
  afterEach(() => { act(() => renderer?.unmount()); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('shows preparation, CPU retry and the actual performance dialog, including in desktop previews', async () => {
    mount()
    vi.stubGlobal('window', { posegoodDesktop: { version: 1 } })
    click('GPU 실패 → CPU 성공')
    expect(text()).toContain('카메라를 준비하고 있어요')
    await advance(1100)
    expect(text()).toContain('CPU로 다시 준비하고 있어요')
    await advance(1000)
    expect(renderer.root.findAllByProps({ role: 'alertdialog' })).toHaveLength(1)
    expect(text()).toContain('GPU 처리를 시작하지 못해 CPU 처리로 전환했어요')
    click('확인')
    expect(renderer.root.findAllByProps({ role: 'alertdialog' })).toHaveLength(0)
    expect(text()).toContain('카메라가 준비됐어요')
    expect(renderer.root.findByProps({ className: 'fault-preview-diagnostics' }).props.open).not.toBe(true)
    click('테스트 종료')
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0)
  })
  it.each([
    ['GPU·CPU 모두 실패', '카메라를 준비하지 못했어요'],
    ['준비 시간 초과', '카메라 준비가 오래 걸려요'],
    ['전환 중 취소', '카메라 준비를 취소했어요'],
  ])('reproduces %s as a visible camera state', async (scenario, expected) => {
    mount()
    click(scenario)
    await advance(2600)
    expect(text()).toContain(expected)
    expect(renderer.root.findAllByProps({ role: 'alertdialog' })).toHaveLength(0)
    expect(text()).toContain('카메라 다시 준비')
    click('카메라 다시 준비')
    expect(text()).toContain('카메라를 준비하고 있어요')
  })
  it('lets the user cancel CPU preparation and suppresses a late success popup', async () => {
    mount()
    click('GPU 실패 → CPU 성공')
    await advance(1100)
    click('카메라 준비 취소')
    expect(text()).toContain('카메라 준비를 취소했어요')
    await advance(2000)
    expect(renderer.root.findAllByProps({ role: 'alertdialog' })).toHaveLength(0)
    expect(renderer.root.findByProps({ className: 'fault-preview-diagnostics' }).findByType('p').children.join('')).toContain('자원 해제 1')
  })
  it('runs the selected scenario from the compact single-action control', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    act(() => { renderer = create(<CameraFaultTests compact />) })
    expect(renderer.root.findAllByType('button')).toHaveLength(1)
    act(() => renderer.root.findByProps({ 'aria-label': '복구 테스트 시나리오' }).props.onChange({ target: { value: 'timeout' } }))
    click('선택한 흐름 재현')
    await advance(2600)
    expect(text()).toContain('카메라 준비가 오래 걸려요')
  })
  it.each(['limited', 'unknown'] as const)('injects %s into the real graphics probe before showing guidance', async performance => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    act(() => { renderer = create(<CameraFaultPreview scenario="fallback" performance={performance} onClose={() => {}} />) })
    expect(renderer.root.findAllByProps({ role: 'alertdialog' })).toHaveLength(0)
    await advance(1100)
    expect(renderer.root.findAllByProps({ role: 'alertdialog' })).toHaveLength(1)
    expect(text()).toContain(performance === 'limited' ? '그래픽 가속이 제한됐어요' : '그래픽 가속 상태를 확인하지 못했어요')
  })
  it('closes during loading without late dialogs or pending timers', async () => {
    mount()
    click('GPU 실패 → CPU 성공')
    click('미리보기 닫기')
    await advance(6000)
    expect(renderer.root.findAllByType('dialog')).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
