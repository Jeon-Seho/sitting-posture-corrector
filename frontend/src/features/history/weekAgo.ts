import type { RecordItem } from '../../lib/serviceStore'
import { addDays, dailyStats, dateOf, type DailyStat } from './recordsSource'

/** 지난주 같은 요일 (2026-10-14): people compare by week ("was I doing this last Wednesday too?"). */
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

/** One plain line: how this day compares with the same weekday last week. */
function compareLine(last: DailyStat | undefined, now: DailyStat | undefined, weekday: number) {
  const name = `지난주 ${WEEKDAY[weekday]}요일`
  const lastRate = last?.good_ratio ?? null
  const nowRate = now?.good_ratio ?? null
  if (lastRate === null) return `${name}에는 측정하지 않았어요`
  const lastText = `${name} ${Math.round(lastRate * 100)}%`
  if (nowRate === null) return lastText
  const diff = Math.round(nowRate * 100) - Math.round(lastRate * 100)
  if (diff === 0) return `${lastText} · 같아요`
  return `${lastText} · ${Math.abs(diff)}%p ${diff > 0 ? '올랐어요' : '내려갔어요'}`
}

/** The same line for any day, straight from records (달력's picked day). */
export function weekAgoLine(records: RecordItem[], day: string) {
  const byDay = new Map(dailyStats(records, addDays(day, -7), day).map((s) => [s.date, s]))
  return compareLine(byDay.get(addDays(day, -7)), byDay.get(day), dateOf(day).getDay())
}
