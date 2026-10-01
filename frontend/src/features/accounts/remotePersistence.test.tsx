import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionPersistence } from '../session/useSessionPersistence'
import type { SessionRepository } from '../session/repository'
import type { LocalWorkspace } from '../storage/useLocalWorkspace'
import type { CameraController } from '../../hooks/useCamera'
import type { RecordItem } from '../storage/types'
import { syntheticRecord, accountUser } from './testFixtures'
import { DEFAULT_RULES } from '../../data/posture'

describe('durable remote result acknowledgement', () => {
  let renderer: ReactTestRenderer | undefined
  let latest: ReturnType<typeof useSessionPersistence>
  let repository: SessionRepository
  let workspace: LocalWorkspace
  const canonical = () => ({ ...syntheticRecord(), endedAt: '2026-10-01T00:01:01Z' })
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-01T00:01:00Z'))
    vi.stubGlobal('window', new EventTarget())
    repository = {
      readDraft: vi.fn(() => null),
      readRecords: vi.fn(() => []),
      saveDraft: vi.fn(),
      removeDraft: vi.fn(),
      readPending: vi.fn(() => null),
      rememberPending: vi.fn(),
      forgetPending: vi.fn(),
      saveRecord: vi.fn(async () => [canonical()]),
    }
    workspace = {
      rules: DEFAULT_RULES,
      draft: null,
      profile: accountUser.profile,
      records: [],
      showDemo: false,
      canWrite: true,
      writable: { current: true },
      requireWriter: () => true,
      reloadStorage: vi.fn(),
      setDraft: vi.fn(),
      setRecords: vi.fn(),
      setProfile: vi.fn(),
      setRules: vi.fn(),
      setShowDemo: vi.fn(),
      storageIssues: [],
      writer: { state: 'ready', retry: vi.fn() },
    }
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = undefined
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  function mount() {
    const source = syntheticRecord()
    function Probe() {
      latest = useSessionPersistence({
        session: { id: source.id, startedAt: source.startedAt, mode: 'demo', rules: DEFAULT_RULES },
        setSession: vi.fn(),
        ended: { current: false },
        workspace,
        camera: {} as CameraController,
        registration: false,
        onRegistrationComplete: vi.fn(),
        go: vi.fn(),
        setError: vi.fn(),
        repository,
      })
      return null
    }
    act(() => {
      renderer = create(<Probe />)
    })
  }
  const finish = () =>
    latest.finish({ validSeconds: 60, goodSeconds: 60, totalSeconds: 60, events: [] })

  it('keeps the exact pending body and checkpoint until the result POST is acknowledged', async () => {
    let resolve!: (records: RecordItem[]) => void
    vi.mocked(repository.saveRecord).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    mount()
    act(finish)
    const pending = latest.pending.current
    expect(pending).toEqual(syntheticRecord())
    expect(repository.rememberPending).toHaveBeenCalledWith(pending)
    expect(repository.removeDraft).not.toHaveBeenCalled()
    expect(workspace.setRecords).not.toHaveBeenCalled()
    await act(async () => {
      resolve([canonical()])
    })
    expect(workspace.setRecords).toHaveBeenCalledWith([canonical()])
    expect(latest.pending.current).toBeNull()
    expect(repository.forgetPending).toHaveBeenCalledWith(pending!.id)
    expect(repository.removeDraft).toHaveBeenCalledWith(pending!.id)
  })

  it('retries an uncertain save with the identical body and prevents simultaneous result writes', async () => {
    let resolve!: (records: RecordItem[]) => void
    vi.mocked(repository.saveRecord)
      .mockRejectedValueOnce(new Error('Synthetic uncertain response'))
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done
          }),
      )
    mount()
    await act(async () => {
      finish()
    })
    const first = vi.mocked(repository.saveRecord).mock.calls[0][0]
    expect(latest.pending.current).toEqual(first)
    act(() => {
      latest.retrySave()
      latest.retrySave()
    })
    expect(repository.saveRecord).toHaveBeenCalledTimes(2)
    expect(vi.mocked(repository.saveRecord).mock.calls[1][0]).toBe(first)
    await act(async () => {
      resolve([canonical()])
    })
    expect(latest.pending.current).toBeNull()
  })

  it('does not apply an old account response or clear its retry after unmount', async () => {
    let resolve!: (records: RecordItem[]) => void
    vi.mocked(repository.saveRecord).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    mount()
    act(finish)
    act(() => renderer!.unmount())
    renderer = undefined
    await act(async () => {
      resolve([canonical()])
    })
    expect(workspace.setRecords).not.toHaveBeenCalled()
    expect(repository.forgetPending).not.toHaveBeenCalled()
    expect(repository.removeDraft).not.toHaveBeenCalled()
  })
})
