import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES } from '../../data/posture'
import { BASELINE, BASELINE_ID, SESSION_ID } from './server/testFixtures'
import { KafkaFeatureRecorder } from './kafkaExport'

function recorder() {
  return new KafkaFeatureRecorder({
    sessionId: SESSION_ID,
    userId: 'local',
    baselineId: BASELINE_ID,
    baseline: BASELINE,
    rules: DEFAULT_RULES,
    width: 640,
    height: 480,
    origin: 1000,
    startedAt: '2026-10-06T10:00:00.000Z',
  })
}

function lines(text: string) {
  return text.trim().split('\n').map((line) => JSON.parse(line))
}

describe('Kafka-format export of a local measurement (synthetic frames)', () => {
  it('turns adjacent real frames into ordered input v2 intervals', () => {
    const r = recorder()
    r.push(1000, BASELINE)
    r.push(1100, { ...BASELINE, headGap: BASELINE.headGap - 0.1 })
    r.push(1200, BASELINE)
    expect(r.count).toBe(2)
    const out = lines(r.toText())
    expect(out.map((line) => line.kind)).toEqual(['session_started', 'features', 'features', 'session_ended'])
    expect(out[0].body).toEqual({
      policy: { hold_ms: 3000, recovery_ms: 3000, reminder_ms: 60000, threshold: 0.7 },
      baseline_id: BASELINE_ID,
      frame: { width: 640, height: 480 },
    })
    expect(out[1].body).toMatchObject({
      schema_version: '2.0',
      baseline_id: BASELINE_ID,
      sequence: 0,
      start_ms: 0,
      end_ms: 100,
      phase: 'running',
      measurement_quality: 'good',
    })
    expect(out[1].body.features.head_gap_delta).toBeCloseTo(-0.1)
    expect(out[2].body).toMatchObject({ sequence: 1, start_ms: 100, end_ms: 200 })
    expect(out.at(-1).body).toEqual({ end_ms: 200 })
    expect(new Set(out.map((line) => line.session_id))).toEqual(new Set([SESSION_ID]))
    expect(out.every((line) => line.schema_version === '1.0' && line.user_id === 'local')).toBe(true)
    expect(new Set(out.map((line) => line.message_id)).size).toBe(out.length)
  })

  it('keeps gaps over one second and paused time out of the record', () => {
    const r = recorder()
    r.push(1000, BASELINE)
    r.push(2500, BASELINE)
    expect(r.count).toBe(0)
    r.push(2600, BASELINE)
    r.pause()
    r.push(9000, BASELINE)
    r.push(9100, BASELINE)
    const features = lines(r.toText()).filter((line) => line.kind === 'features')
    expect(features.map((line) => [line.body.start_ms, line.body.end_ms])).toEqual([
      [1500, 1600],
      [8000, 8100],
    ])
  })

  it('records an interval with a poor endpoint as unmeasured instead of inventing a posture', () => {
    const r = recorder()
    r.push(1000, null)
    r.push(1100, BASELINE)
    r.push(1200, BASELINE)
    const features = lines(r.toText()).filter((line) => line.kind === 'features')
    expect(features[0].body).toMatchObject({ measurement_quality: 'poor', features: null })
    expect(features[1].body.measurement_quality).toBe('good')
  })

  it('ignores frames that do not move forward in time', () => {
    const r = recorder()
    r.push(1000, BASELINE)
    r.push(1000, BASELINE)
    r.push(900, BASELINE)
    r.push(Number.NaN, BASELINE)
    expect(r.count).toBe(0)
  })
})
