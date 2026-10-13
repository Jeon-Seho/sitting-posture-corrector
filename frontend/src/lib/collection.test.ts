import { describe, expect, it } from 'vitest'
import {
  appendObservation,
  CSV_COLUMNS,
  finishCapture,
  MAX_ROWS,
  newCapture,
  reviewCapture,
  SCHEMA_VERSION,
  toCsv,
} from './collection'
import { captureWindow, DEFAULT_CAPTURE_OPTIONS, TASKS } from './collectionProtocol'
import { inferenceInterval, smoothPoints } from './skeleton'
import type { Observation } from '../hooks/useCamera'
const baseline = { headGap: 0.5, offset: 0, tilt: 0, quality: 0.95 }
const capture = () =>
  newCapture('P01', 1000, 'synthetic-capture', '2026-09-19T00:00:00Z')
const frame = (time: number, missing = false): Observation => ({
  timeMs: time,
  videoTimeMs: time,
  landmarks: [],
  worldLandmarks: [],
  features: missing ? null : { ...baseline, headGap: 0.1 },
  inferenceMs: 12,
  delegate: 'GPU',
  width: 640,
  height: 480,
})

describe('pilot collection', () => {
  it('samples real unique observations at most 10Hz, rejecting old timestamps', () => {
    const c = capture()
    for (let time = 1000; time <= 2000; time += 20) appendObservation(c, frame(time), 'upright')
    expect(c.rows).toHaveLength(11)
    expect(appendObservation(c, frame(1000), 'upright')).toBe(false)
    expect(appendObservation(c, { ...frame(2200), videoTimeMs: 2000 }, 'upright')).toBe(false)
    expect(appendObservation(c, frame(NaN), 'upright')).toBe(false)
  })
  it('writes no judgement or rule-feature columns (ADR 0021)', () => {
    for (const column of [
      'rule_score',
      'rule_prediction',
      'measurement_quality',
      'head_gap',
      'lateral_offset',
      'shoulder_tilt',
      'delta_head_gap',
      'baseline_head_gap',
      'threshold',
      'feature_version',
    ])
      expect(CSV_COLUMNS).not.toContain(column)
    const c = capture()
    appendObservation(c, frame(1000), 'upright')
    expect(c.rows[0].schema_version).toBe('posture-pilot-v3')
    expect(SCHEMA_VERSION).toBe('posture-pilot-v3')
  })
  it('keeps the self-reported label separate and only after review', () => {
    const c = capture()
    appendObservation(c, frame(1000), 'upright')
    expect(c.rows[0]).toMatchObject({
      manual_label: 'unlabeled',
      label_source: 'none',
      review_status: 'pending',
      pose_training_eligible: 0,
    })
    finishCapture(c, 'completed')
    reviewCapture(c, true, 'upright', 'seated')
    expect(c.rows[0]).toMatchObject({
      manual_label: 'upright',
      label_source: 'self_report_reviewed',
      pose_training_eligible: 1,
    })
  })
  it('starts a new segment on a label change or a time gap, not on visibility', () => {
    const c = capture()
    appendObservation(c, frame(1000), 'upright')
    appendObservation(c, frame(1100, true), 'upright')
    appendObservation(c, frame(1200), 'upright')
    appendObservation(c, frame(1300), 'transition')
    appendObservation(c, frame(3000), 'transition')
    expect(c.rows.map((row) => row.segment_id)).toEqual([1, 1, 1, 2, 3])
    expect(c.rows[4].gap_ms).toBe(1700)
  })
  it('limits memory without overwriting prior rows', () => {
    const c = newCapture('P02', 0, 'synthetic', 'test')
    for (let i = 0; i <= MAX_ROWS; i++) appendObservation(c, frame(i * 100), 'unlabeled')
    expect(c.rows).toHaveLength(MAX_ROWS)
    expect(c.rows[0]).toMatchObject({ sample_index: 0, label_source: 'none' })
  })
  it('exports BOM/header and blank missing values; requires a participant code', () => {
    expect(() => newCapture('=bad', 0, '', '')).toThrow()
    const c = capture()
    appendObservation(c, frame(1000, true), 'unlabeled')
    const csv = toCsv(c.rows)
    expect(csv.startsWith('\uFEFF' + CSV_COLUMNS.join(','))).toBe(true)
    expect(csv).not.toMatch(/NaN|undefined/)
    expect(csv.split('\r\n')[1]).toContain(',,')
  })
  it('keeps only face and shoulders in raw and world exports even with poor quality', () => {
    const c = capture()
    const points = Array.from({ length: 33 }, (_, i) => ({
      x: i / 33,
      y: 0.4,
      z: -0.2,
      visibility: 0.1,
    }))
    appendObservation(
      c,
      {
        ...frame(1000, true),
        landmarks: points,
        worldLandmarks: points.map((p) => ({ ...p, x: p.x * 2 })),
      },
      'unlabeled',
    )
    points[0].x = 999
    const row = c.rows[0]
    expect(row).toMatchObject({
      schema_version: 'posture-pilot-v3',
      pose_detected: 1,
      landmark_count: 13,
      pose_training_eligible: 0,
    })
    expect(JSON.parse(String(row.landmarks_json))).toHaveLength(13)
    expect(JSON.parse(String(row.world_landmarks_json))).toHaveLength(13)
    expect(JSON.parse(String(row.landmarks_json)).map((p: { index: number }) => p.index)).toEqual(
      Array.from({ length: 13 }, (_, i) => i),
    )
    expect(JSON.parse(String(row.landmarks_json))[0]).toMatchObject({
      index: 0,
      x: 0,
      visibility: 0.1,
    })
    expect(JSON.parse(String(row.world_landmarks_json))[1].x).toBeCloseTo(2 / 33)
    expect(row.pose_model).toContain('heavy')
    expect(row.calibration_seconds).toBe(3)
    expect(toCsv(c.rows)).toContain('""visibility""')
  })
  it('does not infer absence from a missing pose and can confirm absence without inventing features', () => {
    const c = newCapture('P01', 1000, 'synthetic', 'test', {
      ...DEFAULT_CAPTURE_OPTIONS,
      taskId: 'away',
    })
    appendObservation(c, frame(1000, true), 'unlabeled')
    expect(c.rows[0]).toMatchObject({
      requested_presence: 'away',
      presence_label: 'unknown',
      pose_detected: 0,
    })
    finishCapture(c, 'completed')
    expect(() => reviewCapture(c, true, 'upright', 'away')).toThrow()
    reviewCapture(c, true, 'unlabeled', 'away')
    expect(c.rows[0]).toMatchObject({
      presence_label: 'away',
      manual_label: 'unlabeled',
      pose_training_eligible: 0,
    })
  })
  it('does not turn activity instructions into posture truth and excludes interrupted/rejected clips', () => {
    const c = newCapture('P01', 1000, 'synthetic', 'test', {
      ...DEFAULT_CAPTURE_OPTIONS,
      taskId: 'notebook_read',
    })
    appendObservation(c, frame(1000), 'unlabeled')
    finishCapture(c, 'completed')
    reviewCapture(c, true, 'unlabeled', 'seated')
    expect(c.rows[0]).toMatchObject({
      activity: 'notebook_read',
      requested_head_direction: 'down',
      pose_training_eligible: 0,
    })
    const interrupted = capture()
    appendObservation(interrupted, frame(1000), 'upright')
    finishCapture(interrupted, 'tab_hidden')
    expect(() => reviewCapture(interrupted, true, 'upright', 'seated')).toThrow()
    reviewCapture(interrupted, false, 'upright', 'seated')
    expect(interrupted.rows[0]).toMatchObject({
      review_status: 'excluded',
      pose_training_eligible: 0,
      stop_reason: 'tab_hidden',
    })
    expect(appendObservation(interrupted, frame(1200), 'upright')).toBe(false)
  })
  it('separates preparation and recording with a half-open time window', () => {
    expect(captureWindow(5000, 20, 4999)).toBe('countdown')
    expect(captureWindow(5000, 20, 5000)).toBe('recording')
    expect(captureWindow(5000, 20, 24999)).toBe('recording')
    expect(captureWindow(5000, 20, 25000)).toBe('review')
    expect(captureWindow(5000, 20, 90000)).toBe('review')
  })
  it('validates capture metadata and has unique scenario ids', () => {
    expect(new Set(TASKS.map((t) => t.id)).size).toBe(TASKS.length)
    for (const patch of [
      { distanceCm: NaN },
      { durationSeconds: 0 },
      { taskId: 'bad' },
      { repetition: -1 },
    ]) {
      expect(() =>
        newCapture('P01', 0, 'test', 'test', {
          ...DEFAULT_CAPTURE_OPTIONS,
          ...patch,
        }),
      ).toThrow()
    }
    const opts = { ...DEFAULT_CAPTURE_OPTIONS }
    const c = newCapture('P01', 0, 'test', 'test', opts)
    opts.cameraView = 'right'
    expect(c.options.cameraView).toBe('front')
  })
})
describe('display-only smoothing and scheduling', () => {
  it('is time based, does not mutate inference data and clears on missing points', () => {
    const a = [{ x: 0, y: 0, z: 0, visibility: 0.95 }]
    const b = [{ x: 1, y: 1, z: 1, visibility: 0.95 }]
    const once = smoothPoints(a, b, 32)
    const twice = smoothPoints(smoothPoints(a, b, 16), b, 16)
    expect(once[0].x).toBeCloseTo(twice[0].x)
    expect(once[0].x).toBeGreaterThan(0)
    expect(once[0].x).toBeLessThan(1)
    expect(a[0].x).toBe(0)
    expect(b[0].x).toBe(1)
    expect(smoothPoints(a, [], 16)).toEqual([])
    expect(smoothPoints([], b, 16)).toEqual(b)
  })
  it('increases update rate within an inference budget', () => {
    expect(inferenceInterval('GPU', 5)).toBeCloseTo(1000 / 30)
    expect(inferenceInterval('CPU', 5)).toBe(50)
    expect(inferenceInterval('GPU', 60)).toBe(120)
  })
})
