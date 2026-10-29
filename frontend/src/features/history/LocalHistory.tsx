import { CalendarDots } from '../../components/icons'
import type { RecordItem } from '../../lib/serviceStore'
import { DayRecord } from './DayRecord'
import { RecordModeChips, useRecordMode } from './recordMode'
import { useServerToday } from '../platform/serverClock'

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
  example = false,
}: {
  records: RecordItem[]
  /** 발표용 예시 기록 are shown instead of this device's records. */
  example?: boolean
  measuring: boolean
  onStart: () => void
  /** Opens the 달력 tab. */
  onCalendar?: () => void
}) {
  // 「오늘」 is the server's KST day (ADR 0029), not this computer's clock.
  const today = useServerToday()
  const { mode, setMode, hasDemo, records, label } = useRecordMode(allRecords)

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">오늘</h1>
          <p className="page-desc">
            {example ? '발표용 예시 기록 · 실제 측정 기록이 아니에요' : `${label}${today} · 오늘의 측정`}
          </p>
        </div>
        {onCalendar && (
          <button className="btn btn-sm" onClick={onCalendar}>
            <CalendarDots size={16} weight="bold" className="icon" />
            지난 기록 보기
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
