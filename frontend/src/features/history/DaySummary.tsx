import { RateRing } from '../../components/RateRing'
import { Card } from '../../components/ui'
import type { RecordItem } from '../../lib/serviceStore'
import { daySessionNumber } from '../../lib/sessionNumber'
import { formatDuration } from '../../lib/stats'
import { dayLabel } from './ActivityHeatmap'
import { DayTimeline } from './DayRecord'
import { RecordHistoryItem } from './RecordHistoryItem'
import { weekAgoLine } from './weekAgo'
import { dailyStats, sessionsOn } from './recordsSource'
import { recordsByDay } from '../storage/dailyMeasurement'

/**
 * A day picked in the 달력 tab (2026-10-14). Lighter than the 기록 tab's DayRecord so the two
 * tabs read differently, like a diary page: a small ring with one line (time · alerts) and how
 * it compares with the same weekday last week, when the sessions ran, then the sessions.
 */
export function DaySummary({
  records,
  day,
  onClose,
}: {
  records: RecordItem[]
  day: string
  onClose: () => void
}) {
  const sessions = sessionsOn(records, day)
  const [s] = dailyStats(records, day, day)
  const allStarts = recordsByDay(records).map((r) => r.startedAt)
  return (
    <Card
      title={`${dayLabel(day)}`}
      className="day-summary"
      action={
        <button className="chip" onClick={onClose}>
          닫기
        </button>
      }
    >
      {!s ? (
        <p className="fine">이날은 측정한 기록이 없어요.</p>
      ) : (
        <div className="day-summary-body">
          <div className="day-summary-line">
            <RateRing rate={s.good_ratio} size={64} />
            <div>
              <p className="day-summary-main">{`${formatDuration(s.valid_sec)} 측정 · 알림 ${s.alert_count}회`}</p>
              <p className="day-summary-sub">{weekAgoLine(records, day)}</p>
            </div>
          </div>
          <DayTimeline sessions={sessions} day={day} />
          <div className="day-sessions">
            {sessions.map((record) => (
              <RecordHistoryItem
                key={record.id}
                record={record}
                sessionNumber={daySessionNumber(allStarts, record.startedAt)}
              />
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
