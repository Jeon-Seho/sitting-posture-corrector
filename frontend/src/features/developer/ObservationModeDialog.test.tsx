import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObservationModeDialog } from './ObservationModeDialog'

describe('explicit observation mode selection before camera use', () => {
  let ui: ReactTestRenderer, storage: Map<string, string>
  // A synthetic measurer name saved by an earlier run on this computer.
  beforeEach(() => {
    storage = new Map([['posture-lab-observation-participant-v1', '합성 측정자']])
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
  })
  afterEach(() => { act(() => ui?.unmount()); vi.unstubAllGlobals() })
  const button = (label: string) => ui.root.findAllByType('button').find(b => b.props.children === label)!
  it('defaults to manual and cancels without requesting camera use', () => {
    const start = vi.fn(), cancel = vi.fn()
    act(() => { ui = create(<ObservationModeDialog onStart={start} onCancel={cancel} />) })
    expect(ui.root.findByType('dialog').props['aria-modal']).toBe('true')
    expect(ui.root.findAllByProps({ type: 'radio' }).find(r => r.props.value === 'manual')!.props.checked).toBe(true)
    expect(button('카메라 켜고 시작').props.disabled).toBe(false)
    act(() => button('취소').props.onClick())
    expect(start).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce()
  })
  it('always starts the base-deviation cycle with the chosen cycle count and mode', async () => {
    const start = vi.fn()
    act(() => { ui = create(<ObservationModeDialog onStart={start} onCancel={vi.fn()} />) })
    expect(ui.root.findAllByProps({ type: 'radio' }).map(r => r.props.value)).toEqual(['manual', 'auto'])
    act(() => ui.root.findByProps({ type: 'number' }).props.onChange({ target: { value: '5' } }))
    await act(async () => { await button('카메라 켜고 시작').props.onClick() })
    expect(start).toHaveBeenCalledExactlyOnceWith('manual', { rounds: 5, shuffle: false, cycle: 'repeat', stretchNote: '' }, '합성 측정자')
  })
  it('requires the measurer name before the camera starts and remembers the trimmed name', async () => {
    storage.clear(); const start = vi.fn()
    act(() => { ui = create(<ObservationModeDialog onStart={start} onCancel={vi.fn()} />) })
    const name = () => ui.root.findByProps({ type: 'text' })
    expect(name().props.value).toBe(''); expect(name().props.maxLength).toBe(30)
    expect(button('카메라 켜고 시작').props.disabled).toBe(true)
    act(() => name().props.onChange({ target: { value: '   ' } }))
    expect(button('카메라 켜고 시작').props.disabled).toBe(true)
    await act(async () => { await button('카메라 켜고 시작').props.onClick() }); expect(start).not.toHaveBeenCalled()
    act(() => name().props.onChange({ target: { value: '  새 측정자 ' } }))
    expect(button('카메라 켜고 시작').props.disabled).toBe(false)
    await act(async () => { await button('카메라 켜고 시작').props.onClick() })
    expect(start).toHaveBeenCalledExactlyOnceWith('manual', { rounds: 1, shuffle: false, cycle: 'repeat', stretchNote: '' }, '새 측정자')
    expect(storage.get('posture-lab-observation-participant-v1')).toBe('새 측정자')
  })
  it('rejects empty and out-of-range cycle counts', () => {
    act(() => { ui = create(<ObservationModeDialog onStart={vi.fn()} onCancel={vi.fn()} />) })
    for (const value of ['', '0', '6', '1.5']) {
      act(() => ui.root.findByProps({ type: 'number' }).props.onChange({ target: { value } }))
      expect(button('카메라 켜고 시작').props.disabled).toBe(true)
    }
  })
  it.each(['auto', 'manual'])('starts exactly once with explicitly selected %s mode', async mode => {
    const start = vi.fn()
    act(() => { ui = create(<ObservationModeDialog onStart={start} onCancel={vi.fn()} />) })
    const radio = ui.root.findAllByProps({ type: 'radio' }).find(r => r.props.value === mode)!
    act(() => radio.props.onChange())
    expect(radio.props.checked).toBe(true); expect(start).not.toHaveBeenCalled()
    await act(async () => { const confirm = button('카메라 켜고 시작').props.onClick; await Promise.all([confirm(), confirm()]) })
    expect(start).toHaveBeenCalledExactlyOnceWith(mode, { rounds: 1, shuffle: false, cycle: 'repeat', stretchNote: '' }, '합성 측정자')
  })
})
