import type { Landmark } from '../../../model/prototype/pose'
import { CALIBRATION_MS } from '../../../model/prototype/calibration'
import type { Observation } from '../hooks/useCamera'
import { SHOULDER_UP_LANDMARK_COUNT } from '../features/camera/types'
import modelAsset from '../../model-asset.json'
import {
  DEFAULT_CAPTURE_OPTIONS,
  POSTURES,
  taskFor,
  validateOptions,
  type CaptureOptions,
  type Label,
  type Presence,
} from './collectionProtocol'

export const LABELS = POSTURES
export type { Label } from './collectionProtocol'
export const MAX_ROWS = 18000
/**
 * posture-pilot-v3 (2026-10-12): time, raw landmarks and the capture protocol only. The app
 * writes no judgement (score, prediction, measurable or not) and no rule features (ADR 0021);
 * the server and ML derive those from the landmarks. Self-report columns (manual_label,
 * presence_label, review_status) are what the participant confirmed, not a rule output.
 */
export const SCHEMA_VERSION = 'posture-pilot-v3'
export const CSV_COLUMNS = [
  'schema_version',
  'participant_code',
  'capture_id',
  'started_at',
  'sample_index',
  'elapsed_ms',
  'video_time_ms',
  'gap_ms',
  'segment_id',
  'manual_label',
  'label_source',
  'inference_ms',
  'delegate',
  'width',
  'height',
  'pose_model',
  'calibration_seconds',
  'target_sample_hz',
  'task_id',
  'activity',
  'requested_head_direction',
  'requested_posture',
  'requested_presence',
  'presence_label',
  'review_status',
  'pose_training_eligible',
  'repetition',
  'planned_seconds',
  'camera_view',
  'camera_height',
  'distance_cm',
  'desk_layout',
  'stop_reason',
  'calibration_id',
  'pose_detected',
  'landmark_count',
  'landmarks_json',
  'world_landmarks_json',
] as const
export type CsvRow = Record<(typeof CSV_COLUMNS)[number], string | number | null>
export type Capture = {
  participant: string
  id: string
  startedAt: string
  startMs: number
  rows: CsvRow[]
  segment: number
  lastSeen: number
  lastWritten: number
  lastVideo: number
  label: Label
  options: CaptureOptions
  calibrationId: string
  review: 'pending' | 'accepted' | 'excluded'
  stopReason: string
}

export function newCapture(
  participant: string,
  timeMs: number,
  id: string,
  startedAt: string,
  options: CaptureOptions = DEFAULT_CAPTURE_OPTIONS,
  calibrationId = 'unknown',
): Capture {
  if (!/^P\d{2,4}$/.test(participant)) throw new Error('참여자 코드는 P01처럼 입력하세요.')
  validateOptions(options)
  return {
    participant,
    id,
    startedAt,
    startMs: timeMs,
    rows: [],
    segment: 0,
    lastSeen: -Infinity,
    lastWritten: -Infinity,
    lastVideo: -Infinity,
    label: 'unlabeled',
    options: { ...options },
    calibrationId,
    review: 'pending',
    stopReason: '',
  }
}

/** Inference output only; do not smooth, impute or drop low-visibility landmarks. */
function landmarkJson(points: Landmark[]) {
  const finite = (n: number | undefined) => (n !== undefined && Number.isFinite(n) ? n : null)
  return JSON.stringify(
    points.slice(0, SHOULDER_UP_LANDMARK_COUNT).map((p, index) => ({
      index,
      x: finite(p.x),
      y: finite(p.y),
      z: finite(p.z),
      visibility: finite(p.visibility),
    })),
  )
}

export function finishCapture(c: Capture, reason: string) {
  c.stopReason = reason
  for (const row of c.rows) row.stop_reason = reason
}

/** Confirmation is self-report, never a rule-derived or expert-validated ground truth. */
export function reviewCapture(c: Capture, accepted: boolean, label: Label, presence: Presence) {
  if (!c.stopReason || (accepted && (c.stopReason !== 'completed' || !c.rows.length))) {
    throw new Error('완료된 촬영만 확인할 수 있습니다. 중단된 촬영은 제외하고 다시 촬영하세요.')
  }
  if (accepted && presence !== 'seated' && label !== 'unlabeled' && label !== 'transition') {
    throw new Error('자리 비움·복귀 구간에는 앉은 자세 정답을 붙일 수 없습니다.')
  }
  c.review = accepted ? 'accepted' : 'excluded'
  for (const row of c.rows) {
    row.review_status = c.review
    row.manual_label = accepted ? label : 'unlabeled'
    row.presence_label = accepted ? presence : 'unknown'
    row.label_source = accepted ? 'self_report_reviewed' : 'none'
    // Whether a frame is measurable is decided later from the landmarks, not here.
    row.pose_training_eligible =
      accepted && presence === 'seated' && label !== 'unlabeled' && label !== 'transition' ? 1 : 0
  }
}

/** One row at most per 100ms, from actual observations only. No interpolation or duplicate frames. */
export function appendObservation(c: Capture, o: Observation, label: Label): boolean {
  if (
    c.stopReason ||
    c.rows.length >= MAX_ROWS ||
    !Number.isFinite(o.timeMs) ||
    !Number.isFinite(o.videoTimeMs) ||
    o.timeMs < c.startMs ||
    o.timeMs <= c.lastSeen ||
    o.videoTimeMs <= c.lastVideo
  )
    return false
  if (label !== c.label || o.timeMs - c.lastSeen > 1000) c.segment++
  c.label = label
  c.lastSeen = o.timeMs
  c.lastVideo = o.videoTimeMs
  if (o.timeMs - c.lastWritten < 100) return false
  const gap = Number.isFinite(c.lastWritten) ? o.timeMs - c.lastWritten : null
  c.lastWritten = o.timeMs
  const task = taskFor(c.options.taskId)!
  c.rows.push({
    schema_version: SCHEMA_VERSION,
    participant_code: c.participant,
    capture_id: c.id,
    started_at: c.startedAt,
    sample_index: c.rows.length,
    elapsed_ms: o.timeMs - c.startMs,
    video_time_ms: o.videoTimeMs,
    gap_ms: gap,
    segment_id: c.segment,
    manual_label: 'unlabeled',
    label_source: 'none',
    inference_ms: o.inferenceMs,
    delegate: o.delegate,
    width: o.width,
    height: o.height,
    pose_model: modelAsset.modelId,
    calibration_seconds: CALIBRATION_MS / 1000,
    target_sample_hz: 10,
    task_id: task.id,
    activity: task.activity,
    requested_head_direction: task.head,
    requested_posture: task.posture,
    requested_presence: task.presence,
    presence_label: 'unknown',
    review_status: 'pending',
    pose_training_eligible: 0,
    repetition: c.options.repetition,
    planned_seconds: c.options.durationSeconds,
    camera_view: c.options.cameraView,
    camera_height: c.options.cameraHeight,
    distance_cm: c.options.distanceCm,
    desk_layout: c.options.layout,
    stop_reason: '',
    calibration_id: c.calibrationId,
    pose_detected: o.landmarks.length > 0 ? 1 : 0,
    landmark_count: Math.min(o.landmarks.length, SHOULDER_UP_LANDMARK_COUNT),
    landmarks_json: landmarkJson(o.landmarks),
    world_landmarks_json: landmarkJson(o.worldLandmarks),
  })
  return true
}

export function toCsv(rows: CsvRow[]): string {
  const escape = (v: string | number | null) => {
    if (v === null || (typeof v === 'number' && !Number.isFinite(v))) return ''
    const text = typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : v
    return '"' + text.replaceAll('"', '""') + '"'
  }
  return (
    '\uFEFF' +
    CSV_COLUMNS.join(',') +
    '\r\n' +
    rows.map((row) => CSV_COLUMNS.map((key) => escape(row[key])).join(',')).join('\r\n') +
    '\r\n'
  )
}
