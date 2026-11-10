import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ServiceApp from './ServiceApp'
import { AppErrorBoundary, ERROR_PAGES } from '../pages/ErrorPage'

const camera = vi.hoisted(() => vi.fn(() => ({})))
vi.mock('../hooks/useCamera', () => ({ useCamera: camera }))

describe('error recovery routes', () => {
  let ui: ReactTestRenderer | undefined
  afterEach(() => { act(() => ui?.unmount()); ui = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); camera.mockClear() })

  it.each([...Object.keys(ERROR_PAGES).map(code => `/error/${code}`), '/missing-page', '/error/999'])('renders %s without mounting camera or account state', async path => {
    vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { pathname: path } }))
    await act(async () => { ui = create(<ServiceApp />) })
    const expectedCode = path === '/missing-page' || path === '/error/999' ? 404 : Number(path.split('/').pop())
    expect(ui!.root.findByType('h1').children.join('')).not.toBe('')
    expect(ui!.root.findByType('a').props.href).toBe('/')
    expect(ui!.root.findByType('img').props.src).toBe(`/illustrations/themes/green-error-${expectedCode}.webp`)
    expect(camera).not.toHaveBeenCalled()
    expect(ui!.root.findByProps({ className: 'error-code' }).children.join('')).toBe(`오류 ${expectedCode}`)
  })

  it('retries a server page with a real reload', async () => {
    const reload = vi.fn()
    vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { pathname: '/error/503', reload } }))
    await act(async () => { ui = create(<ServiceApp />) })
    act(() => ui!.root.findByType('button').props.onClick())
    expect(reload).toHaveBeenCalledOnce()
  })

  it('recovers a rendering failure with a simple explanation and home link', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Broken(): never { throw new Error('synthetic render failure') }
    await act(async () => { ui = create(<AppErrorBoundary><Broken /></AppErrorBoundary>) })
    expect(ui!.root.findByType('h1').children.join('')).toBe(ERROR_PAGES[500].title)
    expect(ui!.root.findByType('a').props.href).toBe('/')
  })
})
