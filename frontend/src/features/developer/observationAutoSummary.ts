import { COMPARISON_POLICY, medianComparison } from '../../../../model/prototype/observationComparison'
import type { ComparisonCapture, ComparisonTrace } from './observationCsv'
import type { ComparisonAction } from './comparisonDemo'

/** Latest completed hold per instructed task. Incomplete and retried attempts never join. */
export function automaticComparisonCaptures(trace: readonly ComparisonTrace[]): Partial<Record<ComparisonAction, ComparisonCapture>> {
  const result: Partial<Record<ComparisonAction, ComparisonCapture>> = {}
  const pending = new Map<string, ComparisonTrace[]>()
  for (const row of trace) {
    const guide = row.guidance
    if (!guide?.step || guide.step.phase !== 'hold') continue
    const key = JSON.stringify([guide.runId, guide.stepIndex, guide.attempt])
    if (row.event === 'observation' && guide.status === 'running') {
      const batch = pending.get(key) ?? []; batch.push(row); pending.set(key, batch)
    } else if (row.event === 'protocol_phase_completed' && guide.elapsedMs >= guide.step.durationMs) {
      const batch = pending.get(key) ?? []; pending.delete(key)
      if (batch.length < COMPARISON_POLICY.captureSamples || batch[0].guidance!.elapsedMs > COMPARISON_POLICY.gapMs || batch.at(-1)!.guidance!.elapsedMs < guide.step.durationMs - COMPARISON_POLICY.gapMs || batch.some((sample, i) => !sample.imageValid || !sample.values || sample.observationTimeMs === null || i > 0 && (sample.segment !== batch[i-1].segment || sample.observationTimeMs <= batch[i-1].observationTimeMs! || sample.observationTimeMs - batch[i-1].observationTimeMs! > COMPARISON_POLICY.gapMs || sample.elapsedMs - batch[i-1].elapsedMs > COMPARISON_POLICY.gapMs))) continue
      const values = medianComparison(batch.map(sample => ({ timeMs: sample.observationTimeMs!, values: sample.values })))
      if (!values) continue
      result[guide.step.action] = { values, elapsedMs: row.elapsedMs, windowStartMs: batch[0].observationTimeMs!, windowEndMs: batch.at(-1)!.observationTimeMs!, sampleCount: batch.length, segment: batch[0].segment, guidance: guide }
    } else if (['protocol_paused', 'protocol_cancelled', 'interrupted', 'hidden', 'stopped'].includes(row.event)) pending.delete(key)
  }
  return result
}
