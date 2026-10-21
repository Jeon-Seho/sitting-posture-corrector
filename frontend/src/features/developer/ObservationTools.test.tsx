import { useState } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { ObservationTools } from './ObservationTools'

describe('observation analysis tools', () => {
  it('adds a keyboard-accessible replay tab and reports visibility when closing or changing panels', () => {
    let ui!: ReturnType<typeof create>
    const replay = (visible: boolean) => <p data-replay-visible={visible}>replay</p>
    act(() => { ui = create(<ObservationTools metrics={<p>metrics</p>} manual={<p>manual</p>} table={<p>table</p>} replay={replay} />) })
    act(() => ui.root.findByProps({ 'aria-label': '관측 도구 열기' }).props.onClick())
    const tabs = () => ui.root.findAllByProps({ role: 'tab' })
    expect(tabs()).toHaveLength(4)
    act(() => tabs()[0].props.onKeyDown({ key: 'End', preventDefault: vi.fn() }))
    expect(ui.root.findByProps({ 'data-replay-visible': true })).toBeDefined()
    act(() => tabs()[3].props.onKeyDown({ key: 'ArrowRight', preventDefault: vi.fn() }))
    expect(tabs()[0].props['aria-selected']).toBe(true)
    expect(ui.root.findByProps({ 'data-replay-visible': false })).toBeDefined()
    act(() => tabs()[3].props.onClick())
    act(() => ui.root.findByProps({ 'aria-label': '관측 도구 닫기' }).props.onClick())
    expect(ui.root.findByProps({ 'data-replay-visible': false })).toBeDefined()
    act(() => ui.unmount())
  })
  it('keeps camera controls beside the toggle, available while analysis panels are closed', () => {
    const stop = vi.fn()
    let ui!: ReturnType<typeof create>
    act(() => { ui = create(<ObservationTools metrics={<p>metrics</p>} manual={<p>manual</p>} table={<p>table</p>} actions={<><button onClick={stop}>측정 종료</button><details><summary>도움말</summary></details></>} />) })
    expect(ui.root.findByProps({ className: 'oc-tools-body' }).props.hidden).toBe(true)
    const rail = ui.root.findByProps({ className: 'oc-tools-bar' })
    expect(rail.findByProps({ 'aria-label': '관측 도구 열기' })).toBeDefined()
    const actions = rail.findByProps({ className: 'oc-tools-actions' })
    act(() => actions.findByType('button').props.onClick())
    expect(stop).toHaveBeenCalledOnce()
    expect(actions.children.at(-1)).toBe(actions.findByType('details'))
    act(() => ui.unmount())
  })
  it('opens one panel at a time and supports keyboard tab navigation with focus', () => {
    const focus = [vi.fn(), vi.fn(), vi.fn()]
    let ui!: ReturnType<typeof create>
    act(() => { ui = create(<ObservationTools metrics={<p>metrics</p>} manual={<p>manual</p>} table={<p>table</p>} />, {
      createNodeMock: element => element.props.role === 'tab' ? { focus: focus[Number(element.props['data-index'])] } : null,
    }) })
    const toggle = ui.root.findByProps({ 'aria-label': '관측 도구 열기' })
    expect(toggle.props['aria-expanded']).toBe(false)
    act(() => toggle.props.onClick())
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
  it('retains tool state when switching tabs or closing and reopening the tools', () => {
    function Draft() {
      const [value, setValue] = useState(0)
      return <button onClick={() => setValue(value + 1)}>draft {value}</button>
    }
    let ui!: ReturnType<typeof create>
    act(() => { ui = create(<ObservationTools metrics={<p>metrics</p>} manual={<Draft />} table={<p>table</p>} />) })
    act(() => ui.root.findByProps({ 'aria-label': '관측 도구 열기' }).props.onClick())
    act(() => ui.root.findAllByProps({ role: 'tab' })[1].props.onClick())
    act(() => ui.root.findAllByType('button').find(button => button.props.children?.[0] === 'draft ')!.props.onClick())
    act(() => ui.root.findAllByProps({ role: 'tab' })[2].props.onClick())
    act(() => ui.root.findByProps({ 'aria-label': '관측 도구 닫기' }).props.onClick())
    act(() => ui.root.findByProps({ 'aria-label': '관측 도구 열기' }).props.onClick())
    act(() => ui.root.findAllByProps({ role: 'tab' })[1].props.onClick())
    expect(ui.root.findAllByType('button').find(button => button.props.children?.[0] === 'draft ')!.props.children).toEqual(['draft ', 1])
    act(() => ui.unmount())
  })
})
