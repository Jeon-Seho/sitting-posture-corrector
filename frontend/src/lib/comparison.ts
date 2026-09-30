import type { RecordItem } from './serviceStore'
import { collapseIntervals, mean, ratio } from './stats'

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

/** 기록은 끝난 날짜(현지 시간)에 속한다. 홈의 '오늘' 집계와 같은 기준이다. */
export const dayKey = (date: Date) => date.toLocaleDateString('sv-SE')
const startOfDay = (date: Date) => { const d = new Date(date); d.setHours(0, 0, 0, 0); return d }
const addDays = (date: Date, days: number) => { const d = new Date(date); d.setDate(d.getDate() + days); return d }

export function periodStats(records: RecordItem[], from: string, to: string): PeriodStats {
  const valid = records.reduce((n, r) => n + r.valid, 0)
  const good = records.reduce((n, r) => n + r.good, 0)
  const events = records.flatMap(r => r.events)
  // 발생 간격은 같은 세션 안의 연속 사건 사이만 잰다. 세션 사이의 공백은 간격이 아니다.
  const intervals = records.flatMap(r => collapseIntervals(r.events))
  const recoveries = events.flatMap(e => e.recoverySec === null ? [] : [e.recoverySec])
  return {
    from, to, sessions: records.length, valid, good, events: events.length,
    alerts: events.reduce((n, e) => n + e.alerts, 0),
    keepRate: ratio(good, valid),
    perHour: valid > 0 ? events.length / (valid / 3600) : null,
    meanInterval: mean(intervals),
    meanRecovery: mean(recoveries),
  }
}

export function compareFirstAndRecent(records: RecordItem[], now = new Date(), rules = COMPARE_RULES): Comparison {
  if (records.length === 0) return { status: 'empty' }
  const days = records.map(r => startOfDay(new Date(r.endedAt)).getTime())
  const first = new Date(Math.min(...days))
  const earlyEnd = addDays(first, rules.days - 1)
  const today = startOfDay(now)
  const recentStart = addDays(today, -(rules.days - 1))
  // 두 구간이 겹치면 전후 비교가 아니다. 첫 측정일부터 2배 기간이 지나야 비교한다.
  if (recentStart <= earlyEnd) {
    const daysLeft = Math.round((addDays(earlyEnd, rules.days).getTime() - today.getTime()) / 86400000)
    return { status: 'waiting', firstDay: dayKey(first), daysLeft }
  }
  const within = (from: Date, to: Date) => records.filter(r => {
    const d = startOfDay(new Date(r.endedAt))
    return d >= from && d <= to
  })
  const early = periodStats(within(first, earlyEnd), dayKey(first), dayKey(earlyEnd))
  const recent = periodStats(within(recentStart, today), dayKey(recentStart), dayKey(today))
  const enough = early.valid >= rules.minValidSeconds && recent.valid >= rules.minValidSeconds
  return { status: enough ? 'ready' : 'short', early, recent }
}
