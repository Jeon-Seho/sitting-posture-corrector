import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TipLayer } from './TipLayer'

describe('tooltip input timing', () => {
  let renderer: ReactTestRenderer
  let doc: EventTarget & { activeElement: unknown }
  function target() {
    const attrs = new Map<string, string>([['data-tip', '오늘'], ['aria-describedby', 'existing']])
    const node = {
      isConnected: true,
      textContent: '오늘',
      getAttribute: (key: string) => attrs.get(key) ?? null,
      setAttribute: (key: string, value: string) => attrs.set(key, value),
      removeAttribute: (key: string) => attrs.delete(key),
      closest: () => node,
      contains: (other: unknown) => other === node,
      getBoundingClientRect: () => ({ left: 20, top: 150, bottom: 180, width: 100 }),
    }
    return node
  }
  function fire(type: string, node: unknown, extra = {}) {
    const event = new Event(type)
    Object.defineProperty(event, 'target', { value: node })
    Object.assign(event, extra)
    act(() => { doc.dispatchEvent(event) })
  }
  const visible = () => renderer.root.findAllByProps({ role: 'tooltip' }).length
  beforeEach(() => {
    vi.useFakeTimers()
    doc = Object.assign(new EventTarget(), { activeElement: null as unknown })
    vi.stubGlobal('document', doc)
    vi.stubGlobal('window', { innerWidth: 1360 })
    act(() => { renderer = create(<TipLayer />) })
  })
  afterEach(() => {
    act(() => renderer.unmount())
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  it('waits 500ms for hover and does not restart inside the same target', () => {
    const node = target()
    fire('pointerover', node)
    act(() => { vi.advanceTimersByTime(499) })
    expect(visible()).toBe(0)
    fire('pointerover', node)
    act(() => { vi.advanceTimersByTime(1) })
    expect(visible()).toBe(1)
  })
  it('cancels pending hover on exit, click, scroll and unmount', () => {
    const node = target()
    for (const event of ['pointerout', 'pointerdown', 'scroll']) {
      fire('pointerover', node)
      fire(event, node)
      act(() => { vi.advanceTimersByTime(500) })
      expect(visible()).toBe(0)
    }
    fire('pointerover', node)
    act(() => renderer.unmount())
    expect(vi.getTimerCount()).toBe(0)
  })
  it('shows Tab focus immediately and preserves other accessible descriptions', () => {
    const node = target()
    fire('keydown', node, { key: 'Tab' })
    doc.activeElement = node
    fire('focusin', node)
    expect(visible()).toBe(1)
    expect(node.getAttribute('aria-describedby')).toContain('existing ')
    fire('keydown', node, { key: 'Escape' })
    expect(visible()).toBe(0)
    expect(node.getAttribute('aria-describedby')).toBe('existing')
  })
  it('does not show on pointer focus, including after earlier Tab navigation', () => {
    const node = target()
    fire('keydown', node, { key: 'Tab' })
    fire('pointerdown', node)
    doc.activeElement = node
    fire('focusin', node)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(visible()).toBe(0)
  })
  it('restarts the full hover delay for a different target', () => {
    const first = target(), second = target()
    fire('pointerover', first)
    act(() => { vi.advanceTimersByTime(400) })
    fire('pointerout', first)
    fire('pointerover', second)
    act(() => { vi.advanceTimersByTime(100) })
    expect(visible()).toBe(0)
    act(() => { vi.advanceTimersByTime(400) })
    expect(visible()).toBe(1)
    expect(first.getAttribute('aria-describedby')).toBe('existing')
  })
})

