import { ObservationComparison, comparisonValues, type ComparisonFrame, type ComparisonGeometry, type ComparisonSample, type ComparisonValues } from '../../../../model/prototype/observationComparison'
import { OBSERVATION_REFERENCE_MS } from './observationProtocol'
import { replayFrameAt, replayIndexAt, type ObservationReplayData, type ReplayFrame } from './observationReplay'

type MetricFrame = { current: ComparisonGeometry | null; reference: ComparisonGeometry | null; values: ComparisonValues | null }
export type ReplayMetricSeries = { frames: MetricFrame[]; samples: ComparisonSample[] }
function input(frame: ReplayFrame): ComparisonFrame {
  const points = (values: ReplayFrame['image']) => values.map(p => p ? { ...p, visibility: p.visibility ?? 0 } : { x: NaN, y: NaN, z: NaN, visibility: 0 })
  return { timeMs: frame.observationTimeMs ?? NaN, width: frame.width, height: frame.height, poseModelId: frame.poseModelId ?? undefined, measurable: frame.measurable ?? undefined, landmarks: points(frame.image), worldLandmarks: points(frame.world) }
}

/** Display-only reconstruction. Registration uses the same engine as live capture. */
export function replayMetricSeries(data: ObservationReplayData): ReplayMetricSeries {
  const engine = new ObservationComparison(OBSERVATION_REFERENCE_MS)
  const frames: MetricFrame[] = [], samples: ComparisonSample[] = []
  let registering = false, markerIndex = 0, lastObservation = 0
  for (const frame of data.frames) {
    while (data.markers[markerIndex] && data.markers[markerIndex].elapsedMs < frame.elapsedMs) {
      engine.interrupt(lastObservation); markerIndex++
    }
    if (frame.phase === 'registering' && !registering) engine.beginReference()
    registering = frame.phase === 'registering'
    if (frame.observationTimeMs === null) engine.interrupt(lastObservation)
    else { engine.accept(input(frame)); lastObservation = frame.observationTimeMs }
    // The first post-registration frame may complete the 8s boundary. Never keep
    // registering on later task frames when the recorded registration failed.
    if (!registering && engine.registering) engine.registering = false
    const current = engine.current, reference = engine.reference
    const values = current && reference ? comparisonValues(current, reference) : null
    frames.push({ current, reference, values })
    samples.push({ timeMs: frame.elapsedMs, values })
  }
  for (const marker of data.markers) samples.push({ timeMs: marker.elapsedMs, values: null })
  samples.sort((a, b) => a.timeMs - b.timeMs)
  return { frames, samples }
}
export function replayMetricsAt(data: ObservationReplayData, series: ReplayMetricSeries, position: number) {
  const index = replayIndexAt(data.frames, position), entry = series.frames[index]
  const available = replayFrameAt(data, position) !== null
  const current = available ? entry?.current ?? null : null
  const reference = entry?.reference ?? null
  const values = available ? entry?.values ?? null : null
  const samples = series.samples.filter(s => s.timeMs >= position - 10000 && s.timeMs <= position).slice(-120)
  if (samples.at(-1)?.timeMs !== position || !available) samples.push({ timeMs: position, values })
  return { current, reference, values, samples }
}
