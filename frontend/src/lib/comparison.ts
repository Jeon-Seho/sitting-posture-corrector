import type { RecordItem } from './serviceStore'
import type { Rules } from './engine'
import { addDayKey, kstDay } from './kst'
import { collapseIntervals, mean, ratio } from './stats'
import { recordsByDay } from '../features/storage/dailyMeasurement'

/**
 * 실제 기록의 전후 비교. 초기 구간은 첫 측정일부터, 최근 구간은 오늘까지의 같은 길이다.
 * 두 값은 팀 합의 전 임시값이다(docs/decisions/0010-record-comparison.md).
 */
export const COMPARE_RULES = { days: 7, minValidSeconds: 30 * 60 }

export type PeriodStats = {
  from: string
  to: string
  sessions: number
  valid: number
  good: number
  events: number
  alerts: number
  keepRate: number | null
  perHour: number | null
  meanInterval: number | null
  meanRecovery: number | null
}

export type Comparison =
  | { status: 'empty' }
  | { status: 'waiting'; firstDay: string; daysLeft: number }
  | { status: 'short'; early: PeriodStats; recent: PeriodStats }
  | { status: 'ready'; early: PeriodStats; recent: PeriodStats }

export type RecordSource = 'camera-local' | 'camera-server' | 'demo'
export const RECORD_SOURCE_LABEL: Record<RecordSource, string> = {
  'camera-local': '실제 웹캠 · 브라우저 판정',
  'camera-server': '실제 웹캠 · 서버 판정',
  demo: '합성 시연',
}

/** These facts describe saved records; they never alter which records enter the statistics. */
export type ComparisonConditions = {
  sources: { source: RecordSource; sessions: number }[]
  settings: { rules: Rules; sessions: number }[]
  missingSettings: number
  modelVersions: string[]
  missingModelVersions: number
  unmeasuredModels: number
  baselineIds: string[]
  missingBaselineIds: number
  unconfirmedServerSessions: number
}

export function recordSource(record: RecordItem): RecordSource {
  if (record.mode === 'demo') return 'demo'
  return record.server ? 'camera-server' : 'camera-local'
}

export function recordedRules(record: RecordItem): Rules | null {
  if (record.rules) return record.rules
  const policy = record.server?.view?.policy
  if (!policy) return null
  return {
    holdSeconds: policy.hold_ms / 1000,
    recoverSeconds: policy.recovery_ms / 1000,
    realertSeconds: policy.reminder_ms / 1000,
    threshold: policy.threshold,
  }
}

function sameRules(a: Rules, b: Rules) {
  return (
    a.holdSeconds === b.holdSeconds &&
    a.recoverSeconds === b.recoverSeconds &&
    a.realertSeconds === b.realertSeconds &&
    a.threshold === b.threshold
  )
}

export function comparisonConditions(records: RecordItem[]): ComparisonConditions {
  const conditions: ComparisonConditions = {
    sources: [],
    settings: [],
    missingSettings: 0,
    modelVersions: [],
    missingModelVersions: 0,
    unmeasuredModels: 0,
    baselineIds: [],
    missingBaselineIds: 0,
    unconfirmedServerSessions: 0,
  }
  for (const record of records) {
    const source = recordSource(record)
    const existingSource = conditions.sources.find((item) => item.source === source)
    if (existingSource) existingSource.sessions += 1
    else conditions.sources.push({ source, sessions: 1 })

    const rules = recordedRules(record)
    if (rules) {
      const existingSettings = conditions.settings.find((item) => sameRules(item.rules, rules))
      if (existingSettings) existingSettings.sessions += 1
      else conditions.settings.push({ rules: { ...rules }, sessions: 1 })
    } else conditions.missingSettings += 1

    const server = record.server
    if (!server || !server.view) conditions.missingModelVersions += 1
    else if (server.modelVersion === 'unmeasured') conditions.unmeasuredModels += 1
    else if (!conditions.modelVersions.includes(server.modelVersion)) {
      conditions.modelVersions.push(server.modelVersion)
    }
    if (record.mode === 'camera') {
      if (!server) conditions.missingBaselineIds += 1
      else if (!conditions.baselineIds.includes(server.baselineId)) {
        conditions.baselineIds.push(server.baselineId)
      }
    }
    if (server && !server.confirmed) conditions.unconfirmedServerSessions += 1
  }
  return conditions
}

export function comparisonWarnings(conditions: ComparisonConditions): string[] {
  const warnings: string[] = []
  if (conditions.sources.length > 1) {
    warnings.push(
      '판정 출처가 섞여 있습니다. 브라우저 판정·서버 판정·합성 시연의 수치를 같은 조건의 결과로 해석하지 마세요.',
    )
  }
  if (conditions.settings.length > 1) {
    warnings.push(
      '적용 설정이 다릅니다. 이탈 확정·복귀 확인·재알림 시간과 변화 기준의 차이가 결과에 영향을 줄 수 있습니다.',
    )
  }
  if (conditions.modelVersions.length > 1) warnings.push('추론 모델 버전이 서로 다릅니다.')
  if (conditions.baselineIds.length > 1) {
    warnings.push(
      '개인 기준 ID가 서로 다릅니다. 다시 등록한 기준으로 측정한 기록이 함께 포함됩니다.',
    )
  }
  if (conditions.missingBaselineIds > 0) {
    warnings.push(
      '일부 웹캠 기록에 개인 기준 ID가 없어 같은 기준으로 측정했는지 확인할 수 없습니다.',
    )
  }
  if (conditions.missingModelVersions > 0) {
    warnings.push('일부 기록에 모델 버전이 없어 같은 판정 모델인지 확인할 수 없습니다.')
  }
  if (conditions.missingSettings > 0) warnings.push('일부 기록에 적용 설정이 남아 있지 않습니다.')
  if (conditions.unconfirmedServerSessions > 0) {
    warnings.push(
      '서버 종료를 확인하지 못한 기록이 포함됩니다. 마지막으로 확인된 요약까지의 결과입니다.',
    )
  }
  return warnings
}

/** Ignore middle records here just as the numeric comparison does. */
export function comparisonRecordGroups(
  records: RecordItem[],
  comparison: Extract<Comparison, { status: 'ready' | 'short' }>,
) {
  const within = (period: PeriodStats) =>
    recordsByDay(records).filter((record) => {
      const day = record.dayPartition?.date ?? kstDay(record.startedAt)
      return day >= period.from && day <= period.to
    })
  return { early: within(comparison.early), recent: within(comparison.recent) }
}

/**
 * 기록은 시작한 KST 날짜에 속한다. 측정은 KST 자정에 서버가 끊으므로 끝난 날짜도 같다
 * (ADR 0029). 기록·달력의 날짜와 같은 기준이다.
 */
export const dayKey = (date: Date) => kstDay(date)
const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86400000

export function periodStats(records: RecordItem[], from: string, to: string): PeriodStats {
  const valid = records.reduce((n, r) => n + r.valid, 0)
  const good = records.reduce((n, r) => n + r.good, 0)
  const events = records.flatMap((r) => r.events)
  // 발생 간격은 같은 세션 안의 연속 사건 사이만 잰다. 세션 사이의 공백은 간격이 아니다.
  const intervals = records.flatMap((r) => collapseIntervals(r.events.filter(e => !e.carried)))
  const recoveries = events.flatMap((e) => (e.recoverySec === null ? [] : [e.recoverySec]))
  return {
    from,
    to,
    sessions: records.length,
    valid,
    good,
    events: records.reduce((n, r) => n + (r.dayPartition?.eventCount ?? r.events.length), 0),
    alerts: records.reduce((n, r) => n + (r.dayPartition?.alerts ?? r.events.reduce((sum, e) => sum + e.alerts, 0)), 0),
    keepRate: ratio(good, valid),
    perHour: valid > 0 ? records.reduce((n, r) => n + (r.dayPartition?.eventCount ?? r.events.length), 0) / (valid / 3600) : null,
    meanInterval: mean(intervals),
    meanRecovery: mean(recoveries),
  }
}

export function compareFirstAndRecent(
  records: RecordItem[],
  now = new Date(),
  rules = COMPARE_RULES,
): Comparison {
  records = recordsByDay(records)
  if (records.length === 0) return { status: 'empty' }
  const first = records.map((r) => r.dayPartition?.date ?? kstDay(r.startedAt)).sort()[0]
  const earlyEnd = addDayKey(first, rules.days - 1)
  const today = kstDay(now)
  const recentStart = addDayKey(today, -(rules.days - 1))
  // 두 구간이 겹치면 전후 비교가 아니다. 첫 측정일부터 2배 기간이 지나야 비교한다.
  if (recentStart <= earlyEnd) {
    const daysLeft = Math.round(daysBetween(today, addDayKey(earlyEnd, rules.days)))
    return { status: 'waiting', firstDay: first, daysLeft }
  }
  const within = (from: string, to: string) =>
    records.filter((r) => {
      const d = r.dayPartition?.date ?? kstDay(r.startedAt)
      return d >= from && d <= to
    })
  const early = periodStats(within(first, earlyEnd), first, earlyEnd)
  const recent = periodStats(within(recentStart, today), recentStart, today)
  const enough = early.valid >= rules.minValidSeconds && recent.valid >= rules.minValidSeconds
  return { status: enough ? 'ready' : 'short', early, recent }
}
