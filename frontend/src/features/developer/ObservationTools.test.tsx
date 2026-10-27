import { useState } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { ObservationTools } from './ObservationTools'

describe('observation analysis tools', () => {
  it('keeps replay visible only while its permanently available tab is selected', () => {
    let ui!: ReturnType<typeof create>
    const replay = (visible: boolean) => <p data-replay-visible={visible}>replay</p>
    act(() => { ui = create(<ObservationTools metrics={<p>metrics</p>} table={<p>table</p>} replay={replay} />) })
    const tabs = () => ui.root.findAllByProps({ role: 'tab' })
    expect(tabs()).toHaveLength(3)
    expect(tabs().map(tab => tab.findByType('span').props.children)).toEqual(['수치·그래프', '리플레이', '비교표'])
    act(() => tabs()[0].props.onKeyDown({ key: 'ArrowRight', preventDefault: vi.fn() }))
    expect(ui.root.findByProps({ 'data-replay-visible': true })).toBeDefined()
    act(() => tabs()[2].props.onKeyDown({ key: 'ArrowRight', preventDefault: vi.fn() }))
    expect(tabs()[0].props['aria-selected']).toBe(true)
    expect(ui.root.findByProps({ 'data-replay-visible': false })).toBeDefined()
    act(() => tabs()[1].props.onClick())
    expect(ui.root.findByProps({ 'data-replay-visible': true })).toBeDefined()
    act(() => ui.unmount())
  })
  it('shows analysis by default without a collapse toggle or duplicate camera controls', () => {
    let ui!: ReturnType<typeof create>
    act(() => { ui = create(<ObservationTools metrics={<p>metrics</p>} table={<p>table</p>} />) })
    expect(ui.root.findByProps({ className: 'oc-tools-body' }).props.hidden).not.toBe(true)
    expect(ui.root.findAllByProps({ 'aria-expanded': false })).toHaveLength(0)
    expect(ui.root.findAllByProps({ role: 'tabpanel' })[0].props.hidden).toBe(false)
    expect(ui.root.findAllByType('button')).toHaveLength(2)
    act(() => ui.unmount())
  })
  it('opens one panel at a time and supports keyboard tab navigation with focus', () => {
    const focus = [vi.fn(), vi.fn(), vi.fn()]
    let ui!: ReturnType<typeof create>
    act(() => { ui = create(<ObservationTools metrics={<p>metrics</p>} table={<p>table</p>} replay={() => <p>replay</p>} />, {
      createNodeMock: element => element.props.role === 'tab' ? { focus: focus[Number(element.props['data-index'])] } : null,
    }) })
    const tabs = () => ui.root.findAllByProps({ role: 'tab' })
    const panels = () => ui.root.findAllByProps({ role: 'tabpanel' })
    expect(panels().map(panel => panel.props.hidden)).toEqual([false, true, true])
    const key = (index: number, key: string) => act(() => tabs()[index].props.onKeyDown({ key, preventDefault: vi.fn() }))
    key(0, 'ArrowRight')
    expect(tabs()[1].props['aria-selected']).toBe(true)
    expect(focus[1]).toHaveBeenCalledOnce()
    key(1, 'End')
    expect(panels().map(panel => panel.props.hidden)).toEqual([true, true, false])
    key(2, 'ArrowRight')
    expect(tabs()[0].props.tabIndex).toBe(0)
    key(0, 'ArrowLeft')
    expect(tabs()[2].props['aria-selected']).toBe(true)
    key(2, 'Home')
    expect(tabs()[0].props['aria-selected']).toBe(true)
    act(() => ui.unmount())
  })
  it('retains entered tool state when switching tabs', () => {
    function Draft() {
      const [value, setValue] = useState(0)
      return <button onClick={() => setValue(value + 1)}>draft {value}</button>
    }
    let ui!: ReturnType<typeof create>
    act(() => { ui = create(<ObservationTools metrics={<p>metrics</p>} table={<Draft />} replay={() => <p>replay</p>} />) })
    act(() => ui.root.findAllByProps({ role: 'tab' })[2].props.onClick())
    act(() => ui.root.findAllByType('button').find(button => button.props.children?.[0] === 'draft ')!.props.onClick())
    act(() => ui.root.findAllByProps({ role: 'tab' })[1].props.onClick())
    act(() => ui.root.findAllByProps({ role: 'tab' })[2].props.onClick())
    expect(ui.root.findAllByType('button').find(button => button.props.children?.[0] === 'draft ')!.props.children).toEqual(['draft ', 1])
    act(() => ui.unmount())
  })
})
