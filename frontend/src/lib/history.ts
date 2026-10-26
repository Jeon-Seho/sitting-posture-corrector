import { summary, type RecordItem } from './serviceStore'
import { kstDay, kstDayStart, DAY_MS } from './kstDay'
import { recordsByDay } from '../features/storage/dailyMeasurement'

export type Period = 'today' | 'week' | 'month' | 'all'
export type HistoryMode = RecordItem['mode'] | 'all'
export function localDay(iso: string) {
  return kstDay(iso)
}
export function historyFor(
  records: RecordItem[],
  mode: HistoryMode,
  period: Period,
  now = new Date(),
) {
  const end = kstDayStart(kstDay(now)) + DAY_MS
  const start = end - DAY_MS * (period === 'week' ? 7 : period === 'month' ? 30 : 1)
  return recordsByDay(records).filter(
    (r) =>
      (mode === 'all' || r.mode === mode) &&
      (period === 'all' ||
        (kstDayStart(r.dayPartition?.date ?? localDay(r.startedAt)) >= start && kstDayStart(r.dayPartition?.date ?? localDay(r.startedAt)) < end)),
  )
}
export function dailyHistory(records: RecordItem[]) {
  const groups = new Map<string, RecordItem[]>()
  for (const record of recordsByDay(records)) {
    const date = record.dayPartition?.date ?? localDay(record.startedAt)
    groups.set(date, [...(groups.get(date) ?? []), record])
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => ({ date, sessions: items.length, ...summary(items) }))
}
