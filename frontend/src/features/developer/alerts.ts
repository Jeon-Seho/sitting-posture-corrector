import { FORECAST_MAX_SAMPLE_GAP_MS, FORECAST_OBSERVATION_MAX_GAP_MS, type ForecastReading } from '../../../../model/prototype/forecast'
import type { LabAlert, LabAlertBasis, LabSource } from './types'
import { selectedDurationMs } from './readingView'

export const ALERT_SETTINGS = { reminder_ms: 60_000, history_limit: 100 } as const
const unavailableStates = new Set(['needs_reference', 'registering', 'unmeasurable'])

/** Delivery policy only: the forecast core decides whether posture persists.
 * Recovery bounces stay in the same incident; lost observation never means recovery.
 */
export class DeveloperAlertTracker {
  alerts: LabAlert[] = []
  count = 0
  peakDeviation: number | null = null
  private peakPostureScore: number | null = null
  private previousTime: number | null = null
  private lastAlertTime: number | null = null
  constructor(readonly basis: LabAlertBasis, readonly source: LabSource) {}

  observe(reading: ForecastReading): LabAlert | null {
    const time = reading.timeMs
    if (!Number.isFinite(time) || time < 0 || (this.previousTime !== null && time <= this.previousTime)) return null
    const gapLimit = reading.evaluationMode === 'observed-v2' ? FORECAST_OBSERVATION_MAX_GAP_MS : FORECAST_MAX_SAMPLE_GAP_MS
    const gap = this.previousTime !== null && time - this.previousTime > gapLimit
    this.previousTime = time
    const state = this.basis === 'rule' ? reading.ruleState : reading.state
    // Raw observation validity gates both modes; predictor readiness gates only the selected predictor.
    if (gap || unavailableStates.has(reading.state) || unavailableStates.has(state)) {
      this.resetIncident()
      return null
    }
    // A missing prediction match can produce warming without losing observed
    // continuity. Suppress delivery but retain an already latched core incident.
    if (state === 'warming' || (reading.state === 'warming' && reading.evaluationMode !== 'observed-v2')) {
      if (!['persistent_deviation_candidate', 'recovery_pending'].includes(reading.ruleState)) this.resetIncident()
      else if (reading.deviation !== null && Number.isFinite(reading.deviation) && reading.deviation >= 0)
        this.peakDeviation = Math.max(this.peakDeviation ?? 0, reading.deviation)
      return null
    }
    if (state === 'near_reference') { this.resetIncident(); return null }
    if (reading.deviation === null || !Number.isFinite(reading.deviation) || reading.deviation < 0) {
      this.resetIncident(); return null
    }
    this.peakDeviation = Math.max(this.peakDeviation ?? 0, reading.deviation)
    if (reading.postureScore != null && Number.isFinite(reading.postureScore)) this.peakPostureScore = Math.max(this.peakPostureScore ?? 0, reading.postureScore)
    const durationMs = selectedDurationMs(reading, this.basis)
    if (state !== 'persistent_deviation_candidate' || !Number.isFinite(durationMs) || durationMs < 0) return null
    if (this.lastAlertTime !== null && time - this.lastAlertTime < ALERT_SETTINGS.reminder_ms) return null
    const alert: LabAlert = {
      id: ++this.count, timeMs: time, basis: this.basis, source: this.source,
      kind: this.lastAlertTime === null ? 'first' : 'reminder',
      deviation: reading.deviation, peakDeviation: this.peakDeviation, durationMs,
      error: reading.error !== null && Number.isFinite(reading.error) ? reading.error : null,
      errorLimit: reading.errorLimit !== null && Number.isFinite(reading.errorLimit) ? reading.errorLimit : null,
      ...(reading.normalProfileId ? { normalScore: reading.normalScore ?? null, normalProfileId: reading.normalProfileId } : {}),
      ...(reading.imagePosture ? { postureScore: reading.postureScore ?? null, imagePosture: { ...reading.imagePosture },
        ...(reading.postureEntryRatio !== undefined ? { postureEntryRatio: reading.postureEntryRatio, postureRecoveryRatio: reading.postureRecoveryRatio } : {}),
        ...(this.peakPostureScore != null ? { peakPostureScore: this.peakPostureScore } : {}) } : {}),
    }
    this.lastAlertTime = time
    this.alerts = [...this.alerts, alert].slice(-ALERT_SETTINGS.history_limit)
    return alert
  }

  private resetIncident() { this.lastAlertTime = null; this.peakDeviation = null; this.peakPostureScore = null }
}
