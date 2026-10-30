import { useRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useObservationMotion } from './useObservationMotion'

function Panel({ state }: { state: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useObservationMotion(ref, state)
  return <div ref={ref} />
}
afterEach(() => vi.unstubAllGlobals())
describe('observation control layout motion', () => {
  it('animates control-set size changes without restarting on timer renders', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
    let height = 0, ui!: ReactTestRenderer
    const cancel = vi.fn(), animate = vi.fn(() => ({ cancel }))
    const node = { getBoundingClientRect: () => ({ width: 320, height }), animate }
    act(() => { ui = create(<Panel state="off" />, { createNodeMock: () => node }) })
    expect(animate).not.toHaveBeenCalled()
    height = 120
    act(() => ui.update(<Panel state="registering" />))
    expect(animate).toHaveBeenCalledWith([{ height: '0px' }, { height: '120px' }], expect.objectContaining({ duration: 200 }))
    act(() => ui.update(<Panel state="registering" />))
    expect(animate).toHaveBeenCalledOnce()
    act(() => ui.unmount()); expect(cancel).toHaveBeenCalledOnce()
  })
  it('does not animate size changes when reduced motion is requested', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    let height = 0, ui!: ReactTestRenderer
    const animate = vi.fn()
    act(() => { ui = create(<Panel state="off" />, { createNodeMock: () => ({ getBoundingClientRect: () => ({ width: 320, height }), animate }) }) })
    height = 150
    act(() => ui.update(<Panel state="running" />))
    expect(animate).not.toHaveBeenCalled()
    act(() => ui.unmount())
  })
})
