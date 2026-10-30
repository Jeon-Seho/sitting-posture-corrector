import { useEffect, useMemo, useRef, useState } from 'react'
import { Card } from '../../components/ui'
import type { RecordItem } from '../../lib/serviceStore'
import { ActivityHeatmap, HeatmapLegend } from './ActivityHeatmap'
import { DaySummary } from './DaySummary'
import { MonthCalendar, PeriodCard } from './RecordCalendar'
import { RecordModeChips, useRecordMode } from './recordMode'
import { addDays, dailyStats } from './recordsSource'
import { useServerToday } from '../platform/serverClock'

/**
 * 달력 tab (2026-10-14), after well-known diary and calendar apps:
 * - 측정한 날: a full-width year of days (Daylio's Year in Pixels / GitHub contributions).
 * - Month calendar with a keep-rate ring per day (Apple Fitness history) and this week on a band.
 * - Beside it: the recent 7/30-day flow. Under both (2026-10-14): the picked day as a light
 *   diary-style summary (DaySummary), unlike the 기록 tab's full DayRecord.
 * Day totals have the `GET /stats/daily` shape, one day's sessions the `GET /records?date=`
 * shape (docs/design/api-ws-spec.md).
 */
export function RecordCalendarPage({
  records: allRecords,
  example = false,
}: {
  records: RecordItem[]
  /** 발표용 예시 기록 are shown instead of this device's records. */
  example?: boolean
}) {
  // 「오늘」 is the server's KST day (ADR 0029), not this computer's clock.
  const today = useServerToday()
  const [selected, setSelected] = useState<string | null>(null)
  const { mode, setMode, hasDemo, records, label } = useRecordMode(allRecords)
  // A year of heatmap plus room for the calendar to page back.
  const stats = useMemo(() => dailyStats(records, addDays(today, -400), today), [records, today])
  // The picked day opens under the calendar; bring it into view.
  const dayRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selected) dayRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
  }, [selected])

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">기록</h1>
          {example ? (
            <p className="page-desc">발표용 예시 기록 · 실제 측정 기록이 아니에요</p>
          ) : (
            label && <p className="page-desc">{label.replace(/ · $/, '')}</p>
          )}
        </div>
      </div>

      {hasDemo && <RecordModeChips mode={mode} onMode={setMode} />}

      <div className="records-stack">
        <Card title="측정한 날" action={<HeatmapLegend />} className="year-card">
          <ActivityHeatmap stats={stats} today={today} selected={selected} onSelect={setSelected} />
        </Card>

        <div className="calendar-layout">
          <Card className="calendar-card">
            <MonthCalendar stats={stats} today={today} selected={selected} onSelect={setSelected} />
          </Card>
          <div className="calendar-side">
            <PeriodCard stats={stats} today={today} />
          </div>
        </div>

        {selected && (
          <div ref={dayRef} className="calendar-day-record">
            <DaySummary records={records} day={selected} onClose={() => setSelected(null)} />
          </div>
        )}
      </div>
    </>
  )
}
