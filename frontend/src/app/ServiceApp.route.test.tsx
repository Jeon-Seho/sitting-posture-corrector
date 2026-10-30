import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './ServiceApp'

const calls = vi.hoisted(() => ({ useCamera: vi.fn(() => ({ marker: 'shared-camera' })) }))
vi.mock('../hooks/useCamera', () => ({ useCamera: calls.useCamera }))
vi.mock('./LocalServiceApp', () => ({ LocalServiceApp: () => <div>service-only</div> }))
vi.mock('../features/developer/DeveloperRoute', () => ({ default: () => <div>local-observation-only</div> }))
vi.mock('../features/connection/ConnectionLostDialog', () => ({ ConnectionLostDialog: () => null }))
vi.mock('../features/camera/CameraPerformanceDialog', () => ({ CameraPerformanceDialog: () => null }))

describe('service and local observation routes', () => {
  let ui: ReactTestRenderer | undefined
  afterEach(() => { act(() => ui?.unmount()); ui = undefined; vi.unstubAllGlobals(); vi.clearAllMocks() })

  it('uses the server baseline at / and the local baseline at /dev', async () => {
    const win = Object.assign(new EventTarget(), { location: { pathname: '/' } })
    vi.stubGlobal('window', win)
    await act(async () => { ui = create(<App />) })
    expect(JSON.stringify(ui!.toJSON())).toContain('service-only')
    expect(calls.useCamera).toHaveBeenLastCalledWith()
    win.location.pathname = '/dev'
    await act(async () => { win.dispatchEvent(new Event('popstate')); await Promise.resolve() })
    expect(JSON.stringify(ui!.toJSON())).toContain('local-observation-only')
    expect(JSON.stringify(ui!.toJSON())).not.toContain('service-only')
    expect(calls.useCamera).toHaveBeenLastCalledWith({ baselineMode: 'local' })
    win.location.pathname = '/'
    await act(async () => { win.dispatchEvent(new Event('popstate')) })
    expect(JSON.stringify(ui!.toJSON())).toContain('service-only')
    expect(calls.useCamera).toHaveBeenLastCalledWith()
  })
})
