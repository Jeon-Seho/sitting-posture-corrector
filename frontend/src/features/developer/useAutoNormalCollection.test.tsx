import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { liveForecastPoints } from '../../../../model/prototype/forecast'
import { useAutoNormalCollection, type AutoNormalCollectionController } from './useAutoNormalCollection'
import type { AutoNormalObservation } from './autoNormalCollection'
const frame = (timeMs: number): AutoNormalObservation => {
  const landmarks = Array.from({ length: 13 }, (_, i) => ({ x: i === 11 ? .3 : i === 12 ? .7 : .5, y: i < 11 ? .3 : .6, z: 0, visibility: .95 }))
  return { frame: { timeMs, videoTimeMs: timeMs, width: 640, height: 480, inferenceMs: 3, delegate: 'CPU', landmarks, worldLandmarks: landmarks, features: null },
    reading: { schema_version: 'forecast-experiment-v1', timeMs, state: 'warming', ruleState: 'near_reference', deviation: 0, error: null, errorLimit: .02,
      durationMs: 0, progress: 1, returnedExcursions: 0, modelId: 'synthetic', domainValidated: false, evaluationMode: 'observed-v2' },
    runId: 'synthetic_run', observationTimeMs: timeMs, source: 'camera', baseline: liveForecastPoints(landmarks, landmarks)! }
}
describe('automatic normal collection hook, synthetic data only', () => {
  let renderer: ReactTestRenderer, controller: AutoNormalCollectionController, hidden: boolean, visibility: (() => void) | undefined
  const click = vi.fn()
  function Probe() { controller = useAutoNormalCollection(); return null }
  beforeEach(() => {
    vi.clearAllMocks(); hidden = false; visibility = undefined
    vi.stubGlobal('document', { get visibilityState() { return hidden ? 'hidden' : 'visible' },
      addEventListener: vi.fn((name, listener) => { if (name === 'visibilitychange') visibility = listener }), removeEventListener: vi.fn(), createElement: vi.fn(() => ({ click })) })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    act(() => { renderer = create(<Probe />) })
  })
  afterEach(() => { act(() => renderer.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals() })
  it('starts enabled without observations and downloads only explicit eligible data', async () => {
    expect(controller.snapshot).toMatchObject({ enabled: true, total: 0 })
    act(() => controller.downloadDataset()); expect(click).not.toHaveBeenCalled()
    act(() => controller.observe(frame(100))); expect(controller.snapshot.total).toBe(1)
    act(() => controller.downloadDataset()); expect(click).toHaveBeenCalledOnce()
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    expect(JSON.parse(await blob.text())).toMatchObject({ label: 'normal_auto_assumed', review: 'not_reviewed' })
  })
  it('excludes hidden observations, preserves rows on endRun, and clears only explicitly', () => {
    act(() => controller.observe(frame(0)))
    hidden = true; act(() => visibility?.()); act(() => controller.observe(frame(100)))
    expect(controller.snapshot.total).toBe(1)
    hidden = false; act(() => controller.observe(frame(200)))
    expect(controller.snapshot.recentRows[0].segment).toBe(1)
    act(() => controller.endRun()); expect(controller.snapshot).toMatchObject({ total: 2, status: 'waiting' })
    act(() => controller.setEnabled(false)); act(() => controller.setParticipantCode('synthetic_new'))
    expect(controller.snapshot.participantCode).toBe('synthetic_new')
    act(() => controller.discard()); expect(controller.snapshot.total).toBe(0)
  })
  it('changes selection during a run while preserving provenance and segment separation', async () => {
    act(() => controller.observe(frame(0)))
    act(() => controller.setMaximumDeviation(.03))
    act(() => controller.observe(frame(100)))
    expect(controller.snapshot.maximumDeviation).toBe(.03)
    expect(controller.snapshot.recentRows.map(row => row.segment)).toEqual([1, 0])
    act(() => controller.downloadDataset())
    const d = JSON.parse(await (vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob).text())
    expect(d.schema_version).toBe('normal-posture-auto-collection-v2')
    expect(d.rows.map((row: { maximumDeviation: number }) => row.maximumDeviation)).toEqual([.06, .03])
    act(() => controller.setMaximumDeviation(.5))
    expect(controller.error).toContain('0.5%')
    expect(controller.snapshot.maximumDeviation).toBe(.03)
  })
  it('refreshes repeated exclusion counts at a bounded rate even if the reason does not change', () => {
    let now = 1000; vi.spyOn(performance, 'now').mockImplementation(() => now)
    const poor = (time: number) => { const input = frame(time); input.frame.landmarks[0].visibility = .1; return input }
    act(() => controller.observe(poor(0)))
    expect(controller.snapshot.diagnostics.excluded.quality).toBe(1)
    now += 50; act(() => controller.observe(poor(100)))
    expect(controller.snapshot.diagnostics.excluded.quality).toBe(1)
    now += 250; act(() => controller.observe(poor(200)))
    expect(controller.snapshot.diagnostics.excluded.quality).toBe(3)
  })
})
