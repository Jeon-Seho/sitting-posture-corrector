import { act, create } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { ObservationReplaySettings } from './ObservationReplaySettings'

afterEach(() => vi.unstubAllGlobals())
it('dismisses replay settings on outside input, Escape and actions, then releases its listener', () => {
  const doc = new EventTarget()
  vi.stubGlobal('document', doc)
  const node = { open: true, contains: vi.fn(() => false) }, trigger = { focus: vi.fn() }
  let ui!: ReturnType<typeof create>
  act(() => { ui = create(<ObservationReplaySettings><button>action</button></ObservationReplaySettings>, { createNodeMock: element => element.type === 'details' ? node : element.type === 'summary' ? trigger : null }) })
  act(() => { doc.dispatchEvent(new Event('pointerdown')) })
  expect(node.open).toBe(false)
  node.open = true
  const event = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() }
  act(() => ui.root.findByType('details').props.onKeyDown(event))
  expect(node.open).toBe(false); expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(trigger.focus).toHaveBeenCalledWith({ preventScroll: true })
  node.open = true
  act(() => ui.root.findByProps({ 'aria-label': '리플레이 옵션' }).props.onClick({ target: { closest: () => ({}) } }))
  expect(node.open).toBe(false)
  act(() => ui.unmount())
  node.open = true; doc.dispatchEvent(new Event('pointerdown'))
  expect(node.open).toBe(true)
})
