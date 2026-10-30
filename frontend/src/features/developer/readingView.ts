import { FORECAST_MAX_SAMPLE_GAP_MS, type ForecastReading } from '../../../../model/prototype/forecast'
import type { LabAlertBasis } from './types'

export function selectedLabState(reading: ForecastReading, basis: LabAlertBasis) {
  const blocked = ['needs_reference', 'registering', 'unmeasurable'].includes(reading.state) ||
    (reading.state === 'warming' && reading.evaluationMode !== 'observed-v2')
  return blocked ? reading.state : basis === 'rule' ? reading.ruleState : reading.state
}

export const readingGapLimit = (reading: ForecastReading) =>
  reading.evaluationMode === 'observed-v2' ? 250 : FORECAST_MAX_SAMPLE_GAP_MS

export const selectedDurationMs = (reading: ForecastReading, basis: LabAlertBasis) =>
  basis === 'rule' ? reading.ruleDurationMs ?? reading.durationMs : reading.durationMs

export const selectedReturnedExcursions = (reading: ForecastReading, basis: LabAlertBasis) =>
  basis === 'rule' ? reading.ruleReturnedExcursions ?? null : reading.returnedExcursions

/** Missing ratios belong to historical sessions whose entry boundary was 1. */
export const postureEntryRatio = (reading: ForecastReading | null | undefined) => reading?.postureEntryRatio ?? 1
export const postureRecoveryRatio = (reading: ForecastReading | null | undefined) => reading?.postureRecoveryRatio ?? 2 / 3
