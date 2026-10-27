import { periodStats } from '../../lib/comparison'
import { localDay } from '../../lib/history'
import { addDayKey } from '../../lib/kst'
import type { RecordItem } from '../../lib/serviceStore'
import { recordsByDay } from '../storage/dailyMeasurement'

/**
 * Where the records screen gets its numbers (2026-10-13 records redesign). Shapes follow
 * docs/design/api-ws-spec.md so the screen does not change when the server takes over:
 * - `GET /records?date=YYYY-MM-DD` → sessions of one day  → `sessionsOn`
 * - `GET /stats/daily?from&to` (≤ 92 days, past days only) → `dailyStats`
 * Until then both are computed from the records saved on this computer.
 */
export type DailyStat = {
  date: string
  valid_sec: number
  good_sec: number
  good_ratio: number | null
  session_count: number
  event_count: number
  alerted_event_count: number
  /** Total alerts including reminders; the API row does not carry it yet (local only). */
  alert_count: number
  interval_mean_sec: number | null
  recovery_mean_sec: number | null
  excluded_sec: number
}

/** "2026-10-13": the KST day of an instant. */
export const dayKey = (date: Date) => localDay(date.toISOString())

export const addDays = addDayKey

/** A Date for showing the calendar parts of `day` (weekday, date); not an instant to compare. */
export function dateOf(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}

/** Sessions that started on `day`, newest first (API order). */
export function sessionsOn(records: RecordItem[], day: string): RecordItem[] {
  return recordsByDay(records)
    .filter((r) => localDay(r.startedAt) === day)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

/** One row per day in [from, to] that has at least one session. */
export function dailyStats(records: RecordItem[], from: string, to: string): DailyStat[] {
  const byDay = new Map<string, RecordItem[]>()
  for (const r of recordsByDay(records)) {
    const day = localDay(r.startedAt)
    if (day < from || day > to) continue
    byDay.set(day, [...(byDay.get(day) ?? []), r])
  }
  return [...byDay]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => {
      const s = periodStats(items, date, date)
      return {
        date,
        valid_sec: s.valid,
        good_sec: s.good,
        good_ratio: s.keepRate,
        session_count: items.length,
        event_count: s.events,
        alerted_event_count: items.reduce((n, r) => n + r.events.filter((e) => e.alerts > 0).length, 0),
        alert_count: s.alerts,
        interval_mean_sec: s.meanInterval,
        recovery_mean_sec: s.meanRecovery,
        excluded_sec: items.reduce((n, r) => n + Math.max(0, r.total - r.valid), 0),
      }
    })
}

/**
 * Activity level 0–4 by measured time, like a contribution graph: none, under 10 min, under
 * 30 min, under 1 h, 1 h or more.
 */
export function activityLevel(validSec: number): 0 | 1 | 2 | 3 | 4 {
  if (validSec <= 0) return 0
  if (validSec < 600) return 1
  if (validSec < 1800) return 2
  if (validSec < 3600) return 3
  return 4
}
