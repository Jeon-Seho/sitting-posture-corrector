import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ObservationScrollPanel } from './ObservationScrollPanel'

afterEach(() => vi.unstubAllGlobals())
describe('observation scroll edge cues', () => {
  it('tracks both edges and moves the same viewport when a cue is clicked', () => {
    const viewport = { clientHeight: 300, scrollHeight: 700, scrollTop: 0, scrollBy: vi.fn(), focus: vi.fn() }
    let ui!: ReactTestRenderer
    act(() => { ui = create(<ObservationScrollPanel id="metrics" labelledBy="tab" visible><p>content</p></ObservationScrollPanel>, { createNodeMock: node => node.props.className === 'oc-panel-scroll' ? viewport : null }) })
    const cues = () => ui.root.findAllByType('button').map(button => button.props['aria-label'])
    const scroll = () => act(() => ui.root.findByProps({ role: 'tabpanel' }).props.onScroll())
    expect(cues()).toEqual(['아래쪽 정보 더 보기'])
    const down = ui.root.findByType('button')
    expect(down.props['aria-controls']).toBe('metrics')
    act(() => down.props.onClick())
    expect(viewport.scrollBy).toHaveBeenLastCalledWith({ top: 210, behavior: 'auto' })
    viewport.scrollTop = 200; scroll()
    expect(cues()).toEqual(['위쪽 정보 더 보기', '아래쪽 정보 더 보기'])
    viewport.scrollTop = 400; scroll()
    expect(cues()).toEqual(['위쪽 정보 더 보기'])
    act(() => ui.root.findByType('button').props.onClick())
    expect(viewport.scrollBy).toHaveBeenLastCalledWith({ top: -210, behavior: 'auto' })
    viewport.scrollTop = -5; scroll()
    expect(cues()).toEqual(['아래쪽 정보 더 보기'])
    act(() => ui.unmount())
  })
  it('updates on content/viewport resize and rechecks a restored hidden panel', () => {
    let resize!: () => void
    const disconnect = vi.fn(), observe = vi.fn()
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe = observe; disconnect = disconnect })
    const viewport = { clientHeight: 300, scrollHeight: 200, scrollTop: 0, scrollBy: vi.fn(), focus: vi.fn() }
    let ui!: ReactTestRenderer
    const view = (visible: boolean) => <ObservationScrollPanel id="metrics" labelledBy="tab" visible={visible}><p>content</p></ObservationScrollPanel>
    act(() => { ui = create(view(true), { createNodeMock: node => node.props.className === 'oc-panel-scroll' ? viewport : {} }) })
    expect(observe).toHaveBeenCalledTimes(2)
    expect(ui.root.findAllByType('button')).toHaveLength(0)
    viewport.scrollHeight = 700; act(() => resize())
    expect(ui.root.findByType('button').props['aria-label']).toBe('아래쪽 정보 더 보기')
    act(() => ui.update(view(false)))
    expect(ui.root.findAllByType('button')).toHaveLength(0)
    expect(disconnect).toHaveBeenCalledOnce()
    viewport.scrollTop = 400
    act(() => ui.update(view(true)))
    expect(ui.root.findByType('button').props['aria-label']).toBe('위쪽 정보 더 보기')
    viewport.scrollHeight = 200; act(() => resize())
    expect(ui.root.findAllByType('button')).toHaveLength(0)
    viewport.clientHeight = 0; act(() => resize())
    expect(ui.root.findAllByType('button')).toHaveLength(0)
    act(() => ui.unmount())
    expect(disconnect).toHaveBeenCalledTimes(2)
  })
})
