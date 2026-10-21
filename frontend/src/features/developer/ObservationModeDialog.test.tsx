import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ObservationModeDialog } from './ObservationModeDialog'

describe('explicit observation mode selection before camera use', () => {
  let ui: ReactTestRenderer
  afterEach(() => act(() => ui?.unmount()))
  const button = (label: string) => ui.root.findAllByType('button').find(b => b.props.children === label)!
  it('keeps start disabled without a selection and cancels without requesting camera use', async () => {
    const start = vi.fn(), cancel = vi.fn()
    act(() => { ui = create(<ObservationModeDialog onStart={start} onCancel={cancel} />) })
    expect(ui.root.findByType('dialog').props['aria-modal']).toBe('true')
    expect(button('카메라 켜고 시작').props.disabled).toBe(true)
    await act(async () => { await button('카메라 켜고 시작').props.onClick() })
    act(() => button('취소').props.onClick())
    expect(start).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce()
  })
  it.each(['auto', 'manual'])('starts exactly once with explicitly selected %s mode', async mode => {
    const start = vi.fn()
    act(() => { ui = create(<ObservationModeDialog onStart={start} onCancel={vi.fn()} />) })
    const radio = ui.root.findAllByProps({ type: 'radio' }).find(r => r.props.value === mode)!
    act(() => radio.props.onChange())
    expect(radio.props.checked).toBe(true); expect(start).not.toHaveBeenCalled()
    await act(async () => { const confirm = button('카메라 켜고 시작').props.onClick; await Promise.all([confirm(), confirm()]) })
    expect(start).toHaveBeenCalledExactlyOnceWith(mode)
  })
})
