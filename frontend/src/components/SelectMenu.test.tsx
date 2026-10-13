import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SelectMenu } from './SelectMenu'

describe('app-styled select', () => {
  let renderer: ReactTestRenderer | undefined
  afterEach(() => {
    act(() => renderer?.unmount())
    vi.unstubAllGlobals()
  })
  const options = [
    { value: '', label: '기본 카메라 (자동)' },
    { value: 'a', label: '내장 웹캠' },
    { value: 'b', label: 'USB 카메라', note: '사용 중' },
  ]
  function mount(onChange = vi.fn()) {
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    act(() => {
      renderer = create(<SelectMenu label="메인 카메라" value="a" options={options} onChange={onChange} />)
    })
    return onChange
  }
  const trigger = () => renderer!.root.findByProps({ className: 'select-trigger' })
  const key = (k: string) => ({ key: k, preventDefault: vi.fn() })

  it('shows the chosen label and opens a listbox', () => {
    mount()
    expect(trigger().props['aria-label']).toBe('메인 카메라: 내장 웹캠')
    expect(renderer!.root.findAllByProps({ role: 'listbox' })).toHaveLength(0)
    act(() => trigger().props.onClick())
    const items = renderer!.root.findAllByProps({ role: 'option' })
    expect(items.map((i) => i.props['aria-selected'])).toEqual([false, true, false])
  })

  it('moves with arrow keys and chooses with Enter', () => {
    const onChange = mount()
    act(() => trigger().props.onClick())
    const list = () => renderer!.root.findByProps({ role: 'listbox' })
    act(() => list().props.onKeyDown(key('ArrowDown')))
    act(() => list().props.onKeyDown(key('Enter')))
    expect(onChange).toHaveBeenCalledWith('b')
    expect(renderer!.root.findAllByProps({ role: 'listbox' })).toHaveLength(0)
  })

  it('closes on Escape and does not report the current value again', () => {
    const onChange = mount()
    act(() => trigger().props.onClick())
    act(() => renderer!.root.findByProps({ role: 'listbox' }).props.onKeyDown(key('Escape')))
    expect(renderer!.root.findAllByProps({ role: 'listbox' })).toHaveLength(0)
    act(() => trigger().props.onClick())
    act(() => renderer!.root.findAllByProps({ role: 'option' })[1].props.onClick())
    expect(onChange).not.toHaveBeenCalled()
  })
})
