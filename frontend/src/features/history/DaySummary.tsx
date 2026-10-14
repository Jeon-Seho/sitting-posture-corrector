import { RateRing } from '../../components/RateRing'
import { Card } from '../../components/ui'
import type { RecordItem } from '../../lib/serviceStore'
import { daySessionNumber } from '../../lib/sessionNumber'
import { formatDuration } from '../../lib/stats'
import { dayLabel } from './ActivityHeatmap'
import { DayTimeline } from './DayRecord'
import { RecordHistoryItem } from './RecordHistoryItem'
import { dailyStats, sessionsOn } from './recordsSource'

/**
 * A day picked in the 달력 tab (2026-10-14). Lighter than the 기록 tab's DayRecord so the two
 * tabs read differently, like a diary page: one summary line (small ring, time, sessions,
 * warnings, alerts), when the sessions ran, then the sessions themselves.
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
  const allStarts = records.map((r) => r.startedAt)
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
            <dl>
              <div>
                <dt>측정 시간</dt>
                <dd>{formatDuration(s.valid_sec)}</dd>
              </div>
              <div>
                <dt>세션</dt>
                <dd>{s.session_count}회</dd>
              </div>
              <div>
                <dt>자세 경고</dt>
                <dd>{s.event_count}번</dd>
              </div>
              <div>
                <dt>알림</dt>
                <dd>{s.alert_count}회</dd>
              </div>
            </dl>
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
