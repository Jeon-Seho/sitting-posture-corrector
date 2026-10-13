import { useEffect, useRef, useState } from 'react'
import { RecordComparison } from '../../components/RecordComparison'
import { Card } from '../../components/ui'
import type { RecordItem } from '../../lib/serviceStore'
import { ActivityHeatmap } from './ActivityHeatmap'
import { DayRecord } from './DayRecord'
import { MonthCalendar, PeriodCard } from './RecordCalendar'
import { RecordModeChips, useRecordMode } from './recordMode'
import { addDays, dailyStats, dayKey } from './recordsSource'

/**
 * 달력 tab (2026-10-13). The head stays pinned with the 잔디 (how much was measured,
 * display only). Days are picked in the month calendar (this week on a band), and the
 * picked day's record opens below it. Today's record lives in the 기록 tab, so nothing
 * opens until a day is picked. Day totals have the `GET /stats/daily` shape, one day's
 * sessions the `GET /records?date=` shape (docs/design/api-ws-spec.md).
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
  // The calendar may page back past the 13-week heatmap.
  const stats = dailyStats(records, addDays(today, -400), today)
  const dayRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selected) dayRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
  }, [selected])

  return (
    <>
      <div className="page-head calendar-page-head">
        <div>
          <h1 className="page-title">달력</h1>
          <p className="page-desc">{label}날짜를 누르면 그날 기록을 볼 수 있어요</p>
        </div>
        <ActivityHeatmap stats={stats} today={today} />
      </div>

      {hasDemo && <RecordModeChips mode={mode} onMode={setMode} />}

      <div className="records-stack">
        <Card className="calendar-card">
          <MonthCalendar stats={stats} today={today} selected={selected} onSelect={setSelected} />
        </Card>

        {selected && (
          <div ref={dayRef} className="calendar-day-record">
            <DayRecord
              records={records}
              day={selected}
              today={today}
              measuring={measuring}
              onStart={onStart}
              onClose={() => setSelected(null)}
            />
          </div>
        )}

        <PeriodCard stats={stats} today={today} />

        <details className="more">
          <summary>처음과 최근 비교</summary>
          <div className="more-body">
            <p className="fine">
              선택한 기록 종류의 전체 기록을 사용합니다. 합성 시연 결과는 실제 자세 개선 근거가 아닙니다.
            </p>
            <RecordComparison records={records} />
          </div>
        </details>
      </div>
    </>
  )
}
