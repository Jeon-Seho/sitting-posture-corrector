import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectionLostDialog } from './ConnectionLostDialog'
import { connectionLost, reportConnectionLost, resetConnectionLost } from './connectionLost'

// Native modality is checked in the app; these tests cover the signal, wording and quitting.
describe('server connection lost', () => {
  let renderer: ReactTestRenderer | undefined
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = undefined
    act(() => resetConnectionLost())
    vi.unstubAllGlobals()
  })

  const mount = () => act(() => void (renderer = create(<ConnectionLostDialog />)))
  const text = () => JSON.stringify(renderer!.toJSON())
  const quitButton = () => renderer!.root.findByType('button')

  it('shows nothing until a loss is reported, then a blocking dialog with only 종료하기', () => {
    mount()
    expect(renderer!.toJSON()).toBeNull()
    act(() => reportConnectionLost({ reason: 'network', session: '2026-10-13 · 세션 2' }))
    const dialog = renderer!.root.findByType('dialog')
    expect(dialog.props.role).toBe('alertdialog')
    expect(dialog.props['aria-modal']).toBe('true')
    expect(text()).toContain('서버와의 연결이 불안정합니다')
    expect(text()).toContain('재접속 후 다시 시도해 주세요.')
    expect(text()).toContain('2026-10-13 · 세션 2')
    expect(renderer!.root.findAllByType('button').map((b) => b.children.join(''))).toEqual(['종료하기'])
    // Escape (cancel) must not close it.
    const cancel = { preventDefault: vi.fn() }
    dialog.props.onCancel(cancel)
    expect(cancel.preventDefault).toHaveBeenCalled()
  })

  it('prioritizes a real outage over a developer preview', () => {
    reportConnectionLost({ reason: 'test' })
    reportConnectionLost({ reason: 'network', session: 'later' })
    expect(connectionLost()).toEqual({ reason: 'network', session: 'later' })
    mount()
    expect(text()).not.toContain('개발 확인용')
  })

  it('returns from a developer test without closing the app', async () => {
    const quit = vi.fn()
    vi.stubGlobal('window', { posegoodDesktop: { version: 1, quit } })
    reportConnectionLost({ reason: 'test' })
    mount()
    expect(text()).toContain('테스트 종료')
    await act(async () => quitButton().props.onClick())
    expect(connectionLost()).toBeNull()
    expect(quit).not.toHaveBeenCalled()
  })
  it('quits the desktop app through the bridge', async () => {
    const quit = vi.fn(async () => true)
    const close = vi.fn()
    vi.stubGlobal('window', { posegoodDesktop: { version: 1, quit }, close, closed: false })
    reportConnectionLost({ reason: 'network' })
    mount()
    await act(async () => quitButton().props.onClick())
    expect(quit).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
  })

  it('asks the user to close a browser tab the page cannot close', async () => {
    const close = vi.fn()
    vi.stubGlobal('window', { close, closed: false })
    reportConnectionLost({ reason: 'network' })
    mount()
    await act(async () => quitButton().props.onClick())
    expect(close).toHaveBeenCalledOnce()
    expect(text()).toContain('이 탭을 직접 닫아 주세요')
    expect(quitButton().props.disabled).toBe(false)
  })
})
