import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CameraController, Observation } from '../../hooks/useCamera'
import * as normalPosture from '../../../../model/prototype/normalPosture'
import { useNormalCollection, type NormalCollectionController } from './useNormalCollection'
import { NormalCollectionCapture } from './normalCollection'

// Synthetic observations only; the fake camera never acquires a device.
const frame = (timeMs: number): Observation => {
  const landmarks = Array.from({ length: 13 }, (_, i) => ({ x: i === 11 ? .3 : i === 12 ? .7 : .5, y: i < 11 ? .3 : .6, z: 0, visibility: .95 }))
  return { timeMs, videoTimeMs: timeMs, width: 640, height: 480, inferenceMs: 3, delegate: 'CPU', landmarks, worldLandmarks: landmarks, features: null }
}
const metadata = { participantCode: 'synthetic_p01', sessionCode: 'synthetic_session', purpose: 'personal_calibration' as const }
describe('normal collection hook lifecycle, synthetic camera only', () => {
  let renderer: ReactTestRenderer, controller: NormalCollectionController, camera: CameraController
  let listeners: Set<(observation: Observation) => void>, hidden: boolean, visibility: (() => void) | undefined, disabled: boolean
  const onApplyProfile = vi.fn(), onClearProfile = vi.fn(), click = vi.fn()
  function Probe() { controller = useNormalCollection(camera, { onApplyProfile, onClearProfile, disabled }); return null }
  const emit = (t: number) => act(() => { vi.setSystemTime(t); listeners.forEach(listener => listener(frame(t))) })
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(0); vi.clearAllMocks()
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
    listeners = new Set(); hidden = false; visibility = undefined; disabled = false
    vi.stubGlobal('document', { get visibilityState() { return hidden ? 'hidden' : 'visible' },
      addEventListener: vi.fn((name, listener) => { if (name === 'visibilitychange') visibility = listener }), removeEventListener: vi.fn(),
      createElement: vi.fn(() => ({ click })) })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    camera = { state: 'on', error: '', connect: vi.fn().mockResolvedValue(undefined), stop: vi.fn(),
      streamRef: { current: { getVideoTracks: () => [{ readyState: 'live' }] } },
      subscribe: (listener: (observation: Observation) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    } as unknown as CameraController
    act(() => { renderer = create(<Probe />) })
  })
  afterEach(() => { act(() => renderer.unmount()); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals() })

  it('collects nothing on mount, requires reviewed completion before fitting/download, and never stops shared camera', async () => {
    emit(100)
    expect(controller.snapshot.phase).toBe('idle')
    expect(camera.connect).not.toHaveBeenCalled()
    await act(async () => controller.start(metadata))
    for (let t = 100; t <= 33100; t += 100) emit(t)
    expect(controller.snapshot.phase).toBe('review')
    expect(onApplyProfile).not.toHaveBeenCalled()
    act(() => controller.downloadDataset()); expect(click).not.toHaveBeenCalled()
    act(() => controller.confirmAndApply())
    expect(onApplyProfile).toHaveBeenCalledOnce()
    expect(controller.profile?.provenance.participantCode).toBe('synthetic_p01')
    expect(controller.snapshot.phase).toBe('confirmed')
    act(() => controller.downloadDataset()); expect(click).toHaveBeenCalledOnce()
    act(() => controller.discard()); expect(controller.snapshot.samples).toBe(0)
    expect(camera.stop).not.toHaveBeenCalled()
  })

  it('excludes background time and does not resume collection automatically', async () => {
    await act(async () => controller.start(metadata))
    for (let t = 0; t <= 4000; t += 100) emit(t)
    hidden = true; act(() => visibility?.())
    expect(controller.snapshot).toMatchObject({ phase: 'review', validMs: 1000, canConfirm: false })
    hidden = false; emit(5000)
    expect(controller.snapshot.validMs).toBe(1000)
  })

  it('exports reviewed training candidates without applying them, and rejects them as a personal import', async () => {
    const training = { ...metadata, purpose: 'training_normal' as const }
    await act(async () => controller.start(training))
    for (let t = 0; t <= 33000; t += 100) emit(t)
    act(() => controller.confirmAndApply())
    expect(controller.snapshot.phase).toBe('confirmed')
    expect(onApplyProfile).not.toHaveBeenCalled()
    expect(controller.profile).toBeNull()
    act(() => controller.downloadDataset()); expect(click).toHaveBeenCalledOnce()
    const captured = new NormalCollectionCapture(training, 'synthetic_id', '2026-10-14T00:00:00Z', 0)
    for (let t = 0; t <= 33000; t += 100) captured.observe(frame(t))
    const p = captured.confirm()
    await act(async () => controller.importProfile({ size: 100, text: async () => JSON.stringify(p) } as File))
    expect(controller.error).toContain('학습 자료용')
    expect(onApplyProfile).not.toHaveBeenCalled()
    p.provenance.purpose = 'personal_calibration'
    await act(async () => controller.importProfile({ size: 100, text: async () => JSON.stringify(p) } as File))
    expect(onApplyProfile).toHaveBeenCalledOnce()
    expect(controller.profile?.id).toBe('synthetic_id')
  })

  it('exports evaluation-only coordinates without fitting or replacing an existing personal profile', async () => {
    const personal = new NormalCollectionCapture(metadata, 'synthetic_existing_profile', '2026-10-14T00:00:00Z', 0)
    for (let t = 0; t <= 33000; t += 100) personal.observe(frame(t))
    await act(async () => controller.importProfile({ size: 100, text: async () => JSON.stringify(personal.confirm()) } as File))
    const existingProfile = controller.profile
    expect(existingProfile?.id).toBe('synthetic_existing_profile')
    onApplyProfile.mockClear()
    const fit = vi.spyOn(normalPosture, 'fitNormalPostureProfile')
    await act(async () => controller.start({ ...metadata, purpose: 'forecast_evaluation' }))
    for (let t = 0; t <= 33000; t += 100) emit(t)
    expect(controller.snapshot).toMatchObject({ phase: 'review', canConfirm: true })
    act(() => controller.downloadDataset())
    expect(click).not.toHaveBeenCalled()
    act(() => controller.confirmAndApply())
    expect(controller.snapshot.phase).toBe('confirmed')
    expect(controller.profile).toBe(existingProfile)
    expect(fit).not.toHaveBeenCalled()
    expect(onApplyProfile).not.toHaveBeenCalled()
    expect(onClearProfile).not.toHaveBeenCalled()
    act(() => controller.downloadDataset())
    expect(click).toHaveBeenCalledOnce()
    const anchor = vi.mocked(document.createElement).mock.results.at(-1)?.value as HTMLAnchorElement
    expect(anchor.download).toMatch(/^forecast-evaluation-.+\.json$/)
    const blob = vi.mocked(URL.createObjectURL).mock.calls.at(-1)![0] as Blob
    const dataset = JSON.parse(await blob.text())
    expect(dataset).toMatchObject({ schema_version: 'forecast-evaluation-collection-v1', dataRole: 'evaluation_only', trainingAllowed: false, review: 'user_confirmed_evaluation', metadata: { purpose: 'forecast_evaluation' }, validMs: 30000 })
    expect(dataset.frames).toHaveLength(301)
    expect(dataset).not.toHaveProperty('label')
    expect(dataset).not.toHaveProperty('profile')
    act(() => controller.discard())
    expect(controller.profile).toBe(existingProfile)
    expect(camera.stop).not.toHaveBeenCalled()
  })

  it('does not confirm or export an incomplete evaluation capture', async () => {
    await act(async () => controller.start({ ...metadata, purpose: 'forecast_evaluation' }))
    for (let t = 0; t <= 4000; t += 100) emit(t)
    act(() => controller.interrupt('합성 평가 수집 중단'))
    expect(controller.snapshot).toMatchObject({ phase: 'review', validMs: 1000, canConfirm: false })
    act(() => controller.confirmAndApply())
    expect(controller.error).toContain('30초')
    act(() => controller.downloadDataset())
    expect(click).not.toHaveBeenCalled()
    expect(onApplyProfile).not.toHaveBeenCalled()
    expect(controller.profile).toBeNull()
  })

  it('handles connect resolving with an error, rejects invalid metadata before permission and blocks double starts', async () => {
    camera.state = 'off'; camera.streamRef.current = null
    await act(async () => controller.start({ ...metadata, participantCode: '실명 금지' }))
    expect(camera.connect).not.toHaveBeenCalled()
    await act(async () => controller.start(metadata))
    expect(controller.snapshot.phase).toBe('idle')
    expect(controller.error).toContain('카메라 연결')
    let resolve!: () => void
    vi.mocked(camera.connect).mockImplementation(() => new Promise<void>(done => { resolve = done }))
    let first!: Promise<void>
    act(() => { first = controller.start(metadata); void controller.start(metadata) })
    expect(camera.connect).toHaveBeenCalledTimes(2)
    await act(async () => { resolve(); await first })
    expect(controller.connecting).toBe(false)
  })

  it('guards stale callbacks while measurement is active and rejects oversized profile files', async () => {
    disabled = true; act(() => renderer.update(<Probe />))
    await act(async () => controller.start(metadata))
    expect(controller.snapshot.phase).toBe('idle')
    act(() => controller.clearProfile()); expect(onClearProfile).not.toHaveBeenCalled()
    disabled = false; act(() => renderer.update(<Probe />))
    const text = vi.fn()
    await act(async () => controller.importProfile({ size: 100001, text } as unknown as File))
    expect(text).not.toHaveBeenCalled()
    expect(controller.error).toContain('100KB')
  })

  it('cancels late preparation on navigation and releases subscription on unmount', async () => {
    camera.state = 'off'
    let resolve!: () => void
    vi.mocked(camera.connect).mockImplementation(() => new Promise<void>(done => { resolve = done }))
    let starting!: Promise<void>
    act(() => { starting = controller.start(metadata) })
    act(() => controller.interrupt())
    expect(camera.stop).toHaveBeenCalledOnce()
    await act(async () => { resolve(); await starting })
    expect(controller.snapshot.phase).toBe('idle')
    act(() => renderer.unmount())
    expect(listeners.size).toBe(0)
  })
})
