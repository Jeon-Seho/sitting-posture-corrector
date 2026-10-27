import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComboChart } from './ComboChart'

const bars = (n: number) => Array.from({ length: n }, (_, i) => ({ label: String(i + 1), value: i % 3 ? 0.5 : null }))

describe('combo chart hover', () => {
  let renderer: ReactTestRenderer | undefined
  afterEach(() => { act(() => renderer?.unmount()); vi.useRealTimers() })

  it('waits 500ms for pointer details and cancels them when leaving', () => {
    vi.useFakeTimers()
    act(() => {
      renderer = create(<ComboChart bars={bars(7)} barUnit="%" />, {
        createNodeMock: () => ({ getBoundingClientRect: () => ({ left: 0, width: 322 }) }),
      })
    })
    const chart = () => renderer!.root.findByProps({ role: 'group' })
    act(() => chart().props.onPointerMove({ clientX: 300 }))
    act(() => { vi.advanceTimersByTime(499) })
    expect(chart().props.className).not.toContain('is-tip-visible')
    act(() => { vi.advanceTimersByTime(1) })
    expect(chart().props.className).toContain('is-tip-visible')
    act(() => chart().props.onPointerLeave())
    expect(chart().props.className).not.toContain('is-tip-visible')
    act(() => chart().props.onPointerMove({ clientX: 100 }))
    act(() => chart().props.onPointerLeave())
    act(() => { vi.advanceTimersByTime(500) })
    expect(chart().props.className).not.toContain('is-tip-visible')
  })

  it('fades the highlight at its last position instead of jumping to the first column', () => {
    act(() => { renderer = create(<ComboChart bars={bars(7)} barUnit="%" />) })
    const chart = () => renderer!.root.findByProps({ role: 'group' })
    act(() => chart().props.onKeyDown({ key: 'ArrowLeft', preventDefault() {} }))
    const band = () => renderer!.root.findByProps({ className: 'combo-band' })
    const lastX = band().props.x
    expect(lastX).toBeGreaterThan(2)
    act(() => chart().props.onPointerLeave())
    expect(band().props.x).toBe(lastX)
    expect(chart().props.className).not.toContain('is-hovering')
  })

  it('keeps working when a 30-day hover meets a 7-day period', () => {
    act(() => {
      renderer = create(<ComboChart bars={bars(30)} line={bars(30).map(() => 0.1)} barUnit="%" lineUnit="시간" />)
    })
    const chart = () => renderer!.root.findByProps({ role: 'group' })
    // Keyboard ← from nothing selects the last column (index 29).
    act(() => chart().props.onKeyDown({ key: 'ArrowLeft', preventDefault() {} }))
    expect(JSON.stringify(renderer!.toJSON())).toContain('"30"')
    expect(() =>
      act(() => renderer!.update(<ComboChart bars={bars(7)} line={bars(7).map(() => 0.1)} barUnit="%" lineUnit="시간" />)),
    ).not.toThrow()
    expect(renderer!.toJSON()).not.toBeNull()
  })
})
