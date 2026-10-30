import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ObservationReplayInfo } from './ObservationReplayInfo'

describe('record information icon and modal', () => {
  let ui: ReactTestRenderer
  const onOpen = vi.fn()
  const mount = () => { onOpen.mockClear(); act(() => { ui = create(<ObservationReplayInfo onOpen={onOpen}><p>Explicit synthetic record information</p></ObservationReplayInfo>) }) }
  const open = () => act(() => ui.root.findByProps({ 'aria-label': '기록 정보' }).props.onClick())
  afterEach(() => act(() => ui.unmount()))
  it('shows only the icon until opened, pauses through the caller and closes with one action', () => {
    mount()
    expect(ui.root.findAllByType('dialog')).toHaveLength(0)
    expect(ui.root.findByType('button').props['aria-haspopup']).toBe('dialog')
    open(); expect(onOpen).toHaveBeenCalledOnce()
    const dialog = ui.root.findByType('dialog')
    expect(dialog.props['aria-modal']).toBe('true')
    expect(dialog.props['aria-labelledby']).toBe(dialog.findByType('h2').props.id)
    expect(dialog.findByType('p').props.children).toContain('synthetic')
    expect(dialog.findAllByType('button')).toHaveLength(1)
    act(() => dialog.findByType('button').props.onClick())
    expect(ui.root.findAllByType('dialog')).toHaveLength(0)
  })
  it('keeps Escape away from parent settings and handles native cancellation without changing the record', () => {
    mount(); open()
    const event = { key: 'Escape', stopPropagation: vi.fn() }
    act(() => ui.root.findByType('dialog').props.onKeyDown(event))
    expect(event.stopPropagation).toHaveBeenCalledOnce()
    const cancel = { preventDefault: vi.fn() }
    act(() => ui.root.findByType('dialog').props.onCancel(cancel))
    expect(cancel.preventDefault).toHaveBeenCalledOnce()
    expect(ui.root.findAllByType('dialog')).toHaveLength(0)
    open(); expect(ui.root.findByType('p').props.children).toContain('synthetic')
  })
})
