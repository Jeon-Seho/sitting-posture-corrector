import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccountAuth } from './useAccountAuth'
import { ACCOUNT_ACCESS_LOST, AccountApiError } from './client'
import { accountUser, accountWorkspace, USER_B } from './testFixtures'

const client = vi.hoisted(() => ({
  me: vi.fn(),
  workspace: vi.fn(),
  setIdentity: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  assertIdentity: vi.fn(),
}))
vi.mock('./client', async (original) => ({
  ...(await original<typeof import('./client')>()),
  accountClient: client,
}))

describe('account identity lifetime', () => {
  let renderer: ReactTestRenderer | undefined
  let auth: ReturnType<typeof useAccountAuth>
  let window: EventTarget
  const stop = vi.fn()
  function Probe() {
    auth = useAccountAuth(stop)
    return null
  }
  async function mount() {
    await act(async () => {
      renderer = create(<Probe />)
    })
  }
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    window = new EventTarget()
    vi.stubGlobal('window', window)
    vi.stubGlobal('document', { hidden: false })
    vi.stubGlobal('localStorage', { setItem: vi.fn() })
    client.me.mockResolvedValue(accountUser)
    client.workspace.mockResolvedValue(accountWorkspace())
    client.login.mockResolvedValue(accountUser)
    client.logout.mockResolvedValue(undefined)
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('loads no profile or history when the server has not authenticated the user', async () => {
    client.me.mockRejectedValueOnce(new AccountApiError('합성 미인증', 401))
    await mount()
    expect(auth!.status).toBe('anonymous')
    expect(auth!.user).toBeNull()
    expect(auth!.workspace).toBeNull()
    expect(client.workspace).not.toHaveBeenCalled()
  })

  it('confirms identity before loading an account workspace', async () => {
    await mount()
    expect(client.setIdentity).toHaveBeenCalledWith(accountUser.user_id)
    expect(auth!.status).toBe('ready')
    expect(auth!.workspace?.profile.name).toBe('합성 계정')
  })

  it('stops capture and clears all displayed account material on an access-loss event', async () => {
    await mount()
    act(() => {
      window.dispatchEvent(new Event(ACCOUNT_ACCESS_LOST))
    })
    expect(stop).toHaveBeenCalledOnce()
    expect(auth!.user).toBeNull()
    expect(auth!.workspace).toBeNull()
    expect(client.setIdentity).toHaveBeenLastCalledWith(null)
  })

  it('does not load a new cookie account into the old foreground screen', async () => {
    await mount()
    client.me.mockResolvedValueOnce({ ...accountUser, user_id: USER_B })
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(auth!.status).toBe('anonymous')
    expect(stop).toHaveBeenCalledOnce()
    expect(client.workspace).toHaveBeenCalledTimes(1)
  })

  it('does not treat temporary identity-check network failure as a different authenticated user', async () => {
    await mount()
    client.me.mockRejectedValueOnce(new AccountApiError('합성 연결 실패', 503))
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(auth!.status).toBe('ready')
    expect(stop).not.toHaveBeenCalled()
  })

  it('ignores a bootstrap response after the account boundary unmounts', async () => {
    let release!: (value: typeof accountUser) => void
    client.me.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    await mount()
    act(() => renderer!.unmount())
    renderer = undefined
    await act(async () => {
      release(accountUser)
    })
    expect(client.workspace).not.toHaveBeenCalled()
  })

  it('invalidates client authentication on unmount before a pending sign-in can complete', async () => {
    client.me.mockRejectedValueOnce(new AccountApiError('합성 미인증', 401))
    let release!: (value: typeof accountUser) => void
    client.login.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    await mount()
    let pending!: Promise<void>
    await act(async () => {
      pending = auth.authenticate(accountUser.email, 'synthetic-password')
    })
    act(() => renderer!.unmount())
    renderer = undefined
    expect(client.setIdentity).toHaveBeenLastCalledWith(null)
    await act(async () => {
      release(accountUser)
      await pending
    })
    expect(client.workspace).not.toHaveBeenCalled()
  })

  it('stops capture and removes profile/history from the login screen after logout', async () => {
    await mount()
    await act(async () => {
      await auth!.logout()
    })
    expect(client.logout).toHaveBeenCalledOnce()
    expect(auth!.status).toBe('anonymous')
    expect(auth!.workspace).toBeNull()
    expect(stop).toHaveBeenCalled()
  })
})
