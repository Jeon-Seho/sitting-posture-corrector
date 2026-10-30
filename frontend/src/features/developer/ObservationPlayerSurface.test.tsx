import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObservationPlayerSurface } from './ObservationPlayerSurface'

describe('player activity and keyboard controls', () => {
  let ui: ReactTestRenderer
  const mount = (playing = false) => <ObservationPlayerSurface hasData playing={playing} transport={<button>play</button>} footer={<output>time</output>}><svg /></ObservationPlayerSurface>
  const stage = () => ui.root.findByProps({ role: 'group' })
  const shown = () => ui.root.findByProps({ className: 'oc-player-center-controls' }).props['data-visible']
  beforeEach(() => { vi.useFakeTimers(); act(() => { ui = create(mount()) }) })
  afterEach(() => { act(() => ui.unmount()); vi.useRealTimers() })
  it('hides after inactivity, reveals on movement and keeps the timeline mounted', () => {
    expect(shown()).toBe(true)
    act(() => { vi.advanceTimersByTime(2000) }); expect(shown()).toBe(false)
    expect(ui.root.findByType('output').props.children).toBe('time')
    expect(ui.root.findByProps({ className: 'oc-player-footer' }).props['aria-hidden']).toBe(true)
    expect(stage().props['data-controls-visible']).toBe(false)
    act(() => stage().props.onPointerMove()); expect(shown()).toBe(true)
    expect(ui.root.findByProps({ className: 'oc-player-footer' }).props['aria-hidden']).toBe(false)
    act(() => { vi.advanceTimersByTime(1500) }); act(() => stage().props.onPointerMove())
    act(() => { vi.advanceTimersByTime(1000) }); expect(shown()).toBe(true)
    act(() => stage().props.onPointerLeave()); expect(shown()).toBe(false)
    act(() => stage().props.onPointerDown()); expect(shown()).toBe(true)
  })
  it('keeps keyboard controls visible until focus leaves and clears timers on unmount', () => {
    act(() => stage().props.onFocusCapture({ target: { matches: () => true } }))
    act(() => { vi.advanceTimersByTime(3000) }); expect(shown()).toBe(true)
    act(() => stage().props.onPointerLeave()); expect(shown()).toBe(true)
    act(() => stage().props.onBlurCapture({ currentTarget: { contains: () => false }, relatedTarget: null }))
    act(() => { vi.advanceTimersByTime(2000) }); expect(shown()).toBe(false)
    act(() => stage().props.onPointerMove())
    act(() => ui.unmount()); expect(vi.getTimerCount()).toBe(0)
  })
  it('keeps the settings open while idle or outside the player, then resumes hiding on close', () => {
    act(() => ui.unmount())
    let open = true
    const node = Object.assign(new EventTarget(), { querySelector: () => open ? {} : null })
    act(() => { ui = create(mount(), { createNodeMock: element => element.props.role === 'group' ? node : null }) })
    act(() => { vi.advanceTimersByTime(3000) }); expect(shown()).toBe(true)
    act(() => stage().props.onPointerLeave()); expect(shown()).toBe(true)
    open = false
    act(() => { node.dispatchEvent(new Event('toggle')) })
    act(() => { vi.advanceTimersByTime(2000) }); expect(shown()).toBe(false)
  })
  it('keeps empty-player settings accessible without pointer activity', () => {
    act(() => ui.update(<ObservationPlayerSurface hasData={false} playing={false} footer={<button>settings</button>}>empty</ObservationPlayerSurface>))
    act(() => stage().props.onPointerLeave()); act(() => { vi.advanceTimersByTime(3000) })
    expect(stage().props['data-controls-visible']).toBe(true)
    expect(ui.root.findByProps({ className: 'oc-player-footer' }).props['aria-hidden']).toBe(false)
  })
  it('does not let parent playback ticks reset the idle timer but reveals when play state changes', () => {
    act(() => { vi.advanceTimersByTime(1200) }); act(() => ui.update(mount()))
    act(() => { vi.advanceTimersByTime(800) }); expect(shown()).toBe(false)
    act(() => ui.update(mount(true))); expect(shown()).toBe(true)
  })
})
