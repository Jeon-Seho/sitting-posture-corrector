import { Play } from '@phosphor-icons/react'
import { Card, Ledger, Stat } from '../../components/ui'
import { MetricGroups, metricGroupsFor } from '../../components/MetricGroups'
import { GOOD_RATE } from '../../components/RateRing'
import type { RecordItem } from '../../lib/serviceStore'
import { daySessionNumber } from '../../lib/sessionNumber'
import { formatDuration, formatRate } from '../../lib/stats'
import { dayLabel } from './ActivityHeatmap'
import { RecordHistoryItem } from './RecordHistoryItem'
import { dailyStats, sessionsOn } from './recordsSource'

/**
 * One day's record (today by default): three numbers, the grouped metrics and every session
 * of that day. Past days come from the same data as `GET /records?date=` (api-ws-spec 2.6).
 */
export function DayRecord({
  records,
  day,
  today,
  measuring,
  onStart,
  onToday,
}: {
  records: RecordItem[]
  day: string
  today: string
  measuring: boolean
  onStart: () => void
  onToday: () => void
}) {
  const sessions = sessionsOn(records, day)
  const [s] = dailyStats(records, day, day)
  const isToday = day === today
  const allStarts = records.map((r) => r.startedAt)
  return (
    <Card
      title={isToday ? '오늘의 기록' : `${dayLabel(day)} 기록`}
      note={isToday ? dayLabel(day) : undefined}
      action={
        !isToday ? (
          <button className="chip" onClick={onToday}>
            오늘로
          </button>
        ) : undefined
      }
    >
      {!s ? (
        <div className="day-record-empty">
          <p className="fine">{isToday ? '오늘은 아직 측정하지 않았어요.' : '이날은 측정한 기록이 없어요.'}</p>
          {isToday && (
            <button className="btn btn-primary btn-sm" onClick={onStart}>
              <Play size={15} weight="fill" className="icon" />
              {measuring ? '진행 중인 측정으로' : '측정 시작'}
            </button>
          )}
        </div>
      ) : (
        <div className="day-record">
          <Ledger cols={3}>
            <Stat
              dataStat="rate"
              label="바른 자세 유지율"
              value={s.good_ratio === null ? '—' : `${Math.round(s.good_ratio * 100)}%`}
              sub="측정한 시간 가운데 기준 자세를 유지한 비율"
              tone={s.good_ratio !== null && s.good_ratio >= GOOD_RATE ? 'good' : undefined}
            />
            <Stat
              dataStat="valid"
              label="측정 시간"
              value={formatDuration(s.valid_sec)}
              sub={
                <>
                  세션 <span data-stat="count">{s.session_count}</span>회
                </>
              }
            />
            <Stat
              dataStat="alerts"
              label="알림"
              value={`${s.alert_count}회`}
              sub={
                `자세 경고 ${s.event_count}번` +
                (s.valid_sec >= 1800 ? ` · 한 시간에 ${formatRate(s.alert_count / (s.valid_sec / 3600), '회')}` : '')
              }
            />
          </Ledger>
          <MetricGroups
            groups={metricGroupsFor({
              measured: s.valid_sec,
              good: s.good_sec,
              deviation: s.valid_sec - s.good_sec,
              unknown: s.excluded_sec,
              warnings: s.event_count,
              alerts: s.alert_count,
              interval: s.interval_mean_sec,
              recovery: s.recovery_mean_sec,
            })}
          />
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
