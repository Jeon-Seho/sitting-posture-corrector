import { describe, expect, it } from 'vitest'
import {
  compareFirstAndRecent,
  comparisonConditions,
  comparisonRecordGroups,
  comparisonWarnings,
  periodStats,
  recordedRules,
} from './comparison'
import type { RecordItem } from './serviceStore'
import { DEFAULT_RULES } from '../data/posture'
import { BASELINE_ID, view } from '../features/session/server/testFixtures'

// 합성 기록만 사용한다. 날짜는 현지 시간 기준.
const NOW = new Date(2026, 8, 28, 12)
const event = (id: number, startAt: number, recoverySec: number | null, alerts = 1) => ({
  id,
  type: 'forwardHead' as const,
  startAt,
  confirmedAt: startAt + 3,
  endAt: startAt + 30,
  durationSec: 30,
  alerts,
  firstAlertAt: startAt + 3,
  recovered: recoverySec !== null,
  recoverySec,
  endedBySession: false,
  endReason: null,
  blockId: 0,
})

describe('saved comparison conditions', () => {
  function serverRecord(id: string, day: number): RecordItem {
    return {
      ...record(id, 8, day, 3600, 3000),
      rules: { ...DEFAULT_RULES },
      server: {
        baselineId: BASELINE_ID,
        modelVersion: 'reference-feature-rule-v1',
        confirmed: true,
        view: view({ ended: true }),
      },
    }
  }

  it('uses only the first and recent windows for condition warnings, preserving all metrics', () => {
    const early = serverRecord('early', 1)
    const recent = serverRecord('recent', 27)
    const middle = { ...record('middle-demo', 8, 15, 9999, 0), mode: 'demo' as const }
    const records = [early, middle, recent]
    const result = compareFirstAndRecent(records, NOW)
    if (result.status !== 'ready') throw new Error('Synthetic comparison must be ready')
    const groups = comparisonRecordGroups(records, result)
    expect(groups.early.map((r) => r.id)).toEqual(['early'])
    expect(groups.recent.map((r) => r.id)).toEqual(['recent'])
    expect(comparisonWarnings(comparisonConditions([...groups.early, ...groups.recent]))).toEqual(
      [],
    )
    expect(result).toEqual(compareFirstAndRecent([early, recent], NOW))
  })

  it('detects each saved setting independently, including recovery time and exact threshold', () => {
    for (const changed of [
      { holdSeconds: DEFAULT_RULES.holdSeconds + 1 },
      { recoverSeconds: DEFAULT_RULES.recoverSeconds + 1 },
      { realertSeconds: DEFAULT_RULES.realertSeconds + 1 },
      { threshold: DEFAULT_RULES.threshold + 0.001 },
    ]) {
      const early = serverRecord('early', 1)
      const recent = { ...serverRecord('recent', 27), rules: { ...DEFAULT_RULES, ...changed } }
      const conditions = comparisonConditions([early, recent])
      expect(conditions.settings).toHaveLength(2)
      expect(
        comparisonWarnings(conditions).some((warning) => warning.includes('적용 설정이 다릅니다')),
      ).toBe(true)
    }
  })

  it('reads the actual server policy when saved rules are absent and converts milliseconds once', () => {
    const legacy = serverRecord('server-policy', 1)
    delete legacy.rules
    legacy.server!.view!.policy = {
      hold_ms: 1250,
      recovery_ms: 2250,
      reminder_ms: 4500,
      threshold: 0.731,
    }
    expect(recordedRules(legacy)).toEqual({
      holdSeconds: 1.25,
      recoverSeconds: 2.25,
      realertSeconds: 4.5,
      threshold: 0.731,
    })
    const matching = { ...serverRecord('same-rules', 27), rules: recordedRules(legacy)! }
    expect(comparisonConditions([legacy, matching]).settings).toEqual([
      { rules: matching.rules, sessions: 2 },
    ])
  })

  it('discloses source differences and absent local metadata without inventing model or baseline IDs', () => {
    const local = record('local', 8, 1, 3600, 3000)
    const demo = { ...record('demo', 8, 2, 3600, 3000), mode: 'demo' as const }
    const server = serverRecord('server', 27)
    const conditions = comparisonConditions([local, demo, server])
    expect(conditions.sources.map((item) => item.source)).toEqual([
      'camera-local',
      'demo',
      'camera-server',
    ])
    expect(conditions.baselineIds).toEqual([BASELINE_ID])
    expect(conditions.missingBaselineIds).toBe(1)
    expect(conditions.missingModelVersions).toBe(2)
    expect(conditions.missingSettings).toBe(2)
    expect(comparisonWarnings(conditions).join(' ')).toContain(
      '같은 기준으로 측정했는지 확인할 수 없습니다',
    )
    expect(recordedRules(local)).toBeNull()
  })

  it('discloses different known baselines and model versions without mutating the saved records', () => {
    const early = serverRecord('early', 1)
    const recent = serverRecord('recent', 27)
    recent.server!.baselineId = '33333333-3333-4333-8333-333333333333'
    recent.server!.modelVersion = 'synthetic-other-model-v2'
    const before = structuredClone([early, recent])
    const conditions = comparisonConditions([early, recent])
    expect(conditions.baselineIds).toHaveLength(2)
    expect(conditions.modelVersions).toHaveLength(2)
    expect(comparisonWarnings(conditions).join(' ')).toContain('모델 버전이 서로 다릅니다')
    expect(comparisonWarnings(conditions).join(' ')).toContain('개인 기준 ID가 서로 다릅니다')
    conditions.settings[0].rules.holdSeconds = 999
    expect([early, recent]).toEqual(before)
  })

  it('keeps an unconfirmed server record and distinguishes absent response from absent inference', () => {
    const unconfirmed = serverRecord('unconfirmed', 1)
    unconfirmed.server!.confirmed = false
    unconfirmed.server!.view = null
    const unmeasured = serverRecord('unmeasured', 27)
    unmeasured.server!.modelVersion = 'unmeasured'
    const conditions = comparisonConditions([unconfirmed, unmeasured])
    expect(conditions.modelVersions).toEqual([])
    expect(conditions.missingModelVersions).toBe(1)
    expect(conditions.unmeasuredModels).toBe(1)
    expect(conditions.unconfirmedServerSessions).toBe(1)
    expect(comparisonWarnings(conditions).join(' ')).toContain('서버 종료를 확인하지 못한 기록')
    expect(periodStats([unconfirmed, unmeasured], '', '').sessions).toBe(2)
  })
})
const record = (
  id: string,
  month: number,
  day: number,
  valid: number,
  good: number,
  events: RecordItem['events'] = [],
): RecordItem => {
  const end = new Date(2026, month, day, 10)
  return {
    id,
    startedAt: new Date(end.getTime() - valid * 1000).toISOString(),
    endedAt: end.toISOString(),
    mode: 'camera',
    total: valid,
    valid,
    good,
    events,
  }
}

describe('first-vs-recent comparison', () => {
  it('reports no records', () => {
    expect(compareFirstAndRecent([], NOW)).toEqual({ status: 'empty' })
  })

  it('waits until the recent window no longer overlaps the first window', () => {
    // 첫 측정 9/25 → 초기 9/25~10/1, 최근 구간이 10/2부터 시작하려면 10/8까지 기다린다.
    const result = compareFirstAndRecent([record('a', 8, 25, 3600, 3000)], NOW)
    expect(result).toEqual({ status: 'waiting', firstDay: '2026-09-25', daysLeft: 10 })
    expect(compareFirstAndRecent([record('a', 8, 15, 3600, 3000)], NOW).status).toBe('short')
  })

  it('compares the first seven days with the last seven days and skips the middle', () => {
    const records = [
      record('early-1', 8, 1, 1200, 600, [
        event(1, 100, 20),
        event(2, 400, 40, 2),
        event(3, 1000, null),
      ]),
      record('early-2', 8, 7, 1200, 600),
      record('middle', 8, 15, 9999, 0, [event(1, 10, 5)]),
      record('recent', 8, 27, 3600, 2700, [event(1, 50, 10)]),
    ]
    const result = compareFirstAndRecent(records, NOW)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.early).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-07',
      sessions: 2,
      valid: 2400,
      keepRate: 0.5,
      events: 3,
      alerts: 4,
    })
    expect(result.early.meanInterval).toBe(450)
    expect(result.early.meanRecovery).toBe(30)
    expect(result.early.perHour).toBeCloseTo(4.5)
    expect(result.recent).toMatchObject({
      from: '2026-09-22',
      to: '2026-09-28',
      sessions: 1,
      valid: 3600,
      keepRate: 0.75,
      meanInterval: null,
    })
  })

  it('marks the comparison short when either window lacks valid time', () => {
    const result = compareFirstAndRecent(
      [record('early', 8, 1, 3600, 3000), record('recent', 8, 28, 600, 500)],
      NOW,
    )
    expect(result.status).toBe('short')
  })

  it('keeps unmeasurable-only periods as unavailable rather than zero', () => {
    const stats = periodStats([record('none', 8, 1, 0, 0)], '2026-09-01', '2026-09-07')
    expect(stats.keepRate).toBe(null)
    expect(stats.perHour).toBe(null)
  })
})
