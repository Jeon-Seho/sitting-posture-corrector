import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ServiceApp from './ServiceApp'

const camera = vi.hoisted(() => ({ connect: vi.fn(), stop: vi.fn() }))
vi.mock('../hooks/useCamera', () => ({ useCamera: () => camera }))
vi.mock('./LocalServiceApp', () => ({ LocalServiceApp: () => <div>existing-user-surface</div> }))
vi.mock('../features/accounts/AccountApp', () => ({ AccountApp: () => <div>existing-account-surface</div> }))
vi.mock('../features/accounts/client', () => ({ SERVER_ACCOUNTS: false }))
vi.mock('../pages/ForecastPage', () => ({ ForecastPage: () => <div>existing-forecast-surface</div> }))
vi.mock('../features/developer/DeveloperRoute', () => ({ default: () => <div>isolated-developer-surface</div> }))

describe('developer entry remains separate from existing user routes', () => {
  let renderer: ReactTestRenderer | undefined
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = undefined
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })
  it.each([
    ['/dev', '', 'isolated-developer-surface'],
    ['/dev/', '#forecast', 'isolated-developer-surface'],
    ['/', '', 'existing-user-surface'],
    ['/', '#forecast', 'existing-forecast-surface'],
    ['/developer', '', 'existing-user-surface'],
  ])('routes %s %s without starting the camera', async (pathname, hash, expected) => {
    vi.stubGlobal('window', { location: { pathname, hash }, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    await act(async () => { renderer = create(<ServiceApp />) })
    expect(JSON.stringify(renderer!.toJSON())).toContain(expected)
    expect(camera.connect).not.toHaveBeenCalled()
  })
})
