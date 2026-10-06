import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRemoteWorkspace } from './useRemoteWorkspace'
import { accountWorkspace, USER_A } from './testFixtures'
import type { AccountWorkspace, WorkspaceUpdate } from './contracts'

const client = vi.hoisted(() => ({
  workspace: vi.fn(),
  updateWorkspace: vi.fn(),
  saveRecord: vi.fn(),
  assertIdentity: vi.fn(),
}))
vi.mock('./client', async (original) => ({
  ...(await original<typeof import('./client')>()),
  accountClient: client,
}))
vi.mock('../../hooks/useWriterLock', () => ({
  useWriterLock: () => ({ state: 'ready', retry: vi.fn() }),
}))

describe('account workspace operation ordering', () => {
  let renderer: ReactTestRenderer | undefined
  let latest: ReturnType<typeof useRemoteWorkspace>
  const error = vi.fn()
  function Probe() {
    latest = useRemoteWorkspace(USER_A, accountWorkspace(), error)
    return null
  }
  beforeEach(() => {
    vi.clearAllMocks()
    client.updateWorkspace.mockReset()
    const storage = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    })
    client.updateWorkspace.mockImplementation(async (value: WorkspaceUpdate) => ({
      schema_version: '1.0',
      ...value,
      records: [],
    }))
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = undefined
    vi.unstubAllGlobals()
  })
  function mount() {
    act(() => {
      renderer = create(<Probe />)
    })
  }

  it('queues changes and keeps saving visible until every queued update settles', async () => {
    let first!: (value: AccountWorkspace) => void, second!: (value: AccountWorkspace) => void
    client.updateWorkspace
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            first = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            second = resolve
          }),
      )
    mount()
    const initial = accountWorkspace()
    let a!: Promise<unknown>, b!: Promise<unknown>
    await act(async () => {
      a = latest.update({ rules: { ...initial.rules, holdSeconds: 4 } })
      b = latest.update({ profile: { ...initial.profile, name: '변경한 합성 이름' } })
    })
    expect(client.updateWorkspace).toHaveBeenCalledTimes(1)
    const changedRules = { ...initial, rules: { ...initial.rules, holdSeconds: 4 } }
    await act(async () => {
      first(changedRules)
      await a
    })
    expect(latest.saving).toBe(true)
    expect(client.updateWorkspace.mock.calls[1][0].rules.holdSeconds).toBe(4)
    const final = { ...changedRules, profile: { ...initial.profile, name: '변경한 합성 이름' } }
    await act(async () => {
      second(final)
      await b
    })
    expect(latest.saving).toBe(false)
    expect(latest.workspace.profile?.name).toBe('변경한 합성 이름')
    expect(client.assertIdentity).toHaveBeenCalledWith(USER_A)
  })

  it('does not dispatch a queued old-account change after unmount', async () => {
    let finish!: (value: AccountWorkspace) => void
    client.updateWorkspace.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    mount()
    let a!: Promise<unknown>, b!: Promise<unknown>
    await act(async () => {
      a = latest.update({ profile: { ...accountWorkspace().profile, name: '첫 요청' } })
      b = latest.update({
        profile: { ...accountWorkspace().profile, name: '전송하면 안 되는 이전 계정 요청' },
      })
      void b.catch(() => {})
    })
    act(() => renderer!.unmount())
    renderer = undefined
    await act(async () => {
      finish(accountWorkspace())
      await a
    })
    await expect(b).rejects.toThrow('계정 화면을 떠났습니다')
    expect(client.updateWorkspace).toHaveBeenCalledTimes(1)
  })

  it('keeps authenticated history readable when temporary browser storage is blocked', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('Synthetic storage denial')
      },
    })
    mount()
    expect(latest.workspace.profile?.name).toBe('합성 계정')
    expect(latest.workspace.canWrite).toBe(false)
    expect(latest.workspace.storageIssues).toHaveLength(1)
  })
})
