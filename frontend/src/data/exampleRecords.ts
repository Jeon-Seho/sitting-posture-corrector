import { DEFAULT_RULES } from './posture'
import { addDayKey, kstDay, kstDayStart } from '../lib/kst'
import { DailyMeasurementLedger } from '../features/storage/dailyMeasurement'
import type { RecordItem } from '../lib/serviceStore'

/**
 * 발표용 예시 기록 (2026-10-30). Replaces the old fixed example dashboard: the same 기록 and
 * 달력 screens show these instead of this device's records when 개발자 도구 최상단 turns
 * them on. Never stored. Built from a fixed seed relative to `now`, so every run shows
 * the same picture: about four months, most weekdays measured, the keep rate rising from
 * about 55% to about 80% and warnings thinning out as it does.
 */
export const EXAMPLE_DAYS = 120

export function exampleRecords(now = new Date()): RecordItem[] {
  let seed = 20261030
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const records: RecordItem[] = []
  const today = kstDay(now)
  const todayStart = kstDayStart(today)
  const elapsedToday = now.getTime() - todayStart
  for (let back = EXAMPLE_DAYS - 1; back >= 0; back--) {
    const dayKey = addDayKey(today, -back)
    const dayStart = kstDayStart(dayKey)
    const day = new Date(`${dayKey}T12:00:00Z`)
    const weekend = day.getUTCDay() === 0 || day.getUTCDay() === 6
    const skip = rnd() < (weekend ? 0.7 : 0.2)
    // Today is always measured (the 기록 tab shows only today): two sessions ending before now.
    if (skip && back > 0) continue
    const progress = 1 - back / EXAMPLE_DAYS
    const sessions = back === 0 ? 2 : 1 + Math.floor(rnd() * (weekend ? 1.5 : 3))
    let hour = 9 + Math.floor(rnd() * 2)
    for (let n = 0; n < sessions; n++) {
      const minute = Math.floor(rnd() * 50)
      const start =
        back === 0
          ? new Date(todayStart + elapsedToday * (n === 0 ? 0.15 : 0.65))
          : new Date(dayStart + (hour * 3600 + minute * 60) * 1000)
      if (start.getTime() < dayStart || start > now) continue
      const room = back === 0 ? (now.getTime() - start.getTime()) / 1000 - 5 : (kstDayStart(addDayKey(dayKey, 1)) - start.getTime()) / 1000 - 1
      const valid = Math.round(Math.min(back === 0 && n === 1 ? 240 : 900 + rnd() * 2700, room - 120))
      if (valid < 30) continue
      const total = valid + Math.round(rnd() * 120)
      const rate = Math.min(0.95, Math.max(0.35, 0.55 + 0.25 * progress + (rnd() - 0.5) * 0.16))
      const count = Math.round((valid / 3600) * (1 + 9 * (1 - rate)) * (0.7 + rnd() * 0.6))
      records.push({
        id: `example-${records.length + 1}`,
        startedAt: start.toISOString(),
        endedAt: new Date(start.getTime() + total * 1000).toISOString(),
        mode: 'demo',
        total,
        valid,
        good: Math.round(valid * rate),
        events: exampleEvents(count, valid, rnd),
        rules: { ...DEFAULT_RULES },
      })
      const record = records[records.length - 1]
      const ledger = new DailyMeasurementLedger(record.startedAt)
      ledger.observe(record)
      record.days = ledger.snapshot()
      hour += 2 + Math.floor(rnd() * 3)
    }
  }
  return records
}

function exampleEvents(count: number, valid: number, rnd: () => number): RecordItem['events'] {
  return Array.from({ length: count }, (_, i) => {
    const startAt = Math.round(((i + 0.2 + rnd() * 0.6) / Math.max(count, 1)) * (valid - 120))
    const durationSec = Math.min(Math.round(15 + rnd() * 90), valid - startAt)
    // Match the current 3 s confirmation and 60 s reminder policy.
    const recoverySec = durationSec - DEFAULT_RULES.holdSeconds
    return {
      id: i + 1,
      type: 'referenceChange',
      startAt,
      validStartAt: startAt,
      confirmedAt: startAt + DEFAULT_RULES.holdSeconds,
      endAt: startAt + durationSec,
      durationSec,
      alerts: durationSec >= DEFAULT_RULES.holdSeconds + DEFAULT_RULES.realertSeconds ? 2 : 1,
      firstAlertAt: startAt + DEFAULT_RULES.holdSeconds,
      recovered: true,
      recoverySec,
      endedBySession: false,
      endReason: null,
      blockId: 0,
    }
  })
}
