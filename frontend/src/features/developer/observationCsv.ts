import type { ComparisonGeometry, ComparisonValues } from '../../../../model/prototype/observationComparison'
import { COMPARISON_ACTIONS, type ComparisonAction } from './comparisonDemo'
import { OBSERVATION_PROTOCOL, type GuideSnapshot } from './observationProtocol'

export type ComparisonCapture = { values: ComparisonValues; elapsedMs: number; windowStartMs: number; windowEndMs: number; sampleCount: number; segment: number }
export type ComparisonTrace = {
  elapsedMs: number; observationTimeMs: number | null; action: ComparisonAction; segment: number
  event: 'observation' | 'interrupted' | 'hidden' | 'stopped' | 'protocol_phase_started' | 'protocol_phase_completed' | 'protocol_paused' | 'protocol_cancelled' | 'protocol_completed'
  status: 'measured' | 'depth_unavailable' | 'unmeasurable'
  imageValid: boolean; worldValid: boolean; values: ComparisonValues | null; zMeters: number | null
  guidance?: GuideSnapshot | null
}
export type ComparisonExportContext = { runId: string; startedAt: string; source: 'camera' | 'synthetic'; reference: ComparisonGeometry | null; dropped: number }
export const COMPARISON_TRACE_LIMIT = 12000
type Cell = string | number | boolean | null
const escape = (value: Cell) => {
  if (value === null || typeof value === 'number' && !Number.isFinite(value)) return ''
  if (typeof value !== 'string') return String(value)
  const safe = /^[=+\-@\t\r]/.test(value) ? "'" + value : value
  return '"' + safe.replaceAll('"', '""') + '"'
}
const csv = (columns: string[], rows: Cell[][]) => '\uFEFF' + columns.join(',') + '\r\n' + rows.map(r => r.map(escape).join(',')).join('\r\n') + '\r\n'
const metadataColumns = ['schema_version','run_id','started_at_utc','source','label_kind','reference_context','reference_image_shoulder_width_frame_width','reference_world_shoulder_width_estimated_m','reference_relative_z_estimated_m','trace_rows_dropped']
const metadata = (context: ComparisonExportContext, guided = false): Cell[] => ['observation-comparison-csv-v2',context.runId,context.startedAt,context.source,guided ? 'guided_task_not_ground_truth' : 'user_selected_not_ground_truth',context.reference?.context ?? null,context.reference?.image?.shoulderWidth ?? null,context.reference?.world?.shoulderWidth ?? null,context.reference?.world?.relativeZ ?? null,context.dropped]
const valueColumns = ['head_gap_delta_pct_ref_image_shoulder_width','eye_mouth_gap_delta_pct_ref_image_shoulder_width','shoulder_lift_pct_ref_image_shoulder_width','shoulder_width_change_pct','relative_z_delta_pct_ref_world_shoulder_width','relative_z_estimated_m']
const values = (v: ComparisonValues | null): Cell[] => [v?.headGap ?? null,v?.faceHeight ?? null,v?.shoulderLift ?? null,v?.shoulderScale ?? null,v?.relativeZ ?? null,v?.zMeters ?? null]
const title = (action: ComparisonAction) => COMPARISON_ACTIONS.find(a => a.id === action)!.title
const guidanceColumns = ['protocol_id','protocol_run_id','protocol_state','protocol_round','protocol_trial','protocol_task_action','protocol_phase','protocol_phase_index','protocol_phase_attempt','protocol_phase_elapsed_ms','protocol_phase_duration_ms','protocol_pause_reason']
const guidanceCells = (guide?: GuideSnapshot | null): Cell[] => guide?.step ? [OBSERVATION_PROTOCOL.id,guide.runId,guide.status,guide.step.round,guide.step.trial,guide.step.action,guide.step.phase,guide.stepIndex + 1,guide.attempt,guide.elapsedMs,guide.step.durationMs,guide.pauseReason] : guidanceColumns.map(() => null)

export function comparisonSummaryCsv(captures: Partial<Record<ComparisonAction, ComparisonCapture>>, context: ComparisonExportContext) {
  return csv([...metadataColumns,'action','action_label','segment_id','captured_elapsed_ms','window_start_observation_ms','window_end_observation_ms','sample_count',...valueColumns], COMPARISON_ACTIONS.flatMap(({id}) => {
    const capture = captures[id]
    return capture ? [[...metadata(context),id,title(id),capture.segment,capture.elapsedMs,capture.windowStartMs,capture.windowEndMs,capture.sampleCount,...values(capture.values)]] : []
  }))
}
export function comparisonTraceCsv(trace: ComparisonTrace[], context: ComparisonExportContext) {
  return csv([...metadataColumns,'action','action_label','segment_id','elapsed_ms','observation_time_ms','event','status','image_valid','world_valid',...valueColumns,...guidanceColumns], trace.map(row => [
    ...metadata(context,!!row.guidance?.step),row.action,title(row.action),row.segment,row.elapsedMs,row.observationTimeMs,row.event,row.status,row.imageValid,row.worldValid,...values(row.values).slice(0,5),row.zMeters,...guidanceCells(row.guidance),
  ]))
}
export function downloadComparisonCsv(kind: 'summary' | 'trace', content: string, source: ComparisonExportContext['source']) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = `posture-observation-${source}-${kind}-${Date.now()}.csv`
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
