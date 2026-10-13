import { FORECAST_MAX_SAMPLE_GAP_MS, liveForecastPoints, type ForecastReading, type ForecastState } from '../../../../model/prototype/forecast'
import { GUIDANCE_SETTINGS, syntheticGuideFrame } from '../../../../model/prototype/developerGuidance'
import { ALERT_SETTINGS } from './alerts'
import type { LabEvent, LabRecord, LabSummary } from './types'

export const LAB_LIMITS = { readings: 3000, events: 100, records: 8 } as const
export const LAB_SETTINGS = {
  baseline_ms: 8000, horizon_ms: 300, deviation: .12, recovery: .08,
  sustained_ms: 3000, fallback_ms: 5000, recovery_ms: 3000,
} as const
export const emptySummary = (): LabSummary => ({
  elapsedMs: 0, validMs: 0, nearMs: 0, unavailableMs: 0,
  nearPercent: null, meanError: null, deviations: 0,
})

const measured = (r: ForecastReading) => ![
  'needs_reference', 'registering', 'warming', 'unmeasurable',
].includes(r.state)
const labels: Record<ForecastState, [string, LabEvent['tone']]> = {
  needs_reference: ['기준 등록 대기', 'neutral'],
  registering: ['8초 기준 등록 중', 'neutral'],
  warming: ['움직임 흐름을 다시 모으는 중', 'neutral'],
  near_reference: ['기준 근처', 'good'],
  deviation_pending: ['기준에서 벗어남 · 지속 확인', 'warning'],
  unexpected_motion_candidate: ['예상 밖 움직임 · 복귀 확인', 'warning'],
  persistent_deviation_candidate: ['지속 이탈 후보', 'warning'],
  recovery_pending: ['기준 복귀 · 유지 확인', 'neutral'],
  unmeasurable: ['측정 불가 · 연속 관측 중단', 'unknown'],
}

/** Aggregate the whole run independently of its bounded diagnostic trace.
 * Time is relative to run start. Only adjacent valid post-registration samples
 * contribute to valid/near time; a gap is never assigned to either posture.
 */
export class LabAccumulator {
  readings: ForecastReading[] = []
  events: LabEvent[] = []
  private summary = emptySummary()
  private previous: ForecastReading | null = null
  private errorTotal = 0
  private errorCount = 0
  private eventId = 0
  private inDeviation = false

  event(timeMs: number, label: string, tone: LabEvent['tone'] = 'neutral') {
    this.events = [...this.events, { id: ++this.eventId, timeMs, label, tone }].slice(-LAB_LIMITS.events)
  }

  add(reading: ForecastReading) {
    if (!Number.isFinite(reading.timeMs) || reading.timeMs < 0 ||
      (this.previous && reading.timeMs <= this.previous.timeMs)) return false
    const previous = this.previous
    if (reading.state === 'near_reference' || reading.state === 'unmeasurable' ||
      (previous && reading.timeMs - previous.timeMs > FORECAST_MAX_SAMPLE_GAP_MS)) this.inDeviation = false
    if (previous) {
      const dt = reading.timeMs - previous.timeMs
      if (dt > FORECAST_MAX_SAMPLE_GAP_MS || previous.state === 'unmeasurable' || reading.state === 'unmeasurable') {
        this.summary.unavailableMs += dt
      } else if (measured(previous) && measured(reading)) {
        this.summary.validMs += dt
        if (previous.state === 'near_reference' && reading.state === 'near_reference') this.summary.nearMs += dt
      }
    }
    if (measured(reading) && reading.error !== null && Number.isFinite(reading.error)) {
      this.errorTotal += reading.error; this.errorCount++
    }
    if (reading.state === 'persistent_deviation_candidate' && !this.inDeviation) {
      this.summary.deviations++; this.inDeviation = true
    }
    if (reading.state !== previous?.state) this.event(reading.timeMs, ...labels[reading.state])
    this.previous = reading
    this.readings = [...this.readings, reading].slice(-LAB_LIMITS.readings)
    return true
  }

  snapshot(elapsedMs: number): LabSummary {
    return { ...this.summary, elapsedMs: Math.max(0, elapsedMs),
      nearPercent: this.summary.validMs ? this.summary.nearMs / this.summary.validMs * 100 : null,
      meanError: this.errorCount ? this.errorTotal / this.errorCount : null }
  }
}

/** Deterministic, explicitly synthetic shapes; never substitutes for camera data. */
export function syntheticForecastValues(timeMs: number): number[] | null {
  const frame = syntheticGuideFrame(timeMs)
  if (!frame) return null
  const points = frame.points.map(point => ({ ...point, z: 0 }))
  const world = points.map(point => ({ ...point, y: point.y * frame.height / frame.width }))
  return liveForecastPoints(points, world)
}

export function exportLabRecord(record: LabRecord) {
  return {
    schema_version: 'developer-lab-export-v1',
    id: record.id, started_at: record.startedAt, source: record.source,
    predictor: record.predictor, model_id: record.modelId, model_sha256: record.modelSha256,
    domain_validated: false, baseline_normality: 'registration_assumption',
    approximate_point_mapping: record.source === 'camera' && record.predictor === 'lstm',
    settings: LAB_SETTINGS,
    guidance_settings: GUIDANCE_SETTINGS,
    time_basis: 'milliseconds_since_run_start',
    summary_definition: {
      elapsed: 'wall_time_including_connection_and_registration',
      valid: 'adjacent_measurable_postregistration_samples_without_gaps',
      near_percent: 'near_time_divided_by_valid_time_times_100_not_accuracy',
      mean_error: 'sample_mean_of_measurable_postregistration_prediction_errors',
      unavailable: 'quality_loss_and_observation_gaps_including_registration',
    },
    trace_limit: LAB_LIMITS.readings, event_limit: LAB_LIMITS.events,
    ...(record.alerts ? {
      alert_limit: ALERT_SETTINGS.history_limit,
      alert_count: record.alertCount ?? record.alerts.length,
      alert_settings: record.alertSettings ? { basis: record.alertSettings.basis, reminder_ms: record.alertSettings.reminderMs } : null,
      alerts: record.alerts.slice(-ALERT_SETTINGS.history_limit).map(({ id, timeMs, basis, kind, deviation, peakDeviation, durationMs, error, errorLimit, source }) =>
        ({ id, timeMs, basis, kind, deviation, peakDeviation, durationMs, error, errorLimit, source })),
    } : {}),
    summary: { ...record.summary },
    events: record.events.map(({ id, timeMs, label, tone }) => ({ id, timeMs, label, tone })),
    readings: record.readings.map(r => ({
      schema_version: r.schema_version, timeMs: r.timeMs, state: r.state, ruleState: r.ruleState,
      deviation: r.deviation, error: r.error, errorLimit: r.errorLimit, durationMs: r.durationMs,
      progress: r.progress, returnedExcursions: r.returnedExcursions, modelId: r.modelId,
      domainValidated: false,
    })),
  }
}
