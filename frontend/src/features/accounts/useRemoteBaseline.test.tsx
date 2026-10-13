import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CameraController } from '../../hooks/useCamera'
import { useRemoteBaseline } from './useRemoteBaseline'
import { SYNTHETIC_LANDMARKS } from '../testing/syntheticLandmarks'

const client = vi.hoisted(() => ({ currentBaseline: vi.fn(), registerBaseline: vi.fn() }))
vi.mock('./client', () => ({ accountClient: client, accountError: () => '저장 실패' }))
const saved = { schema_version: '2.0', baseline_id: '22222222-2222-3222-8222-222222222222',
  registered_at: '2026-10-13T00:00:00Z', landmarks: SYNTHETIC_LANDMARKS }

describe('independent account baseline persistence', () => {
  let renderer: ReactTestRenderer | undefined
  let state: ReturnType<typeof useRemoteBaseline>
  let camera: CameraController
  function Probe() { state = useRemoteBaseline(camera, '1', true); return null }
  beforeEach(() => {
    vi.resetAllMocks()
    client.currentBaseline.mockResolvedValue(null)
    camera = { calibrationId: 'local-capture', registeredAt: saved.registered_at, baselineStored: false,
      calibrationSummary: { durationMs: 3000, sampleCount: 20, landmarks: SYNTHETIC_LANDMARKS },
      adoptBaseline: vi.fn() } as unknown as CameraController
  })
  afterEach(() => { act(() => renderer?.unmount()); renderer = undefined })
  async function mount() { await act(async () => { renderer = create(<Probe />) }) }

  it('restores a saved baseline when there is no new capture', async () => {
    camera.calibrationId = null
    camera.registeredAt = null
    camera.calibrationSummary = null
    client.currentBaseline.mockResolvedValue(saved)
    await mount()
    expect(camera.adoptBaseline).toHaveBeenCalledWith(saved)
    expect(client.registerBaseline).not.toHaveBeenCalled()
  })

  it('retries the original timestamp and geometry without replacing it with an older stored baseline', async () => {
    client.currentBaseline.mockResolvedValue(saved)
    client.registerBaseline.mockRejectedValueOnce(new Error('lost response')).mockResolvedValue(saved)
    await mount()
    expect(state.error).toBe('저장 실패')
    expect(camera.adoptBaseline).not.toHaveBeenCalled()
    await act(async () => { state.retry() })
    expect(camera.adoptBaseline).toHaveBeenCalledWith(saved)
    const bodies = client.registerBaseline.mock.calls.map(call => call[0])
    expect(bodies.length).toBeGreaterThanOrEqual(2)
    expect(bodies.every(body => JSON.stringify(body) === JSON.stringify(bodies[0]))).toBe(true)
    expect(bodies[0].sample_count).toBe(20)
  })

  it('ignores an in-flight save after leaving the account', async () => {
    let resolve!: (value: typeof saved) => void
    client.registerBaseline.mockReturnValue(new Promise(done => { resolve = done }))
    await mount()
    act(() => renderer!.unmount())
    await act(async () => { resolve(saved) })
    expect(camera.adoptBaseline).not.toHaveBeenCalled()
  })
})
