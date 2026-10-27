import { describe, expect, it } from 'vitest'
import { comparisonDemo } from './comparisonDemo'
import { ObservationReplayArchive, type ObservationReplayData, type ReplayContext } from './observationReplay'
import { replayMetricSeries, replayMetricsAt } from './observationReplayMetrics'

function recording(options: { noRegistration?: boolean; missingWorld?: boolean; interruptedRegistration?: boolean } = {}) {
  const archive = new ObservationReplayArchive('explicit-synthetic-metrics', '2026-10-27T00:00:00Z')
  for (let time = 0; time <= 20000; time += 100) {
    if (options.interruptedRegistration && time > 5000 && time < 7000) continue
    const phase = options.noRegistration ? 'hold' : time < 2000 ? 'preparing' : time < 10000 ? 'registering' : 'hold'
    const frame = comparisonDemo(100000 + time, time < 11000 ? 'neutral' : 'head')
    if (options.missingWorld && time === 6000) frame.worldLandmarks = []
    const context: ReplayContext = { phase, task: time < 11000 ? 'neutral' : 'head', round: 1, trial: 1, attempt: 1, segment: 1, measurement: phase === 'hold' }
    archive.append(frame, time, context)
  }
  return { ...archive.snapshot(), source: 'synthetic' as const }
}
function at(data: ObservationReplayData, position: number) { return replayMetricsAt(data, replayMetricSeries(data), position) }
describe('replay metrics from explicit synthetic registration and landmarks', () => {
  it('reconstructs only the recorded registration and seeks values without future samples', () => {
    const data = recording(), series = replayMetricSeries(data)
    const before = replayMetricsAt(data, series, 5000)
    expect(before.reference).toBeNull(); expect(before.values).toBeNull()
    const registered = replayMetricsAt(data, series, 10500)
    expect(registered.values?.headGap).toBeCloseTo(0)
    const changed = replayMetricsAt(data, series, 12000)
    expect(changed.values?.headGap).toBeCloseTo(1.875)
    expect(changed.values?.relativeZ).toBeCloseTo(-20)
    expect(changed.current?.world?.relativeZ).toBeCloseTo(-.08)
    expect(changed.samples.every(s => s.timeMs <= 12000 && s.timeMs >= 2000)).toBe(true)
    expect(replayMetricsAt(data, series, 5000).values).toBeNull()
  })
  it('does not invent a baseline from task-only recordings', () => {
    const result = at(recording({ noRegistration: true }), 16000)
    expect(result.current?.world).not.toBeNull()
    expect(result.reference).toBeNull(); expect(result.values).toBeNull()
    expect(result.samples.every(sample => sample.values === null)).toBe(true)
  })
  it('keeps missing reference depth empty while preserving valid image metrics', () => {
    const result = at(recording({ missingWorld: true }), 12000)
    expect(result.values?.headGap).toBeCloseTo(1.875)
    expect(result.reference?.world).toBeNull(); expect(result.values?.relativeZ).toBeNull()
    expect(result.current?.world?.relativeZ).toBeCloseTo(-.08)
  })
  it('does not complete an interrupted registration using later task frames', () => {
    const result = at(recording({ interruptedRegistration: true }), 20000)
    expect(result.reference).toBeNull(); expect(result.values).toBeNull()
  })
  it('retains an explicit gap at markers and at positions without a recent observation', () => {
    const data = recording()
    const index = data.frames.findIndex(frame => frame.elapsedMs === 12000)
    data.markers = [{ elapsedMs: 12050, afterFrame: index, reason: 'hidden' }]
    data.frames = data.frames.filter(frame => frame.elapsedMs <= 12000 || frame.elapsedMs >= 13000)
    const result = at(data, 12500)
    expect(result.current).toBeNull(); expect(result.values).toBeNull()
    expect(result.samples.at(-1)).toEqual({ timeMs: 12500, values: null })
    expect(result.samples.some(sample => sample.timeMs === 12050 && sample.values === null)).toBe(true)
    expect(at(data, 13200).values?.relativeZ).toBeCloseTo(-20)
    expect(at(data, 20700).values).toBeNull()
  })
})
