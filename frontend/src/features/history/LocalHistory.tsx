import { CalendarDots } from '@phosphor-icons/react'
import type { RecordItem } from '../../lib/serviceStore'
import { DayRecord } from './DayRecord'
import { RecordModeChips, useRecordMode } from './recordMode'
import { dayKey } from './recordsSource'

/**
 * 기록 tab: today only (2026-10-13 split). Other days, the heatmap and period charts live
 * in the 달력 tab (RecordCalendarPage). Today's numbers come from the same shape as
 * `GET /records?date=오늘` (docs/design/api-ws-spec.md).
 */
export function LocalHistory({
  records: allRecords,
  measuring,
  onStart,
  onCalendar,
}: {
  records: RecordItem[]
  measuring: boolean
  onStart: () => void
  /** Opens the 달력 tab. */
  onCalendar?: () => void
}) {
  const today = dayKey(new Date())
  const { mode, setMode, hasDemo, records, label } = useRecordMode(allRecords)

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">기록</h1>
          <p className="page-desc">{label}오늘 측정한 기록 · 이 기기에 저장된 기록</p>
        </div>
        {onCalendar && (
          <button className="btn btn-sm" onClick={onCalendar}>
            <CalendarDots size={16} weight="bold" className="icon" />
            지난 기록은 달력에서
          </button>
        )}
      </div>

      {hasDemo && <RecordModeChips mode={mode} onMode={setMode} />}

      <div className="records-stack">
        <DayRecord records={records} day={today} today={today} measuring={measuring} onStart={onStart} />
      </div>
    </>
  )
}
