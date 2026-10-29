import type { CollapseEvent } from '../../lib/engine'
import { DAY_MS, kstDay, kstDayStart } from '../../lib/kstDay'
import type { DailyMeasurement, RecordItem } from './types'

type Totals = { total: number; valid: number; good: number; events: CollapseEvent[]; lastAlertAt?: number }

/** Aggregates observed counters, not video or posture predictions. The source session never resets at midnight. */
export class DailyMeasurementLedger {
  private rows: DailyMeasurement[]
  private previous: { total: number; valid: number; good: number; alerts: number }
  private eventAlerts = new Map<number, number>()
  constructor(private startedAt: string, initial: DailyMeasurement[] = []) {
    this.rows = structuredClone(initial)
    for (const row of this.rows) for (const [id, count] of Object.entries(row.eventAlerts)) this.eventAlerts.set(Number(id), (this.eventAlerts.get(Number(id)) ?? 0) + count)
    this.previous = this.rows.reduce((s, r) => ({ total: s.total + r.total, valid: s.valid + r.valid, good: s.good + r.good, alerts: s.alerts + r.alerts }), { total: 0, valid: 0, good: 0, alerts: 0 })
  }
  observe(next: Totals) {
    const previous = this.previous
    if (next.total < previous.total || next.valid < previous.valid - 1e-6 || next.good < previous.good - 1e-6) return
    const origin = Date.parse(this.startedAt)
    const elapsed = next.total - previous.total
    const rowAt = (offset: number) => {
      // Monotonic fractional seconds can land a fraction of a microsecond below midnight.
      const date = kstDay(origin + offset * 1000 + 0.001)
      let row = this.rows.find(r => r.date === date)
      if (!row) {
        row = { date, from: offset, to: offset, total: 0, valid: 0, good: 0, eventIds: [], eventAlerts: {}, alerts: 0 }
        this.rows.push(row)
      }
      return row
    }
    let cursor = previous.total
    while (cursor < next.total - 1e-9) {
      const row = rowAt(cursor)
      const boundary = (kstDayStart(row.date) + DAY_MS - origin) / 1000
      const end = Math.min(next.total, boundary)
      const fraction = (end - cursor) / elapsed
      row.to = end
      row.total += end - cursor
      row.valid += Math.max(0, next.valid - previous.valid) * fraction
      row.good += Math.max(0, next.good - previous.good) * fraction
      cursor = end
    }
    for (const event of next.events) {
      const row = rowAt(event.confirmedAt)
      if (!row.eventIds.includes(event.id)) row.eventIds.push(event.id)
      const difference = event.alerts - (this.eventAlerts.get(event.id) ?? 0)
      if (difference > 0) {
        const alertRow = rowAt(next.lastAlertAt ?? next.total)
        alertRow.eventAlerts[event.id] = (alertRow.eventAlerts[event.id] ?? 0) + difference
        alertRow.alerts += difference
        this.eventAlerts.set(event.id, event.alerts)
      }
    }
    const alerts = next.events.reduce((n, e) => n + e.alerts, 0)
    this.previous = { total: next.total, valid: next.valid, good: next.good, alerts }
  }
  snapshot(): DailyMeasurement[] { return structuredClone(this.rows.sort((a, b) => a.date.localeCompare(b.date))) }
}

/** Date-specific views keep the original server snapshot on the stored parent record. */
export function recordsByDay(records: RecordItem[]): RecordItem[] {
  return records.flatMap(record => {
    if (record.dayPartition || !record.days || record.days.length < 2) return [record]
    const origin = Date.parse(record.startedAt)
    let validBefore = 0
    return record.days.filter(day => day.total > 0 || day.eventIds.length > 0 || day.alerts > 0).map(day => {
      const previousValid = validBefore
      validBefore += day.valid
      const events = record.events.filter(event => event.confirmedAt < day.to && (event.endAt ?? record.total) > day.from).map(event => {
        const end = event.endAt === null ? null : Math.min(day.to, event.endAt) - day.from
        const continued = event.endAt === null || event.endAt > day.to
        return { ...event, startAt: Math.max(0, event.startAt - day.from), confirmedAt: Math.max(0, event.confirmedAt - day.from),
          validStartAt: event.validStartAt === undefined ? undefined : Math.max(0, event.validStartAt - previousValid),
          endAt: end, durationSec: end === null ? 0 : Math.max(0, end - Math.max(0, event.startAt - day.from)),
          firstAlertAt: event.firstAlertAt === null ? null : Math.max(0, event.firstAlertAt - day.from),
          alerts: day.eventAlerts[event.id] ?? 0,
          continued, carried: event.confirmedAt < day.from, recovered: continued ? false : event.recovered, recoverySec: continued ? null : event.recoverySec,
          endedBySession: continued ? false : event.endedBySession }
      })
      return { ...record, id: `${record.id}@${day.date}`, startedAt: new Date(origin + day.from * 1000).toISOString(),
        endedAt: new Date(origin + day.to * 1000).toISOString(), total: day.total, valid: day.valid, good: day.good, events,
        dayPartition: { date: day.date, sourceId: record.id, alerts: day.alerts, eventCount: day.eventIds.length } }
    })
  })
}
