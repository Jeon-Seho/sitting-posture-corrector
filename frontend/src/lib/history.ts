import { summary, type RecordItem } from './serviceStore'

export type Period = 'today' | 'week' | 'month' | 'all'
export type HistoryMode = RecordItem['mode'] | 'all'
export function localDay(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function historyFor(records: RecordItem[], mode: HistoryMode, period: Period, now = new Date()) {
  const start = new Date(now), end = new Date(now)
  start.setHours(0, 0, 0, 0); end.setHours(24, 0, 0, 0)
  start.setDate(start.getDate() - (period === 'week' ? 6 : period === 'month' ? 29 : 0))
  return records.filter(r => (mode === 'all' || r.mode === mode) && (period === 'all' || (Date.parse(r.endedAt) >= start.getTime() && Date.parse(r.endedAt) < end.getTime())))
}
export function dailyHistory(records: RecordItem[]) {
  const groups = new Map<string, RecordItem[]>()
  for (const record of records) {
    const date = localDay(record.endedAt)
    groups.set(date, [...(groups.get(date) ?? []), record])
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => ({ date, sessions: items.length, ...summary(items) }))
}
