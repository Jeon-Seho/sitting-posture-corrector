import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ServiceApp from './ServiceApp'
import { AppErrorBoundary, ErrorPage, ERROR_PAGES } from '../pages/ErrorPage'

const camera = vi.hoisted(() => vi.fn(() => ({})))
vi.mock('../hooks/useCamera', () => ({ useCamera: camera }))

const ART = { request: 404, server: 503, offline: 502, app: 500, not_found: 404 }

describe('error recovery routes', () => {
  let ui: ReactTestRenderer | undefined
  afterEach(() => { act(() => ui?.unmount()); ui = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); camera.mockClear() })

  it.each([
    ['/error/request', 'request'], ['/error/server', 'server'], ['/error/offline', 'offline'], ['/error/app', 'app'],
    ['/missing-page', 'not_found'], ['/error/503', 'not_found'],
  ] as const)('renders %s as the %s page without mounting camera or account state', async (path, kind) => {
    vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { pathname: path } }))
    await act(async () => { ui = create(<ServiceApp />) })
    expect(ui!.root.findByType('h1').children.join('')).toBe(ERROR_PAGES[kind].title)
    expect(ui!.root.findByType('img').props.src).toBe(`/illustrations/themes/green-error-${ART[kind]}.webp`)
    expect(camera).not.toHaveBeenCalled()
  })

  it('sends an unknown path home', async () => {
    vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { pathname: '/missing-page' } }))
    await act(async () => { ui = create(<ServiceApp />) })
    expect(ui!.root.findByType('a').props.href).toBe('/')
  })

  it('reloads the page when no in-app retry is given', async () => {
    const reload = vi.fn()
    vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { pathname: '/error/server', reload } }))
    await act(async () => { ui = create(<ServiceApp />) })
    act(() => ui!.root.findByType('button').props.onClick())
    expect(reload).toHaveBeenCalledOnce()
  })

  it('says it is not the user\'s fault and shows the code small under the button', async () => {
    const retry = vi.fn()
    await act(async () => { ui = create(<ErrorPage inline kind="server" status={503} at={Date.parse('2026-11-10T05:32:00Z')} recordsSafe onRetry={retry} />) })
    const text = ui!.root.findAllByType('p').map(p => p.children.join(''))
    expect(text).toContain('사용자 잘못이 아니에요. 잠시 뒤 다시 시도해 주세요.')
    expect(text).toContain('측정한 기록은 저장돼 있어요.')
    expect(ui!.root.findByProps({ className: 'error-code' }).children.join('')).toBe('오류 503 · 11/10 14:32')
    act(() => ui!.root.findByType('button').props.onClick())
    expect(retry).toHaveBeenCalledOnce()
  })

  it('keeps the record line off pages that are not about records', async () => {
    await act(async () => { ui = create(<ErrorPage inline kind="request" status={400} recordsSafe />) })
    const text = ui!.root.findAllByType('p').map(p => p.children.join(''))
    expect(text).not.toContain('측정한 기록은 저장돼 있어요.')
    expect(ui!.root.findByType('button').children.join('')).toBe('새로 고침')
  })

  it('recovers a rendering failure with the app error page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reload = vi.fn()
    vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { pathname: '/', reload } }))
    function Broken(): never { throw new Error('synthetic render failure') }
    await act(async () => { ui = create(<AppErrorBoundary><Broken /></AppErrorBoundary>) })
    expect(ui!.root.findByType('h1').children.join('')).toBe(ERROR_PAGES.app.title)
    act(() => ui!.root.findByType('button').props.onClick())
    expect(reload).toHaveBeenCalledOnce()
  })
})
