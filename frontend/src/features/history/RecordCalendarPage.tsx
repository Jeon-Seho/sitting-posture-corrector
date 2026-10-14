import { useState } from 'react'
import { Card } from '../../components/ui'
import type { RecordItem } from '../../lib/serviceStore'
import { ActivityHeatmap, HeatmapLegend } from './ActivityHeatmap'
import { DayRecord } from './DayRecord'
import { MonthCalendar, PeriodCard } from './RecordCalendar'
import { RecordModeChips, useRecordMode } from './recordMode'
import { addDays, dailyStats, dayKey } from './recordsSource'

/**
 * 달력 tab (2026-10-14), after well-known diary and calendar apps:
 * - 측정한 날: a full-width year of days (Daylio's Year in Pixels / GitHub contributions).
 * - Month calendar with a keep-rate ring per day (Apple Fitness history) and this week on a band.
 * - Beside it (Day One, desktop calendars): the picked day's record, or the recent 7/30-day
 *   flow while no day is picked. Today's record lives in the 기록 tab.
 * Day totals have the `GET /stats/daily` shape, one day's sessions the `GET /records?date=`
 * shape (docs/design/api-ws-spec.md).
 */
export function RecordCalendarPage({
  records: allRecords,
  measuring,
  onStart,
}: {
  records: RecordItem[]
  measuring: boolean
  onStart: () => void
}) {
  const today = dayKey(new Date())
  const [selected, setSelected] = useState<string | null>(null)
  const { mode, setMode, hasDemo, records, label } = useRecordMode(allRecords)
  // A year of heatmap plus room for the calendar to page back.
  const stats = dailyStats(records, addDays(today, -400), today)

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">달력</h1>
          {label && <p className="page-desc">{label.replace(/ · $/, '')}</p>}
        </div>
      </div>

      {hasDemo && <RecordModeChips mode={mode} onMode={setMode} />}

      <div className="records-stack">
        <Card title="측정한 날" action={<HeatmapLegend />} className="year-card">
          <ActivityHeatmap stats={stats} today={today} />
        </Card>

        <div className="calendar-layout">
          <Card className="calendar-card">
            <MonthCalendar stats={stats} today={today} selected={selected} onSelect={setSelected} />
          </Card>
          <div className="calendar-side">
            {selected ? (
              <DayRecord
                records={records}
                day={selected}
                today={today}
                measuring={measuring}
                onStart={onStart}
                onClose={() => setSelected(null)}
              />
            ) : (
              <PeriodCard stats={stats} today={today} />
            )}
          </div>
        </div>
      </div>
    </>
  )
}
