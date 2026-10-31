import { replayMetricSeries } from './observationReplayMetrics'
import type { ObservationReplayData } from './observationReplay'

/** Candidate features only; guidance is not a reviewed training label. */
export function observationFeatureExport(data: ObservationReplayData) {
  const metrics = replayMetricSeries(data)
  return {
    schema_version: 'observation-ml-candidates-v1',
    source_schema: data.schema_version, runId: data.runId, startedAt: data.startedAt,
    source: data.source, protocolId: data.protocolId, plan: data.plan, guideMode: data.guideMode ?? null, schedule: data.schedule ?? null,
    labelKind: data.labelKind, mirrored: data.mirrored,
    note: 'Research candidate features; guided tasks are not ground truth. Split by participant before training.',
    feature_definition: 'observation-comparison-v1', arm_indices: Array.from({ length: 10 }, (_, i) => i + 13),
    markers: data.markers, droppedFrames: data.droppedFrames,
    frames: data.frames.map((frame, index) => {
      const entry = metrics.frames[index], values = entry.values
      return {
        elapsedMs: frame.elapsedMs, observationTimeMs: frame.observationTimeMs, phase: frame.phase,
        task: frame.task, round: frame.round, trial: frame.trial, attempt: frame.attempt,
        segment: frame.segment, measurement: frame.measurement, poseModelId: frame.poseModelId,
        imageValid: !!entry.current?.image, worldValid: !!entry.current?.world,
        referenceReady: !!entry.reference?.image,
        features: values ? { headGap: values.headGap, faceHeight: values.faceHeight, shoulderLift: values.shoulderLift,
          shoulderScale: values.shoulderScale, relativeZ: values.relativeZ } : null,
        armsImage: Array.from({ length: 10 }, (_, i) => frame.image[i + 13] ?? null),
        armsWorld: Array.from({ length: 10 }, (_, i) => frame.world[i + 13] ?? null),
      }
    }),
  }
}
export function downloadObservationFeatures(data: ObservationReplayData) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(observationFeatureExport(data))], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url; link.download = `posture-ml-features-${data.source}-${Date.now()}.json`
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
