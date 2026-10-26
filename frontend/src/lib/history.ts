import { addDayKey, kstDay } from './kst'
import { summary, type RecordItem } from './serviceStore'

export type Period = 'today' | 'week' | 'month' | 'all'
export type HistoryMode = RecordItem['mode'] | 'all'
/**
 * KST day of an ISO time. A record belongs to the day it started; the server ends every
 * measurement at KST midnight, so it also ended that day (ADR 0029).
 */
export const localDay = kstDay
export function historyFor(
  records: RecordItem[],
  mode: HistoryMode,
  period: Period,
  /** 「오늘」 from the server (`serverToday()`). */
  today: string,
) {
  const from = addDayKey(today, period === 'week' ? -6 : period === 'month' ? -29 : 0)
  return records.filter((r) => {
    if (mode !== 'all' && r.mode !== mode) return false
    const day = kstDay(r.startedAt)
    return period === 'all' || (day >= from && day <= today)
  })
}
export function dailyHistory(records: RecordItem[]) {
  const groups = new Map<string, RecordItem[]>()
  for (const record of records) {
    const date = localDay(record.startedAt)
    groups.set(date, [...(groups.get(date) ?? []), record])
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => ({ date, sessions: items.length, ...summary(items) }))
}
