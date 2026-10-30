import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useObservationTabMotion } from './useObservationTabMotion'
function Probe() {
  const { surface, animateSelection } = useObservationTabMotion()
  return <><span ref={surface} /><button onClick={animateSelection}>move</button></>
}
afterEach(() => vi.unstubAllGlobals())
describe('observation liquid tab motion', () => {
  it('narrows then swells and settles, cancelling the previous motion on rapid selection', () => {
    const preference = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    vi.stubGlobal('window', { matchMedia: () => preference })
    vi.stubGlobal('getComputedStyle', () => ({ transform: 'matrix(.9, 0, 0, 1, 0, 0)' }))
    const cancel = vi.fn(), animate = vi.fn(() => ({ cancel }))
    let ui!: ReactTestRenderer
    act(() => { ui = create(<Probe />, { createNodeMock: node => node.type === 'span' ? { animate } : null }) })
    const move = () => act(() => ui.root.findByType('button').props.onClick())
    move()
    expect(animate.mock.calls[0]).toEqual([expect.arrayContaining([
      expect.objectContaining({ transform: 'matrix(.9, 0, 0, 1, 0, 0)' }),
      expect.objectContaining({ transform: 'scale(1.08, .78)' }),
      expect.objectContaining({ transform: 'scale(1.04, 1.12)' }),
      expect.objectContaining({ transform: 'scale(1)', offset: 1 }),
    ]), { duration: 420, easing: 'linear' }])
    move(); expect(cancel).toHaveBeenCalledOnce()
    act(() => ui.unmount()); expect(cancel).toHaveBeenCalledTimes(2)
    expect(preference.removeEventListener).toHaveBeenCalledOnce()
  })
  it('skips reduced motion and cancels an in-flight animation when the preference changes', () => {
    let listener!: () => void
    const preference = { matches: true, addEventListener: (_: string, next: () => void) => { listener = next }, removeEventListener: vi.fn() }
    vi.stubGlobal('window', { matchMedia: () => preference })
    vi.stubGlobal('getComputedStyle', () => ({ transform: 'none' }))
    const cancel = vi.fn(), animate = vi.fn(() => ({ cancel }))
    let ui!: ReactTestRenderer
    act(() => { ui = create(<Probe />, { createNodeMock: node => node.type === 'span' ? { animate } : null }) })
    act(() => ui.root.findByType('button').props.onClick()); expect(animate).not.toHaveBeenCalled()
    preference.matches = false
    act(() => ui.root.findByType('button').props.onClick()); expect(animate).toHaveBeenCalledOnce()
    preference.matches = true; act(() => listener()); expect(cancel).toHaveBeenCalledOnce()
    act(() => ui.unmount())
  })
})
