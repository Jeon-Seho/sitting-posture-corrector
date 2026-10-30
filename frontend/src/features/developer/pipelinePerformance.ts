/** /dev-only timing aggregates. No images, coordinates, IDs or participant data. */
export const PIPELINE_SAMPLE_LIMIT = 600
export const PIPELINE_METRICS = ['cameraConsumer', 'engineStep', 'publishScheduling', 'captureToConsumer', 'reactRender'] as const
export type PipelineMetric = typeof PIPELINE_METRICS[number]
export interface PipelineTiming {
  /** All calls since the last explicit reset; quantiles describe the retained window. */
  count: number
  samples: number
  p50Ms: number | null
  p95Ms: number | null
  maxMs: number | null
  meanMs: number | null
  totalMs: number
}
type TimingWindow = { count: number; total: number; values: number[]; cursor: number }
const timings = new Map<PipelineMetric, TimingWindow>()

export function recordPipelineDuration(metric: PipelineMetric, milliseconds: number): void {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return
  let window = timings.get(metric)
  if (!window) { window = { count: 0, total: 0, values: [], cursor: 0 }; timings.set(metric, window) }
  window.count++
  window.total += milliseconds
  if (window.values.length < PIPELINE_SAMPLE_LIMIT) window.values.push(milliseconds)
  else {
    window.values[window.cursor] = milliseconds
    window.cursor = (window.cursor + 1) % PIPELINE_SAMPLE_LIMIT
  }
}

export function measurePipeline<T>(metric: PipelineMetric, operation: () => T): T {
  const started = performance.now()
  try { return operation() }
  finally { recordPipelineDuration(metric, performance.now() - started) }
}

export function readPipelinePerformance(): Record<PipelineMetric, PipelineTiming> {
  return Object.fromEntries(PIPELINE_METRICS.map(metric => {
    const window = timings.get(metric)
    const values = window ? [...window.values].sort((a, b) => a - b) : []
    const quantile = (fraction: number) => values.length ? values[Math.max(0, Math.ceil(values.length * fraction) - 1)] : null
    return [metric, {
      count: window?.count ?? 0, samples: values.length,
      p50Ms: quantile(.5), p95Ms: quantile(.95), maxMs: values.at(-1) ?? null,
      meanMs: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
      totalMs: window?.total ?? 0,
    }]
  })) as Record<PipelineMetric, PipelineTiming>
}

export function resetPipelinePerformance(): void { timings.clear() }
